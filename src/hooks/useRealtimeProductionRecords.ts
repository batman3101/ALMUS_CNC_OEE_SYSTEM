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
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // 기본 조회 조건 (호출부가 기간을 넘기지 않아도 최근 7일로 제한)
  const today = new Date();
  const startDate = filters.dateRange?.start ?? format(subDays(today, DEFAULT_WINDOW_DAYS - 1), 'yyyy-MM-dd');
  const endDate = filters.dateRange?.end ?? format(today, 'yyyy-MM-dd');
  const machineId = filters.machineId;
  const shift = filters.shift;
  const effectiveLimit = Math.min(Math.max(1, limit ?? DEFAULT_RECORD_LIMIT), MAX_RECORD_LIMIT);

  // 실시간 구독 설정
  useEffect(() => {
    console.log('Setting up realtime subscription for production_records');

    let subscription: ReturnType<typeof supabase.channel> | null = null;
    // 이 이펙트가 정리되었는지 표시한다. await 이후에는 항상 이 플래그를 확인해서
    // 이미 정리된 이펙트가 setState 하거나 채널을 남기지 않도록 한다.
    let cancelled = false;

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

        const { data, error } = await query;
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
        console.log(`📊 Loaded ${data?.length || 0} production records`);
      } catch (err: unknown) {
        if (cancelled) return;
        console.error('Error fetching production records:', err);
        const errorMessage = err instanceof Error ? err.message : '생산 기록을 불러오는데 실패했습니다.';
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
    };
  }, [machineId, startDate, endDate, shift, effectiveLimit, initialData.length, refreshTrigger]);

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

  // 집계 데이터 계산 (records가 바뀔 때만 1회 순회)
  const aggregatedResult = useMemo(() => {
    const totals = records.reduce(
      (acc, record) => {
        acc.output += record.output_qty;
        acc.defects += record.defect_qty;
        acc.oee += record.oee;
        acc.availability += record.availability;
        acc.performance += record.performance;
        acc.quality += record.quality;
        return acc;
      },
      { output: 0, defects: 0, oee: 0, availability: 0, performance: 0, quality: 0 }
    );

    const count = records.length;
    const average = (sum: number) => (count > 0 ? sum / count : 0);

    // 비가동 신뢰도.
    // 비가동은 작업자가 직접 입력한다. 입력하지 않으면 actual_runtime = planned_runtime 이 되어
    // 가동률이 100% 로 잡히고 평균 OEE 가 부풀려진다 (downtime_minutes 가 null 인 기록).
    // 평균만 보여주면 이 왜곡이 화면에서 보이지 않으므로,
    // "비가동이 확인된 기록만의 평균"을 함께 계산해 호출부가 나란히 표시할 수 있게 한다.
    const reported = records.filter(
      record => record.downtime_minutes !== null && record.downtime_minutes !== undefined
    );
    const reportedCount = reported.length;
    const reportedOeeSum = reported.reduce((sum, record) => sum + record.oee, 0);
    const reportedAvailabilitySum = reported.reduce((sum, record) => sum + record.availability, 0);
    const reportedAverage = (sum: number) => (reportedCount > 0 ? sum / reportedCount : 0);

    // 물리적으로 불가능한 레거시 기록.
    //
    //   품질 = 양품 / 생산  이므로 생산이 0이면 품질은 0이고,
    //   OEE = 가동률 x 성능 x 품질  이므로 OEE 도 반드시 0이다.
    //   이론 생산시간도 생산량에서 나오므로 0이어야 한다.
    //
    // 그런데 옛 쓰기 경로가 남긴 기록 중에는 생산 수량이 0인데 OEE 가 0.43, 품질이 1.0 으로
    // 저장된 것들이 있다(적용 시점 기준 전체 47,748건, 그중 OEE 가 양수인 것 36,078건).
    // 이 행들은 평균 OEE·품질을 실제보다 높게 만든다.
    //
    // 과거 데이터는 복구하지 않기로 했으므로(계산식 변경 전 구간과 동일한 방침), 대신 화면이
    // 이 사실을 숨기지 않도록 개수와 "제외했을 때의 평균"을 함께 계산해 호출부에 넘긴다.
    // 판별 명제는 Edge Function(daily-oee-aggregation)의 isInconsistentEmptyShift 와 동일하다.
    const isImpossibleRecord = (record: ProductionRecord): boolean =>
      (record.output_qty ?? 0) <= 0 &&
      ((record.oee ?? 0) !== 0 ||
        (record.quality ?? 0) !== 0 ||
        (record.ideal_runtime ?? 0) !== 0);

    const valid = records.filter(record => !isImpossibleRecord(record));
    const validCount = valid.length;
    const validAverage = (sum: number) => (validCount > 0 ? sum / validCount : 0);
    const validOeeSum = valid.reduce((sum, record) => sum + record.oee, 0);
    const validQualitySum = valid.reduce((sum, record) => sum + record.quality, 0);

    return {
      totalProduction: totals.output,
      totalDefects: totals.defects,
      totalGoodQuantity: totals.output - totals.defects,
      avgOEE: Math.round(average(totals.oee) * 1000) / 10, // 소수점 1자리 %
      avgAvailability: Math.round(average(totals.availability) * 1000) / 10,
      avgPerformance: Math.round(average(totals.performance) * 1000) / 10,
      avgQuality: Math.round(average(totals.quality) * 1000) / 10,
      recordCount: count,

      // 비가동 미입력 규모 및 "확인된 기록만"의 지표 (모두 % 단위, 소수점 1자리)
      unreportedCount: count - reportedCount,
      reportedCount,
      avgOEEReported: Math.round(reportedAverage(reportedOeeSum) * 1000) / 10,
      avgAvailabilityReported: Math.round(reportedAverage(reportedAvailabilitySum) * 1000) / 10,

      // 물리적으로 불가능한 레거시 기록 규모 및 "그 행들을 제외한" 지표
      impossibleCount: count - validCount,
      avgOEEExcludingImpossible: Math.round(validAverage(validOeeSum) * 1000) / 10,
      avgQualityExcludingImpossible: Math.round(validAverage(validQualitySum) * 1000) / 10
    };
  }, [records]);

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
    setError
  };
};