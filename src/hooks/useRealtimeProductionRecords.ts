'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { format, subDays } from 'date-fns';
import { supabase, checkSupabaseConnection } from '@/lib/supabase';

// production_records는 설비 800대 × 2교대 ≈ 1,600행/일로 증가한다.
// 필터가 없으면 전체 테이블(32만행 이상)을 내려받아 statement timeout(57014)에 걸리므로
// 호출부가 아무것도 넘기지 않아도 항상 "기간 + 행수" 상한이 걸리도록 한다.
const DEFAULT_WINDOW_DAYS = 7;       // useRealtimeData와 동일한 기본 조회 기간
const DEFAULT_RECORD_LIMIT = 15000;  // 7일 × 약 1,600행/일 ≈ 11,200행 + 여유분
const MAX_RECORD_LIMIT = 50000;      // 호출부가 지정할 수 있는 상한 (30일 프리셋 ≈ 48,000행 커버)

// 채널 토픽이 고정 문자열이면 이펙트가 재실행될 때 같은 토픽의 채널이 중복 생성된다.
// 구독마다 고유한 토픽을 부여해 이전 채널과 충돌하지 않도록 한다.
let channelSequence = 0;

// 목록 조회와 실시간 INSERT 재조회가 항상 동일한 컬럼 집합을 사용하도록 한 곳에서 정의한다.
const PRODUCTION_RECORD_COLUMNS = `
  record_id,
  machine_id,
  date,
  shift,
  planned_runtime,
  actual_runtime,
  ideal_runtime,
  output_qty,
  defect_qty,
  availability,
  performance,
  quality,
  oee,
  downtime_minutes,
  created_at
`;

interface ProductionRecord {
  record_id: string;
  machine_id: string;
  date: string;
  shift: 'A' | 'B';
  planned_runtime: number;
  actual_runtime: number;
  ideal_runtime: number;
  output_qty: number;
  defect_qty: number;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  // null = 비가동 미입력 (가동률이 100% 로 잡혀 있어 신뢰할 수 없는 기록).
  // 0 = 무중단 확인됨, >0 = 비가동 있음. 자세한 정의는 @/types 의 ProductionRecord 참고.
  downtime_minutes: number | null;
  created_at: string;
}

interface ServerAggregateStatistics {
  total_records: number;
  avg_oee: number;
  avg_availability: number;
  avg_performance: number;
  avg_quality: number;
  total_output: number;
  total_defect: number;
  total_good: number;
  total_planned_runtime: number;
  total_actual_runtime: number;
  total_ideal_runtime: number;
  aggregation_method: 'runtime_output_weighted';
  data_quality: {
    impossible_records: number;
    avg_oee_excluding_impossible: number;
    avg_quality_excluding_impossible: number;
  };
  downtime_reporting: {
    unreported_records: number;
    reported_records: number;
    unreported_ratio: number;
    avg_availability_reported: number;
    avg_oee_reported: number;
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
}

export const useRealtimeProductionRecords = ({
  initialData = [],
  filters = {},
  limit
}: UseRealtimeProductionRecordsProps = {}) => {
  const [records, setRecords] = useState<ProductionRecord[]>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aggregateStats, setAggregateStats] = useState<ServerAggregateStatistics | null>(null);
  const [aggregateSnapshot, setAggregateSnapshot] = useState({ scopeKey: '', revision: 0 });
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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
    setAggregateStats(null);

    const fetchAggregateStats = async (): Promise<ServerAggregateStatistics> => {
      const params = new URLSearchParams({
        start_date: startDate,
        end_date: endDate,
        limit: '1',
        ...(machineId ? { machine_id: machineId } : {}),
        ...(shift && shift !== 'ALL' ? { shift } : {}),
      });
      const response = await fetch(`/api/oee-data?${params}`);
      if (!response.ok) {
        throw new Error(`OEE aggregate HTTP ${response.status}`);
      }
      const payload = await response.json();
      return payload.statistics as ServerAggregateStatistics;
    };

