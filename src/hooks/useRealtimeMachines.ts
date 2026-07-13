'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Machine } from '@/types';

interface UseRealtimeMachinesProps {
  initialData?: Machine[];
  filters?: {
    isActive?: boolean;
    location?: string;
    currentState?: string;
  };
}

export const useRealtimeMachines = ({ 
  initialData = [], 
  filters = {} 
}: UseRealtimeMachinesProps = {}) => {
  const [machines, setMachines] = useState<Machine[]>(initialData);
  const [loading, setLoading] = useState(true); // 초기 로딩 상태는 true
  const [error, setError] = useState<string | null>(null);

  // 설비 데이터 새로고침
  const refreshMachines = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      let query = supabase
        .from('machines')
        .select(`
          id,
          name,
          location,
          equipment_type,
          is_active,
          current_state,
          production_model_id,
          current_process_id,
          created_at,
          updated_at,
          product_models:production_model_id (
            id,
            model_name,
            description
          ),
          model_processes:current_process_id (
            id,
            process_name,
            process_order,
            tact_time_seconds
          )
        `)
        .order('name', { ascending: true });

      // 필터 적용
      if (filters.isActive !== undefined) {
        query = query.eq('is_active', filters.isActive);
      }
      if (filters.location) {
        query = query.eq('location', filters.location);
      }
      if (filters.currentState) {
        query = query.eq('current_state', filters.currentState);
      }

      const { data, error } = await query;

      if (error) throw error;

      setMachines(data || []);
    } catch (err: unknown) {
      console.error('Error fetching machines:', err);
      const errorMessage = err instanceof Error ? err.message : '설비 데이터를 불러오는데 실패했습니다.';
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  // 실시간 구독 설정
  useEffect(() => {
    console.log('Setting up realtime subscription for machines');

    let subscription: ReturnType<typeof supabase.channel> | null = null;

    const setupRealtime = async () => {
      try {
        // 먼저 초기 데이터 로드
        if (initialData.length === 0) {
          await refreshMachines();
        }

        // Realtime 구독 설정
        subscription = supabase
          .channel('machines-channel')
          .on(
            'postgres_changes',
            {
              event: '*', // INSERT, UPDATE, DELETE 모든 이벤트
              schema: 'public',
              table: 'machines'
            },
            async (payload) => {
              console.log('Realtime event received:', payload);

              const { eventType, new: newRecord, old: oldRecord } = payload;

              if (eventType === 'INSERT') {
                if (!newRecord) return;

                // 목록 조회에 적용된 필터를 신규 행에도 동일하게 적용
                const matchesActive = filters.isActive === undefined || newRecord.is_active === filters.isActive;
                const matchesLocation = !filters.location || newRecord.location === filters.location;
                const matchesState = !filters.currentState || newRecord.current_state === filters.currentState;

                if (!matchesActive || !matchesLocation || !matchesState) {
                  return;
                }

                // 목록의 다른 행과 동일하게 product_models/model_processes 조인이 포함된 형태로 다시 조회
                const { data: joinedMachine, error: fetchError } = await supabase
                  .from('machines')
                  .select(`
                    id,
                    name,
                    location,
                    equipment_type,
                    is_active,
                    current_state,
                    production_model_id,
                    current_process_id,
                    created_at,
                    updated_at,
                    product_models:production_model_id (
                      id,
                      model_name,
                      description
                    ),
                    model_processes:current_process_id (
                      id,
                      process_name,
                      process_order,
                      tact_time_seconds
                    )
                  `)
                  .eq('id', newRecord.id)
                  .single();

                if (fetchError || !joinedMachine) {
                  console.error('Failed to load joined machine for realtime insert:', fetchError);
                  return;
                }

                setMachines(prevMachines => {
                  if (prevMachines.find(m => m.id === joinedMachine.id)) {
                    return prevMachines;
                  }
                  // 이름순 정렬 위치에 맞춰 삽입
                  const insertIndex = prevMachines.findIndex(m => (m.name || '') > (joinedMachine.name || ''));
                  const updatedMachines = [...prevMachines];
                  if (insertIndex === -1) {
                    updatedMachines.push(joinedMachine as unknown as Machine);
                  } else {
                    updatedMachines.splice(insertIndex, 0, joinedMachine as unknown as Machine);
                  }
                  return updatedMachines;
                });
                console.log('Machine added:', newRecord.name);
                return;
              }

              setMachines(prevMachines => {
                let updatedMachines = [...prevMachines];

                if (eventType === 'UPDATE') {
                  if (newRecord) {
                    const index = updatedMachines.findIndex(m => m.id === newRecord.id);
                    if (index !== -1) {
                      updatedMachines[index] = { ...updatedMachines[index], ...newRecord };
                      console.log('Machine updated:', newRecord.name);
                    }
                  }
                } else if (eventType === 'DELETE') {
                  if (oldRecord) {
                    updatedMachines = updatedMachines.filter(m => m.id !== oldRecord.id);
                    console.log('Machine deleted:', oldRecord.name);
                  }
                }

                return updatedMachines;
              });
            }
          )
          .subscribe((status) => {
            console.log('Realtime subscription status:', status);
            
            if (status === 'SUBSCRIBED') {
              console.log('Successfully subscribed to machines realtime updates');
              setLoading(false); // 구독 완료 시 로딩 상태 해제
            } else if (status === 'CHANNEL_ERROR') {
              console.error('Realtime subscription error');
              setError('실시간 연결에 오류가 발생했습니다.');
              setLoading(false);
            }
          });
      } catch (err: unknown) {
        console.error('Error setting up realtime subscription:', err);
        const errorMessage = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMessage);
        setLoading(false);
      }
    };

    setupRealtime();

    // 클린업
    return () => {
      console.log('Cleaning up realtime subscription');
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, []); // 의존성 배열을 비워서 무한 루프 방지

  // 설비 상태 업데이트 함수
  const updateMachineStatus = useCallback(async (
    machineId: string,
    status: string,
    changeReason?: string
  ) => {
    try {
      console.log(`Updating machine ${machineId} status to ${status}`);
      
      const response = await fetch(`/api/machines/${machineId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          current_state: status,
          change_reason: changeReason
        })
      });

      const responseData = await response.json();
      console.log('API Response:', responseData);

      if (!response.ok) {
        throw new Error(responseData.message || responseData.error || `HTTP ${response.status}`);
      }

      console.log('Machine status updated successfully');
      return true;
    } catch (err: unknown) {
      console.error('Error updating machine status:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(`설비 상태 업데이트 실패: ${errorMessage}`);
      return false;
    }
  }, []);

  // 설비 정보 업데이트 함수
  const updateMachine = useCallback(async (
    machineId: string,
    updateData: Partial<Machine>
  ) => {
    try {
      const response = await fetch(`/api/machines/${machineId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateData)
      });

      if (!response.ok) {
        throw new Error('설비 정보 업데이트에 실패했습니다.');
      }

      console.log('Machine updated successfully');
      return true;
    } catch (err: unknown) {
      console.error('Error updating machine:', err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setError(errorMessage);
      return false;
    }
  }, []);

  return {
    machines,
    loading,
    error,
    refreshMachines,
    updateMachineStatus,
    updateMachine,
    setError
  };
};