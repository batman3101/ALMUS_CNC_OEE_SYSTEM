'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase, checkSupabaseConnection } from '@/lib/supabase';

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
}

export const useRealtimeProductionRecords = ({ 
  initialData = [], 
  filters = {} 
}: UseRealtimeProductionRecordsProps = {}) => {
  const [records, setRecords] = useState<ProductionRecord[]>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

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

        let query = supabase
          .from('production_records')
          .select(`
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
            created_at,
            machines:machine_id (
              id,
              name,
              location,
              equipment_type
            )
          `)
          .order('date', { ascending: false })
          .order('machine_id', { ascending: true })
          .order('shift', { ascending: true });

        // 필터 적용
        if (filters.machineId) {
          query = query.eq('machine_id', filters.machineId);
        }
        
        if (filters.dateRange) {
          query = query
            .gte('date', filters.dateRange.start)
            .lte('date', filters.dateRange.end);
        }
        
        if (filters.shift && filters.shift !== 'ALL') {
          query = query.eq('shift', filters.shift);
        }

        const { data, error } = await query;

        if (error) {
          console.error('❌ Supabase query error:', error);
          throw error;
        }

        console.log('✅ Supabase query successful:', {
          recordCount: data?.length || 0,
          sampleRecord: data?.[0] ? {
            record_id: data[0].record_id,
            machine_id: data[0].machine_id,
            date: data[0].date,
            oee: data[0].oee
          } : null
        });

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
            (payload) => {
              console.log('Production records realtime event received:', payload);
              
              const { eventType, new: newRecord, old: oldRecord } = payload;
              
              setRecords(prevRecords => {
                let updatedRecords = [...prevRecords];
                
                switch (eventType) {
                  case 'INSERT':
                    // 새 생산 기록 추가
                    if (newRecord && !updatedRecords.find(r => r.record_id === newRecord.record_id)) {
                      updatedRecords.unshift(newRecord as ProductionRecord);
                      console.log('Production record added:', newRecord.record_id);
                    }
                    break;
                    
                  case 'UPDATE':
                    // 생산 기록 정보 업데이트
                    if (newRecord) {
                      const index = updatedRecords.findIndex(r => r.record_id === newRecord.record_id);
                      if (index !== -1) {
                        updatedRecords[index] = { ...updatedRecords[index], ...newRecord };
                        console.log('Production record updated:', newRecord.record_id);
                      }
                    }
                    break;
                    
                  case 'DELETE':
                    // 생산 기록 삭제
                    if (oldRecord) {
                      updatedRecords = updatedRecords.filter(r => r.record_id !== oldRecord.record_id);
                      console.log('Production record deleted:', oldRecord.record_id);
                    }
                    break;
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
  }, [filters.machineId, filters.dateRange?.start, filters.dateRange?.end, filters.shift, initialData.length, refreshTrigger]);

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

  // 집계 데이터 계산
  const aggregatedData = useCallback(() => {
    const totalProduction = records.reduce((sum, record) => sum + record.output_qty, 0);
    const totalDefects = records.reduce((sum, record) => sum + record.defect_qty, 0);
    const avgOEE = records.length > 0 ? records.reduce((sum, record) => sum + record.oee, 0) / records.length : 0;
    const avgAvailability = records.length > 0 ? records.reduce((sum, record) => sum + record.availability, 0) / records.length : 0;
    const avgPerformance = records.length > 0 ? records.reduce((sum, record) => sum + record.performance, 0) / records.length : 0;
    const avgQuality = records.length > 0 ? records.reduce((sum, record) => sum + record.quality, 0) / records.length : 0;
    
    return {
      totalProduction,
      totalDefects,
      totalGoodQuantity: totalProduction - totalDefects,
      avgOEE: Math.round(avgOEE * 1000) / 10, // 소수점 1자리 %
      avgAvailability: Math.round(avgAvailability * 1000) / 10,
      avgPerformance: Math.round(avgPerformance * 1000) / 10,
      avgQuality: Math.round(avgQuality * 1000) / 10,
      recordCount: records.length
    };
  }, [records]);

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