    const scheduleAggregateRefresh = () => {
      if (aggregateRefreshTimer) clearTimeout(aggregateRefreshTimer);
      aggregateRefreshTimer = setTimeout(async () => {
        const requestVersion = ++aggregateRequestVersion;
        try {
          const statistics = await fetchAggregateStats();
          if (!cancelled && requestVersion === aggregateRequestVersion) {
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

        // 먼저 Supabase 연결 상태 확인
        const isConnected = await checkSupabaseConnection();
        if (cancelled) return;
        if (!isConnected) {
          throw new Error('Supabase 연결에 실패했습니다. 네트워크 연결과 환경 변수를 확인해주세요.');
        }
        console.log('✅ Supabase connection verified');

        // 조인(machines)은 어떤 호출부도 사용하지 않으면서 행마다 설비 객체를 중복 생성하므로 제거한다.
        let query = supabase
          .from('production_records')
          .select(PRODUCTION_RECORD_COLUMNS)
          // 기간 필터는 항상 적용된다 (필터 미지정 시 기본 7일)
          .gte('date', startDate)
          .lte('date', endDate)
          .order('date', { ascending: false })
          .order('machine_id', { ascending: true })
          .order('shift', { ascending: true })
          .limit(effectiveLimit);

        // 선택 필터 적용
        if (machineId) {
          query = query.eq('machine_id', machineId);
        }

        if (shift && shift !== 'ALL') {
          query = query.eq('shift', shift);
        }

        // 원본 목록은 표/상세용 페이지이고, 통계는 전체 필터 범위를 DB에서 집계한다.
        // 두 요청을 분리해야 3개월 이상에서 max_rows 또는 클라이언트 limit 때문에
        // 통계가 최신 일부 행만 반영하는 문제가 생기지 않는다.
        const statisticsPromise = fetchAggregateStats().catch(aggregateError => {
          console.error('전체 기간 OEE 집계 조회 실패:', aggregateError);
          return null;
        });
        const [recordsResult, statistics] = await Promise.all([query, statisticsPromise]);
        const { data, error } = recordsResult;
        if (cancelled) return;

        if (error) {
          console.error('❌ Supabase query error:', error);
          throw error;
        }

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

        if (data && data.length >= effectiveLimit) {
          console.warn(
            `⚠️ 생산 기록이 상한(${effectiveLimit}행)까지 조회되었습니다. 선택한 기간의 일부만 표시될 수 있습니다.`
          );
        }

        setRecords(data || []);
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
        console.log(`📊 Loaded ${data?.length || 0} production records`);
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('Error fetching production records:', err);
        const errorMessage = err instanceof Error ? err.message : '생산 기록을 불러오는데 실패했습니다.';
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

    const setupRealtime = async () => {
      try {
        // 먼저 초기 데이터 로드
        if (initialData.length === 0) {
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

                // 목록의 다른 행과 동일한 컬럼 집합으로 다시 조회
                const { data: insertedRecord, error: fetchError } = await supabase
                  .from('production_records')
                  .select(PRODUCTION_RECORD_COLUMNS)
                  .eq('record_id', newRecord.record_id)
                  .single();

                if (cancelled) return;

                if (fetchError || !insertedRecord) {
                  console.error('Failed to load production record for realtime insert:', fetchError);
                  return;
                }

                setRecords(prevRecords => {
                  if (prevRecords.find(r => r.record_id === insertedRecord.record_id)) {
                    return prevRecords;
                  }
                  // 조회 상한과 동일하게 배열 길이를 제한한다 (무한 증가 방지)
                  return [
                    insertedRecord as unknown as ProductionRecord,
                    ...prevRecords.slice(0, effectiveLimit - 1)
                  ];
                });
                console.log('Production record added:', newRecord.record_id);
                scheduleAggregateRefresh();
                return;
              }

              setRecords(prevRecords => {
                let updatedRecords = [...prevRecords];

                if (eventType === 'UPDATE') {
                  if (newRecord) {
                    const index = updatedRecords.findIndex(r => r.record_id === newRecord.record_id);
                    if (index !== -1) {
                      updatedRecords[index] = { ...updatedRecords[index], ...newRecord };
                      console.log('Production record updated:', newRecord.record_id);
                    }
                  }
                } else if (eventType === 'DELETE') {
                  if (oldRecord) {
                    updatedRecords = updatedRecords.filter(r => r.record_id !== oldRecord.record_id);
                    console.log('Production record deleted:', oldRecord.record_id);
                  }
                }

                return updatedRecords;
              });
              scheduleAggregateRefresh();
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
  }, [machineId, startDate, endDate, shift, effectiveLimit, initialData.length, refreshTrigger, aggregateScopeKey]);

  // 생산 기록 업데이트 함수
  const updateProductionRecord = useCallback(async (
    recordId: string,
    updates: Partial<ProductionRecord>
  ) => {
    try {
      console.log(`Updating production record ${recordId}`, updates);
      
      const response = await fetch(`/api/production-records/${recordId}`, {
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
      
      const response = await fetch(`/api/production-records/${recordId}`, {
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
      avgOEE: aggregateStats ? Math.round(aggregateStats.avg_oee * 1000) / 10 : 0,
      avgAvailability: aggregateStats ? Math.round(aggregateStats.avg_availability * 1000) / 10 : 0,
      avgPerformance: aggregateStats ? Math.round(aggregateStats.avg_performance * 1000) / 10 : 0,
      avgQuality: aggregateStats ? Math.round(aggregateStats.avg_quality * 1000) / 10 : 0,
      recordCount: aggregateStats?.total_records ?? 0,

      // 비가동 미입력 규모 및 "확인된 기록만"의 지표 (모두 % 단위, 소수점 1자리)
      unreportedCount: aggregateStats?.downtime_reporting.unreported_records ?? 0,
      reportedCount: aggregateStats?.downtime_reporting.reported_records ?? 0,
      avgOEEReported: aggregateStats
        ? Math.round(aggregateStats.downtime_reporting.avg_oee_reported * 1000) / 10
        : 0,
      avgAvailabilityReported: aggregateStats
        ? Math.round(aggregateStats.downtime_reporting.avg_availability_reported * 1000) / 10
        : 0,

      // 물리적으로 불가능한 레거시 기록 규모 및 "그 행들을 제외한" 지표
      impossibleCount: aggregateStats?.data_quality.impossible_records ?? 0,
      avgOEEExcludingImpossible: aggregateStats
        ? Math.round(aggregateStats.data_quality.avg_oee_excluding_impossible * 1000) / 10
        : 0,
      avgQualityExcludingImpossible: aggregateStats
        ? Math.round(aggregateStats.data_quality.avg_quality_excluding_impossible * 1000) / 10
        : 0
    };
  }, [aggregateStats]);

  // 호출부 시그니처 유지: aggregatedData()는 메모된 결과를 그대로 반환한다.
  const aggregatedData = useCallback(() => aggregatedResult, [aggregatedResult]);

  return {
    records,
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
