'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
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

const MACHINE_SELECT_QUERY = `
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
`;

export const useRealtimeMachines = ({
  initialData = [],
  filters = {}
}: UseRealtimeMachinesProps = {}) => {
  // 필터 객체는 매 렌더링마다 새 identity를 가질 수 있으므로(기본값 {} 포함),
  // 원시값만 추출해 의존성 배열에 사용한다 (무한 루프 방지의 근본적인 해결책)
  const { isActive: filterIsActive, location: filterLocation, currentState: filterCurrentState } = filters;

  const [machines, setMachines] = useState<Machine[]>(initialData);
  const [loading, setLoading] = useState(true); // 초기 로딩 상태는 true
  const [error, setError] = useState<string | null>(null);

  // 최신 machines 값을 realtime 콜백에서 동기적으로 읽기 위한 ref
  // (postgres_changes 콜백은 구독 시점의 클로저를 사용하므로 state를 직접 참조하면 stale 값을 볼 수 있음)
  const machinesRef = useRef<Machine[]>(initialData);
  useEffect(() => {
    machinesRef.current = machines;
  }, [machines]);

  // initialData를 이용한 초기 로드 생략은 최초 마운트에만 적용한다.
  // 이후 필터가 바뀌어 구독 effect가 재실행될 때는 항상 새로 조회해야 한다.
  const isInitialMountRef = useRef(true);

  // setupRealtime은 비동기 함수라 await(refreshMachines) 도중 컴포넌트가 언마운트되거나
  // 이펙트가 재실행될 수 있다. 이 경우를 감지해 orphan Realtime 채널 생성을 막기 위한 ref.
  const isMountedRef = useRef(true);

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
      if (filterIsActive !== undefined) {
        query = query.eq('is_active', filterIsActive);
      }
      if (filterLocation) {
        query = query.eq('location', filterLocation);
      }
      if (filterCurrentState) {
        query = query.eq('current_state', filterCurrentState);
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
  }, [filterIsActive, filterLocation, filterCurrentState]);

  // 실시간 구독 설정
  useEffect(() => {
    console.log('Setting up realtime subscription for machines');

    // 이펙트가 재실행되는 경우(필터 변경 등)에도 마운트 상태를 다시 true로 설정
    isMountedRef.current = true;

    let subscription: ReturnType<typeof supabase.channel> | null = null;

    // 목록 조회와 동일한 필터 조건을 realtime 이벤트에도 동일하게 적용
    const matchesFilters = (record: { is_active?: boolean | null; location?: string | null; current_state?: string | null }) => {
      const matchesActive = filterIsActive === undefined || record.is_active === filterIsActive;
      const matchesLocation = !filterLocation || record.location === filterLocation;
      const matchesState = !filterCurrentState || record.current_state === filterCurrentState;
      return matchesActive && matchesLocation && matchesState;
    };

    // 목록의 다른 행과 동일하게 product_models/model_processes 조인이 포함된 형태로 단건 조회
    const fetchJoinedMachine = async (machineId: string): Promise<Machine | null> => {
      const { data, error } = await supabase
        .from('machines')
        .select(MACHINE_SELECT_QUERY)
        .eq('id', machineId)
        .single();

      if (error || !data) {
        console.error('Failed to load joined machine for realtime event:', error);
        return null;
      }

      return data as unknown as Machine;
    };

    const setupRealtime = async () => {
      try {
        // 최초 마운트 시 initialData가 제공되었다면 재조회를 생략하고,
        // 그 외(최초 마운트에 initialData가 없거나, 필터 변경으로 재실행된 경우)에는 새로 조회한다
        if (!isInitialMountRef.current || initialData.length === 0) {
          await refreshMachines();
        }
        isInitialMountRef.current = false;

        // await 도중 컴포넌트가 언마운트되었거나 이펙트가 재실행되어 정리되었다면
        // 채널을 생성하지 않는다. 그렇지 않으면 cleanup은 이미 null이었던 subscription을
        // 정리한 뒤이므로, 여기서 만드는 채널은 아무도 구독 해제하지 않는 orphan이 된다.
        if (!isMountedRef.current) {
          return;
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

                if (!matchesFilters(newRecord)) {
                  return;
                }

                const joinedMachine = await fetchJoinedMachine(newRecord.id);
                if (!joinedMachine) return;

                setMachines(prevMachines => {
                  if (prevMachines.find(m => m.id === joinedMachine.id)) {
                    return prevMachines;
                  }
                  // 이름순 정렬 위치에 맞춰 삽입
                  const insertIndex = prevMachines.findIndex(m => (m.name || '') > (joinedMachine.name || ''));
                  const updatedMachines = [...prevMachines];
                  if (insertIndex === -1) {
                    updatedMachines.push(joinedMachine);
                  } else {
                    updatedMachines.splice(insertIndex, 0, joinedMachine);
                  }
                  return updatedMachines;
                });
                console.log('Machine added:', newRecord.name);
                return;
              }

              if (eventType === 'UPDATE') {
                if (!newRecord) return;

                if (!matchesFilters(newRecord)) {
                  // 더 이상 필터에 부합하지 않으면 목록에서 제거
                  setMachines(prevMachines => prevMachines.filter(m => m.id !== newRecord.id));
                  console.log('Machine no longer matches filters, removed:', newRecord.name);
                  return;
                }

                const alreadyPresent = machinesRef.current.some(m => m.id === newRecord.id);

                if (alreadyPresent) {
                  setMachines(prevMachines => {
                    const index = prevMachines.findIndex(m => m.id === newRecord.id);
                    if (index === -1) return prevMachines;
                    const updatedMachines = [...prevMachines];
                    updatedMachines[index] = { ...updatedMachines[index], ...newRecord };
                    return updatedMachines;
                  });
                  console.log('Machine updated:', newRecord.name);
                  return;
                }

                // 필터에 새로 부합하게 된 설비: 조인 데이터를 조회하여 목록에 추가
                const joinedMachine = await fetchJoinedMachine(newRecord.id);
                if (!joinedMachine) return;

                setMachines(prevMachines => {
                  if (prevMachines.find(m => m.id === joinedMachine.id)) {
                    return prevMachines;
                  }
                  const insertIndex = prevMachines.findIndex(m => (m.name || '') > (joinedMachine.name || ''));
                  const updatedMachines = [...prevMachines];
                  if (insertIndex === -1) {
                    updatedMachines.push(joinedMachine);
                  } else {
                    updatedMachines.splice(insertIndex, 0, joinedMachine);
                  }
                  return updatedMachines;
                });
                console.log('Machine now matches filters, added:', newRecord.name);
                return;
              }

              if (eventType === 'DELETE') {
                if (oldRecord) {
                  setMachines(prevMachines => prevMachines.filter(m => m.id !== oldRecord.id));
                  console.log('Machine deleted:', oldRecord.name);
                }
              }
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
      isMountedRef.current = false;
      if (subscription) {
        subscription.unsubscribe();
      }
    };
    // filters의 원시값(isActive/location/currentState)이 실제로 바뀔 때만 재구독한다.
    // filters 객체 자체를 의존성으로 쓰면 매 렌더마다 새 identity가 생겨 무한 루프가 발생하므로
    // 반드시 원시값만 사용한다. refreshMachines도 동일한 원시값에 의존하는 useCallback이라 안전하다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterIsActive, filterLocation, filterCurrentState, refreshMachines]);

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
