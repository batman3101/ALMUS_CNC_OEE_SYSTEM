'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { format, subDays } from 'date-fns';
import { supabase } from '@/lib/supabase';
import { collectOeeDataPages, OeeDataPage } from '@/lib/oeeDataPages';
import { authFetch } from '@/lib/authFetch';

// production_records는 설비 800대 × 2교대 ≈ 1,600행/일로 증가한다.
// 필터가 없으면 전체 테이블(32만행 이상)을 내려받아 statement timeout(57014)에 걸리므로
// 호출부가 아무것도 넘기지 않아도 항상 "기간 + 행수" 상한이 걸리도록 한다.
const DEFAULT_WINDOW_DAYS = 7;       // useRealtimeData와 동일한 기본 조회 기간
const DEFAULT_RECORD_LIMIT = 15000;  // 7일 × 약 1,600행/일 ≈ 11,200행 + 여유분
const MAX_RECORD_LIMIT = 50000;      // 호출부가 지정할 수 있는 상한 (30일 프리셋 ≈ 48,000행 커버)
const API_PAGE_SIZE = 5000;

// 채널 토픽이 고정 문자열이면 이펙트가 재실행될 때 같은 토픽의 채널이 중복 생성된다.
// 구독마다 고유한 토픽을 부여해 이전 채널과 충돌하지 않도록 한다.
let channelSequence = 0;

interface ProductionRecord {
  record_id: string;
  machine_id: string;
  date: string;
  shift: 'A' | 'B';
  planned_runtime: number | null;
  actual_runtime: number | null;
  ideal_runtime: number | null;
  output_qty: number;
  defect_qty: number;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  // null = 비가동 미입력. 런타임 및 OEE 파생값도 null일 수 있다.
  // 0 = 무중단 확인됨, >0 = 비가동 있음. 자세한 정의는 @/types 의 ProductionRecord 참고.
  downtime_minutes: number | null;
  created_at: string;
}

interface ServerAggregateStatistics {
  total_records: number;
  avg_oee: number | null;
  avg_availability: number | null;
  avg_performance: number | null;
  avg_quality: number | null;
  total_output: number;
  total_defect: number;
  total_good: number;
  total_planned_runtime: number;
  total_actual_runtime: number;
  total_ideal_runtime: number;
  aggregation_method: 'runtime_output_weighted';
  data_quality: {
    impossible_records: number;
    avg_oee_excluding_impossible: number | null;
    avg_quality_excluding_impossible: number | null;
  };
  downtime_reporting: {
    unreported_records: number;
    reported_records: number;
    unreported_ratio: number;
    avg_availability_reported: number | null;
    avg_oee_reported: number | null;
  };
}

interface UseRealtimeProductionRecordsProps {
  initialData?: ProductionRecord[];
  filters?: {
    machineId?: string;
    dateRange?: {
      start: string;
      end: string;
    };
    shift?: 'A' | 'B' | 'ALL';
  };
  /** 조회 행수 상한 (기본 15,000행, 최대 50,000행) */
  limit?: number;
  /** 레거시 호환 옵션. 전체 조회도 브라우저 안전 상한(50,000행)을 넘지 않는다. */
  fetchAll?: boolean;
}

interface RecordWindow {
  records: ProductionRecord[];
  totalRecords: number;
  isTruncated: boolean;
}

