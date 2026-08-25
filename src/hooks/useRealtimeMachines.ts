'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { Machine } from '@/types';
import { authFetch } from '@/lib/authFetch';
import { createReadinessGate } from './subscriptionGate';
import { replayBufferedUpdates } from './realtimeBuffer';
import { useFactory } from '@/contexts/FactoryContext';
import { factoryChannelName, realtimeFilterOption } from '@/lib/realtimeScope';

/**
 * `SUBSCRIBED` 를 기다리는 한계. `useRealtimeData` 와 같은 값을 쓴다 —
 * 세 훅이 같은 창을 다루는데 기다리는 시간이 서로 다를 이유가 없다.
 */
const SUBSCRIPTION_READY_TIMEOUT_MS = 3000;

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
  product_models:product_models!machines_factory_production_model_fkey (
    id,
    model_name,
    description
  ),
  model_processes:model_processes!machines_factory_current_process_fkey (
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

  /**
   * 현재 공장. 구독을 **좁히는** 용도다 — 경계는 RLS 가 지킨다(@/lib/realtimeScope).
   *
   * ref 로 두는 이유: 구독 설정이 useCallback/useEffect 안에 있어서, 공장을 의존성에 넣으면
   * 확정되는 순간 구독이 통째로 다시 열린다. 여기서는 필터를 좁히는 것이 목적이고 못 좁혀도
   * 안전하므로, 다음 구독 갱신 때 반영되면 충분하다.
   */
  const { factoryId: scopeFactoryId, factoryCode: scopeFactoryCode } = useFactory();
  const factoryIdRef = useRef<string | null>(null);
  const factoryCodeRef = useRef<string | null>(null);
  factoryIdRef.current = scopeFactoryId;
  factoryCodeRef.current = scopeFactoryCode;

  useEffect(() => {
    machinesRef.current = machines;
  }, [machines]);

  // initialData를 이용한 초기 로드 생략은 최초 마운트에만 적용한다.
  // 이후 필터가 바뀌어 구독 effect가 재실행될 때는 항상 새로 조회해야 한다.
  const isInitialMountRef = useRef(true);

  // setupRealtime은 비동기 함수라 await(refreshMachines) 도중 컴포넌트가 언마운트되거나
  // 이펙트가 재실행될 수 있다. 이 경우를 감지해 orphan Realtime 채널 생성을 막기 위한 ref.
  const isMountedRef = useRef(true);

  /**
   * 이벤트 유실 창을 닫기 위한 두 장치. `useRealtimeData` 가 재감사 #8 에서 도입한 것을
   * 그대로 가져온다 — 같은 결함이 이 훅에는 남아 있었다.
   *
   *   [구독 준비 전]        ← 게이트가 스냅샷을 미뤄서 창 자체를 없앤다
   *   [준비 후 ~ 스냅샷 적용 전] ← 이 버퍼가 모았다가 스냅샷 위에 재생한다
   *
   * 순서만 바꾸고 버퍼가 없으면, 스냅샷이 배열을 통째로 교체하면서 그 사이 반영된 이벤트를
   * 지운다. 버퍼만 있고 순서를 안 바꾸면, 애초에 전달되지 않은 이벤트는 버퍼에도 없다.
   * 둘 다 있어야 창이 닫힌다.
   */
  const snapshotAppliedRef = useRef(false);
  const pendingUpdatesRef = useRef<Array<(prev: Machine[]) => Machine[]>>([]);

  /** 스냅샷이 깔리기 전이면 모아 두고, 깔린 뒤면 바로 반영한다. */
  const applyMachines = useCallback((updater: (prev: Machine[]) => Machine[]) => {
    if (!snapshotAppliedRef.current) {
      pendingUpdatesRef.current.push(updater);
      return;
    }
    setMachines(updater);
  }, []);

  /** 스냅샷을 깔고 그 위에 버퍼를 도착 순서대로 재생한다. */
  const applySnapshot = useCallback((snapshot: Machine[]) => {
    const buffered = pendingUpdatesRef.current;
    pendingUpdatesRef.current = [];
    snapshotAppliedRef.current = true;
    setMachines(replayBufferedUpdates(snapshot, buffered));
  }, []);

  // 설비 데이터 새로고침
  const refreshMachines = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      // 이 조회가 끝날 때까지 도착하는 이벤트는 버퍼로 보낸다. 스냅샷이 배열을 통째로
      // 교체하므로, 여기서 버퍼링하지 않으면 조회 중에 반영된 이벤트가 지워진다.
      snapshotAppliedRef.current = false;

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
          product_models:product_models!machines_factory_production_model_fkey (
            id,
            model_name,
            description
          ),
          model_processes:model_processes!machines_factory_current_process_fkey (
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

      applySnapshot((data || []) as unknown as Machine[]);
    } catch (err: unknown) {
      console.error('Error fetching machines:', err);
      const errorMessage = err instanceof Error ? err.message : '설비 데이터를 불러오는데 실패했습니다.';
      setError(errorMessage);
      // 조회가 실패해도 버퍼를 계속 쌓아 두면 이벤트가 영원히 화면에 닿지 못한다.
      // 스냅샷 없이 현재 상태 위에 재생하고, 이후 이벤트는 바로 반영되게 되돌린다.
      const buffered = pendingUpdatesRef.current;
      pendingUpdatesRef.current = [];
      snapshotAppliedRef.current = true;
      if (buffered.length > 0) {
        setMachines(prev => replayBufferedUpdates(prev, buffered));
      }
    } finally {
      setLoading(false);
    }
  }, [filterIsActive, filterLocation, filterCurrentState, applySnapshot]);

  // 실시간 구독 설정
  useEffect(() => {
    console.log('Setting up realtime subscription for machines');

    // 이펙트가 재실행되는 경우(필터 변경 등)에도 마운트 상태를 다시 true로 설정
    isMountedRef.current = true;

    let subscription: ReturnType<typeof supabase.channel> | null = null;

    // 이 이펙트가 여는 채널은 하나다.
    const readinessGate = createReadinessGate(1, SUBSCRIPTION_READY_TIMEOUT_MS);

    // 이펙트가 새로 돌면 이전 버퍼는 다른 필터의 것이라 의미가 없다.
    pendingUpdatesRef.current = [];
    snapshotAppliedRef.current = false;

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
        /**
         * **구독을 먼저 연다.**
         *
         * 예전에는 스냅샷을 먼저 조회하고 그 뒤에 채널을 만들었다. `subscribe()` 는
         * 비동기라 실제 준비 완료는 `SUBSCRIBED` 콜백으로 오는데, 그 사이(스냅샷이 DB 를
         * 읽은 뒤 ~ 구독이 열리기 전)에 커밋된 변경은 **어디에도 나타나지 않았다.**
         * 스냅샷은 그 이전을 읽었고 구독은 아직 없어서 이벤트를 받지 못한다.
         *
         * 순서를 뒤집으면 그 창이 사라진다. 뒤집으면서 생기는 새 문제(스냅샷이 배열을
         * 교체하며 이미 도착한 이벤트를 지우는 것)는 위의 버퍼가 받는다.
         */
        subscription = supabase
          .channel(factoryChannelName('machines-channel', factoryCodeRef.current))
          .on(
            'postgres_changes',
            {
              event: '*', // INSERT, UPDATE, DELETE 모든 이벤트
              schema: 'public',
              table: 'machines',
              ...realtimeFilterOption(undefined, factoryIdRef.current),
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

                applyMachines(prevMachines => {
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
                  applyMachines(prevMachines => prevMachines.filter(m => m.id !== newRecord.id));
                  console.log('Machine no longer matches filters, removed:', newRecord.name);
                  return;
                }

                const alreadyPresent = machinesRef.current.some(m => m.id === newRecord.id);

                if (alreadyPresent) {
                  applyMachines(prevMachines => {
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

                applyMachines(prevMachines => {
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
                  applyMachines(prevMachines => prevMachines.filter(m => m.id !== oldRecord.id));
                  console.log('Machine deleted:', oldRecord.name);
                }
              }
            }
          )
          .subscribe((status) => {
            console.log('Realtime subscription status:', status);

            if (status === 'SUBSCRIBED') {
              console.log('Successfully subscribed to machines realtime updates');
              readinessGate.markReady();
              return;
            }

            // TIMED_OUT 을 빠뜨리면 화면은 "연결됨"인 채로 갱신만 멈춘다 —
            // 가장 알아채기 어려운 실패 형태다. CHANNEL_ERROR 와 같은 분기로 다룬다.
            if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
              console.error('Realtime subscription failed:', status);
              setError('실시간 연결에 오류가 발생했습니다.');
              setLoading(false);
              // 오지 않을 SUBSCRIBED 를 기다리며 스냅샷을 막지 않는다.
              readinessGate.cancel();
            }
          });

        // 구독이 준비될 때까지 스냅샷을 미룬다. Realtime 이 죽어 있으면 영영 오지 않으므로
        // 기다리되 포기한다 — 포기해도 잃는 것은 원래 있던 그 창뿐이고, 빈 화면보다는 낫다.
        await readinessGate.wait();

        if (!isMountedRef.current) {
          return;
        }

        // 최초 마운트 시 initialData가 제공되었다면 재조회를 생략하고,
        // 그 외(최초 마운트에 initialData가 없거나, 필터 변경으로 재실행된 경우)에는 새로 조회한다
        if (!isInitialMountRef.current || initialData.length === 0) {
          await refreshMachines();
        } else {
          // 재조회를 생략하는 경우에도 버퍼는 풀어 줘야 한다. 그러지 않으면 initialData 로
          // 시작한 화면에서 이벤트가 영원히 버퍼에 갇힌다.
          applySnapshot(machinesRef.current);
        }
        isInitialMountRef.current = false;
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
      // 정리된 채널은 SUBSCRIBED 를 주지 않는다. 게이트를 풀지 않으면 대기 중인 로드가
      // 타임아웃까지 멈춰 있다가 언마운트된 훅의 상태를 건드린다.
      readinessGate.cancel();
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

      const response = await authFetch(`/api/machines/${machineId}`, {
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
      const response = await authFetch(`/api/machines/${machineId}`, {
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
