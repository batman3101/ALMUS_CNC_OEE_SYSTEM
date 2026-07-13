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

    // 생산 기록 새로고침 함수 (useEffect 내부에서 정의)
    const refreshRecords = async () => {
      try {
        console.log('🔄 Starting to refresh production records...');
        setLoading(true);
        setError(null);

        // 먼저 Supabase 연결 상태 확인
        const isConnected = await checkSupabaseConnection();
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
        console.error('Error fetching production records:', err);
        const errorMessage = err instanceof Error ? err.message : '생산 기록을 불러오는데 실패했습니다.';
        setError(errorMessage);
      } finally {
        setLoading(false);
      }
    };

    const setupRealtime = async () => {
      try {
        // 먼저 초기 데이터 로드
        if (initialData.length === 0) {
          await refreshRecords();
        }

        // Realtime 구독 설정
        subscription = supabase
          .channel('production-records-channel')
          .on(
            'postgres_changes',
            {
              event: '*', // INSERT, UPDATE, DELETE 모든 이벤트
              schema: 'public',
              table: 'production_records'
            },
            async (payload) => {
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
      } catch (err: unknown) {
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
      if (subscription) {
        subscription.unsubscribe();
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

    return {
      totalProduction: totals.output,
      totalDefects: totals.defects,
      totalGoodQuantity: totals.output - totals.defects,
      avgOEE: Math.round(average(totals.oee) * 1000) / 10, // 소수점 1자리 %
      avgAvailability: Math.round(average(totals.availability) * 1000) / 10,
      avgPerformance: Math.round(average(totals.performance) * 1000) / 10,
      avgQuality: Math.round(average(totals.quality) * 1000) / 10,
      recordCount: count
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