export const useRealtimeProductionRecords = ({
  initialData = [],
  filters = {},
  limit,
  fetchAll = false
}: UseRealtimeProductionRecordsProps = {}) => {
  const [recordWindow, setRecordWindow] = useState<RecordWindow>({
    records: initialData,
    totalRecords: initialData.length,
    isTruncated: false,
  });
  const { records, totalRecords, isTruncated } = recordWindow;
  const recordWindowRef = useRef(recordWindow);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aggregateStats, setAggregateStats] = useState<ServerAggregateStatistics | null>(null);
  const [aggregateSnapshot, setAggregateSnapshot] = useState({ scopeKey: '', revision: 0 });
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const initialDataRef = useRef(initialData);
  const initialDataConsumedRef = useRef(false);

  const replaceRecordWindow = useCallback((next: RecordWindow) => {
    recordWindowRef.current = next;
    setRecordWindow(next);
  }, []);

  const updateRecordWindow = useCallback((
    updater: (previous: RecordWindow) => RecordWindow
  ) => {
    const next = updater(recordWindowRef.current);
    recordWindowRef.current = next;
    setRecordWindow(next);
  }, []);

  // 기본 조회 조건 (호출부가 기간을 넘기지 않아도 최근 7일로 제한)
  const today = new Date();
  const startDate = filters.dateRange?.start ?? format(subDays(today, DEFAULT_WINDOW_DAYS - 1), 'yyyy-MM-dd');
  const endDate = filters.dateRange?.end ?? format(today, 'yyyy-MM-dd');
  const machineId = filters.machineId;
  const shift = filters.shift;
  const effectiveLimit = Math.min(Math.max(1, limit ?? DEFAULT_RECORD_LIMIT), MAX_RECORD_LIMIT);
  const aggregateScopeKey = `${startDate}|${endDate}|${machineId ?? ''}|${shift ?? ''}`;

  // 실시간 구독 설정
  useEffect(() => {
    console.log('Setting up realtime subscription for production_records');

    let subscription: ReturnType<typeof supabase.channel> | null = null;
    let aggregateRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    let aggregateRequestVersion = 0;
    // 이 이펙트가 정리되었는지 표시한다. await 이후에는 항상 이 플래그를 확인해서
    // 이미 정리된 이펙트가 setState 하거나 채널을 남기지 않도록 한다.
    let cancelled = false;
    const seededRecords = initialDataConsumedRef.current ? [] : initialDataRef.current;
    initialDataConsumedRef.current = true;
    setAggregateStats(null);
    replaceRecordWindow({
      records: seededRecords,
      totalRecords: seededRecords.length,
      isTruncated: false,
    });
    setError(null);

    const fetchAggregateStats = async (): Promise<ServerAggregateStatistics> => {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
        limit: '1',
        ...(machineId ? { machine_id: machineId } : {}),
        ...(shift && shift !== 'ALL' ? { shift } : {}),
      });
      const response = await authFetch(`/api/oee-data?${params}`);
      if (!response.ok) {
        throw new Error(`OEE aggregate HTTP ${response.status}`);
      }
      const payload = await response.json();
      return payload.statistics as ServerAggregateStatistics;
    };

    const fetchRecordsPage = async (
      offset: number,
      pageLimit: number,
      includeStatistics: boolean,
      knownTotal?: number
    ): Promise<OeeDataPage<ProductionRecord, ServerAggregateStatistics>> => {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
        limit: String(pageLimit),
        offset: String(offset),
        include_statistics: String(includeStatistics),
        ...(knownTotal === undefined ? {} : { known_total: String(knownTotal) }),
        ...(machineId ? { machine_id: machineId } : {}),
        ...(shift && shift !== 'ALL' ? { shift } : {}),
      });
      const response = await authFetch(`/api/oee-data?${params}`, { cache: 'no-store' });
      if (!response.ok) {
        throw new Error(`생산 기록 조회 실패 (HTTP ${response.status})`);
      }
      return response.json() as Promise<OeeDataPage<ProductionRecord, ServerAggregateStatistics>>;
    };

    const fetchPagedRecords = async () => {
      const result = await collectOeeDataPages({
        pageSize: API_PAGE_SIZE,
        maxRecords: fetchAll ? MAX_RECORD_LIMIT : effectiveLimit,
        fetchPage: fetchRecordsPage,
      });
      return cancelled ? null : result;
    };

    const scheduleAggregateRefresh = () => {
      if (aggregateRefreshTimer) clearTimeout(aggregateRefreshTimer);
      aggregateRefreshTimer = setTimeout(async () => {
        const requestVersion = ++aggregateRequestVersion;
        try {
          const statistics = await fetchAggregateStats();
          if (!cancelled && requestVersion === aggregateRequestVersion) {
            const exactTotal = Math.max(0, statistics.total_records);
            updateRecordWindow(previous => ({
              ...previous,
              totalRecords: exactTotal,
              isTruncated: exactTotal > previous.records.length,
            }));
            setAggregateStats(statistics);
            setAggregateSnapshot(previous => ({
              scopeKey: aggregateScopeKey,
              revision: previous.revision + 1,
            }));
            setError(null);
          }
        } catch (aggregateError) {
          if (!cancelled && requestVersion === aggregateRequestVersion) {
            console.error('장기 기간 OEE 집계 새로고침 실패:', aggregateError);
            setAggregateStats(null);
            setAggregateSnapshot(previous => ({ scopeKey: '', revision: previous.revision + 1 }));
            setError('전체 기간 OEE 통계를 새로고침하지 못했습니다.');
          }
        }
      }, 500);
    };

    // 생산 기록 새로고침 함수 (useEffect 내부에서 정의)
    const refreshRecords = async () => {
      try {
        console.log('🔄 Starting to refresh production records...');
        setLoading(true);
        setError(null);

        // 브라우저의 Supabase 직접 select는 프로젝트 max_rows(1,000)에 조용히 잘린다.
        // 서버 API의 안정 정렬 페이지를 따라가서 요청한 상한 또는 전체 범위를 정확히 채운다.
        const result = await fetchPagedRecords();
        if (cancelled || !result) return;
        const { records: data, statistics, total } = result;

        console.log('✅ Supabase query successful:', {
          recordCount: data?.length || 0,
          dateRange: { start: startDate, end: endDate },
          limit: effectiveLimit,
          sampleRecord: data?.[0] ? {
            record_id: data[0].record_id,
            machine_id: data[0].machine_id,
            date: data[0].date,
            oee: data[0].oee
          } : null
        });

        if (!fetchAll && total > data.length) {
          console.warn(
            `⚠️ 생산 기록 ${total}건 중 ${data.length}건만 안전 상한 내에서 조회했습니다. 전체 원본 보고서는 기간 또는 설비 범위를 줄여야 합니다.`
          );
        }

        replaceRecordWindow({ records: data, totalRecords: total, isTruncated: total > data.length });
        setAggregateStats(statistics);
        if (statistics) {
          setAggregateSnapshot(previous => ({
            scopeKey: aggregateScopeKey,
            revision: previous.revision + 1,
          }));
        } else {
          setAggregateSnapshot(previous => ({ scopeKey: '', revision: previous.revision + 1 }));
          setError('전체 기간 OEE 통계를 불러오지 못했습니다.');
        }
        console.log(`📊 Loaded ${data.length} / ${total} production records`);
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('Error fetching production records:', err);
        const errorMessage = err instanceof Error ? err.message : '생산 기록을 불러오는데 실패했습니다.';
        replaceRecordWindow({ records: [], totalRecords: 0, isTruncated: false });
        setAggregateStats(null);
        setAggregateSnapshot(previous => ({ scopeKey: '', revision: previous.revision + 1 }));
        setError(errorMessage);
      } finally {
        // 이미 정리된 이펙트의 응답이 현재 이펙트의 로딩 상태를 끄지 않도록 한다
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    const matchesCurrentFilters = (record: Record<string, unknown>): boolean => {
      const recordDate = typeof record.date === 'string' ? record.date : null;
      if (!recordDate) return false;

      const matchesMachine = !machineId || record.machine_id === machineId;
      const matchesShift = !shift || shift === 'ALL' || record.shift === shift;
      const matchesDateRange = recordDate >= startDate && recordDate <= endDate;
      return matchesMachine && matchesShift && matchesDateRange;
    };

    const setupRealtime = async () => {
      try {
        // 먼저 초기 데이터 로드
        if (seededRecords.length === 0) {
          await refreshRecords();
          // 초기 로드를 기다리는 동안 이펙트가 정리되었으면 채널을 만들지 않는다
          if (cancelled) return;
        }

        // Realtime 구독 설정
        const channel = supabase
          .channel(`production-records-channel-${++channelSequence}`)
          .on(
            'postgres_changes',
            {
              event: '*', // INSERT, UPDATE, DELETE 모든 이벤트
              schema: 'public',
              table: 'production_records'
            },
            async (payload) => {
              if (cancelled) return;
              console.log('Production records realtime event received:', payload);

              const { eventType, new: newRecord, old: oldRecord } = payload;

              if (eventType === 'INSERT') {
                if (!newRecord) return;

                // 목록 조회에 적용된 필터를 신규 행에도 동일하게 적용
                const matchesMachine = !machineId || newRecord.machine_id === machineId;
                const matchesShift = !shift || shift === 'ALL' || newRecord.shift === shift;
                const matchesDateRange = newRecord.date >= startDate && newRecord.date <= endDate;

                if (!matchesMachine || !matchesShift || !matchesDateRange) {
                  return;
                }

                // 서버의 안정 정렬(date DESC, created_at DESC, record_id DESC)과 동일한 창을
                // 사용한다. 과거 날짜 사후입력을 무조건 선두에 넣으면 최신 정상 행이 절단 창에서
                // 밀려나므로 배열과 total/isTruncated를 한 번의 서버 재조회 결과로 교체한다.
                await refreshRecords();
                console.log('Production record added:', newRecord.record_id);
                return;
              }

              if (eventType === 'UPDATE' && newRecord) {
                const currentRecord = recordWindowRef.current.records.find(
                  record => record.record_id === newRecord.record_id
                );
                const matchesNow = matchesCurrentFilters(newRecord);
                const filterFieldsChanged = Boolean(currentRecord) && (
                  currentRecord?.machine_id !== newRecord.machine_id ||
                  currentRecord?.date !== newRecord.date ||
                  currentRecord?.shift !== newRecord.shift
                );

                // 필터 안팎으로 이동하거나 날짜 정렬 키가 바뀌면 현재 페이지를 서버 기준으로
                // 다시 구성한다. 절단 목록 밖 행이 새로 들어오는 경우도 로컬 추측으로 총계를
                // 증감하지 않고 같은 경로로 정확한 페이지/건수를 받는다.
                if ((currentRecord && (!matchesNow || filterFieldsChanged)) || (!currentRecord && matchesNow)) {
                  await refreshRecords();
                  return;
                }

                if (currentRecord) {
                  updateRecordWindow(previous => ({
                    ...previous,
                    records: previous.records.map(record =>
                      record.record_id === newRecord.record_id
                        ? { ...record, ...newRecord } as ProductionRecord
                        : record
                    ),
                  }));
                  console.log('Production record updated:', newRecord.record_id);
                }

                // 보이지 않는 행이 필터 밖으로 이동했는지는 old payload가 PK만 줄 경우 판단할 수
                // 없다. 서버 집계 건수로 보정해 절단 목록의 total을 임의 증감하지 않는다.
                scheduleAggregateRefresh();
                return;
              }

              if (eventType === 'DELETE' && oldRecord) {
                const deletedRecordWasVisible = recordWindowRef.current.records.some(
                  record => record.record_id === oldRecord.record_id
                );
                console.log('Production record deleted:', oldRecord.record_id);

                if (deletedRecordWasVisible) {
                  // 절단 목록이면 다음 행을 채워야 하고, 완전 목록이어도 필터 전체 건수를 서버에서
                  // 확정하는 편이 안전하다.
                  await refreshRecords();
                } else {
                  // 보이지 않는 DELETE는 필터 범위 밖일 수도, 절단된 뒤쪽 행일 수도 있다.
                  scheduleAggregateRefresh();
                }
              }
            }
          )
          .subscribe((status) => {
            if (cancelled) return;
            console.log('Production records realtime subscription status:', status);

            if (status === 'SUBSCRIBED') {
              console.log('Successfully subscribed to production records realtime updates');
              setLoading(false);
            } else if (status === 'CHANNEL_ERROR') {
              console.error('Production records realtime subscription error');
              setError('실시간 연결에 오류가 발생했습니다.');
              setLoading(false);
            }
          });

        subscription = channel;

        // subscribe()가 진행되는 사이에 이펙트가 정리되었다면 방금 만든 채널을 즉시 해제한다
        if (cancelled) {
          channel.unsubscribe();
          subscription = null;
        }
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('Error setting up production records realtime subscription:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        setLoading(false);
      }
    };

    setupRealtime();

    // 클린업
    return () => {
      console.log('Cleaning up production records realtime subscription');
      // await 중이라 아직 채널이 만들어지지 않았을 수 있으므로 취소 플래그를 먼저 세운다.
      // (setupRealtime이 이 플래그를 보고 채널 생성을 건너뛰거나 즉시 해제한다)
      cancelled = true;
      if (subscription) {
        subscription.unsubscribe();
        subscription = null;
      }
      if (aggregateRefreshTimer) {
        clearTimeout(aggregateRefreshTimer);
      }
    };
  }, [
    machineId,
    startDate,
    endDate,
    shift,
    effectiveLimit,
    fetchAll,
    refreshTrigger,
    aggregateScopeKey,
    replaceRecordWindow,
    updateRecordWindow,
  ]);

  // 생산 기록 업데이트 함수
  const updateProductionRecord = useCallback(async (
    recordId: string,
    updates: Partial<ProductionRecord>
  ) => {
    try {
      console.log(`Updating production record ${recordId}`, updates);
      
      const response = await authFetch(`/api/production-records/${recordId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates)
      });

      const responseData = await response.json();
      console.log('Production record update API Response:', responseData);

      if (!response.ok) {
        throw new Error(responseData.message || responseData.error || `HTTP ${response.status}`);
      }

      console.log('Production record updated successfully');
      return true;
    } catch (err: unknown) {
      console.error('Error updating production record:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`생산 기록 업데이트 실패: ${errorMessage}`);
      return false;
    }
  }, []);

  // 생산 기록 삭제 함수
  const deleteProductionRecord = useCallback(async (recordId: string) => {
    try {
      console.log(`Deleting production record ${recordId}`);
      
      const response = await authFetch(`/api/production-records/${recordId}`, {
        method: 'DELETE'
      });

      const responseData = await response.json();
      console.log('Production record delete API Response:', responseData);

      if (!response.ok) {
        throw new Error(responseData.message || responseData.error || `HTTP ${response.status}`);
      }

      console.log('Production record deleted successfully');
      return true;
    } catch (err: unknown) {
      console.error('Error deleting production record:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`생산 기록 삭제 실패: ${errorMessage}`);
      return false;
    }
  }, []);

  // 외부에서 새로고침을 트리거하는 함수
  const triggerRefresh = useCallback(() => {
    setRefreshTrigger(prev => prev + 1);
  }, []);

  // 전체 기간 통계는 원본 페이지가 아니라 DB 집계 응답만 사용한다.
  // 집계 요청이 실패한 경우 부분 raw 행을 전체 통계처럼 표시하지 않는다.
  const aggregatedResult = useMemo(() => {
    return {
      totalProduction: aggregateStats?.total_output ?? 0,
      totalDefects: aggregateStats?.total_defect ?? 0,
      totalGoodQuantity: aggregateStats?.total_good ?? 0,
      totalPlannedRuntime: aggregateStats?.total_planned_runtime ?? 0,
      totalActualRuntime: aggregateStats?.total_actual_runtime ?? 0,
      totalIdealRuntime: aggregateStats?.total_ideal_runtime ?? 0,
      avgOEE: aggregateStats?.avg_oee === null || !aggregateStats
        ? null
        : Math.round(aggregateStats.avg_oee * 1000) / 10,
      avgAvailability: aggregateStats?.avg_availability === null || !aggregateStats
        ? null
        : Math.round(aggregateStats.avg_availability * 1000) / 10,
      avgPerformance: aggregateStats?.avg_performance === null || !aggregateStats
        ? null
        : Math.round(aggregateStats.avg_performance * 1000) / 10,
      avgQuality: aggregateStats?.avg_quality === null || !aggregateStats
        ? null
        : Math.round(aggregateStats.avg_quality * 1000) / 10,
      recordCount: aggregateStats?.total_records ?? 0,

      // 비가동 미입력 규모 및 "확인된 기록만"의 지표 (모두 % 단위, 소수점 1자리)
      unreportedCount: aggregateStats?.downtime_reporting.unreported_records ?? 0,
      reportedCount: aggregateStats?.downtime_reporting.reported_records ?? 0,
      avgOEEReported: aggregateStats?.downtime_reporting.avg_oee_reported !== null && aggregateStats
        ? Math.round(aggregateStats.downtime_reporting.avg_oee_reported * 1000) / 10
        : null,
      avgAvailabilityReported: aggregateStats?.downtime_reporting.avg_availability_reported !== null && aggregateStats
        ? Math.round(aggregateStats.downtime_reporting.avg_availability_reported * 1000) / 10
        : null,

      // 물리적으로 불가능한 레거시 기록 규모 및 "그 행들을 제외한" 지표
      impossibleCount: aggregateStats?.data_quality.impossible_records ?? 0,
      avgOEEExcludingImpossible: aggregateStats?.data_quality.avg_oee_excluding_impossible !== null && aggregateStats
        ? Math.round(aggregateStats.data_quality.avg_oee_excluding_impossible * 1000) / 10
        : null,
      avgQualityExcludingImpossible: aggregateStats?.data_quality.avg_quality_excluding_impossible !== null && aggregateStats
        ? Math.round(aggregateStats.data_quality.avg_quality_excluding_impossible * 1000) / 10
        : null
    };
  }, [aggregateStats]);

  // 호출부 시그니처 유지: aggregatedData()는 메모된 결과를 그대로 반환한다.
  const aggregatedData = useCallback(() => aggregatedResult, [aggregatedResult]);

  return {
    records,
    totalRecords,
    isTruncated,
    loading,
    error,
    refreshRecords: triggerRefresh,
    updateProductionRecord,
    deleteProductionRecord,
    aggregatedData,
    aggregateSnapshot,
    setError
  };
};
