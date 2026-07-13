'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Machine, MachineLog, ProductionRecord, OEEMetrics, User } from '@/types';
import { RealtimeChannel } from '@supabase/supabase-js';

interface RealtimeDataState {
  machines: Machine[];
  machineLogs: MachineLog[];
  productionRecords: ProductionRecord[];
  oeeMetrics: Record<string, OEEMetrics>;
  userProfile: User | null;
  loading: boolean;
  error: string | null;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastUpdated: number;
}

export const useRealtimeData = (userId?: string, userRole?: string) => {
  const [state, setState] = useState<RealtimeDataState>({
    machines: [],
    machineLogs: [],
    productionRecords: [],
    oeeMetrics: {},
    userProfile: null,
    loading: true,
    error: null,
    connectionStatus: 'connecting',
    lastUpdated: Date.now()
  });

  // Realtime 채널 참조 저장
  const channelsRef = useRef<RealtimeChannel[]>([]);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef(false);
  const isMountedRef = useRef(true);

  // 연결 상태 업데이트 함수
  const updateConnectionStatus = useCallback((status: 'connecting' | 'connected' | 'disconnected' | 'error') => {
    if (!isMountedRef.current) return;
    setState(prev => ({ ...prev, connectionStatus: status }));
  }, []);

  // 자동 재연결 함수 (재구독 포함)
  const scheduleReconnect = useCallback(() => {
    // 언마운트된 컴포넌트에는 재연결 타이머를 재장전하지 않음
    if (!isMountedRef.current) return;

    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }

    reconnectTimeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      console.log('🔄 실시간 연결 재시도...');
      updateConnectionStatus('connecting');
      loadInitialData();
      setupRealtimeSubscriptions();
    }, 5000); // 5초 후 재연결 시도
  }, []);

  // 초기 데이터 로드 (성능 최적화)
  const loadInitialData = useCallback(async () => {
    if (!isMountedRef.current) return;
    try {
      setState(prev => ({
        ...prev,
        loading: true,
        error: null,
        connectionStatus: 'connecting'
      }));
      console.info('📊 실제 Supabase 데이터 로드 시작');

      // 사용자 프로필 로드 (운영자의 배정된 설비 확인용)
      const fetchUserProfile = async () => {
        if (!userId) return null;
        const { data: profile, error: profileError } = await supabase
          .from('user_profiles')
          .select('*')
          .eq('user_id', userId)
          .single();

        return profileError ? null : profile;
      };

      // 설비 / 설비 로그 / 생산 실적 쿼리는 서로 의존성이 없으므로 병렬로 조회한다.
      // (기존에는 4개 쿼리를 순차적으로 await 하여 첫 화면 렌더링까지 불필요하게 오래 걸렸음)
      const [userProfile, machinesResult, machineLogsResult, productionRecordsResult] = await Promise.all([
        fetchUserProfile(),
        supabase
          .from('machines')
          .select('*')
          .eq('is_active', true),
        supabase
          .from('machine_logs')
          .select('*')
          .order('start_time', { ascending: false })
          .limit(100),
        supabase
          .from('production_records')
          .select('*')
          .gte('date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
          .order('date', { ascending: false })
      ]);

      // 설비 데이터
      const { data: machines, error: machinesError } = machinesResult;
      if (machinesError) throw machinesError;

      // 최근 설비 로그
      const { data: machineLogs, error: logsError } = machineLogsResult;
      if (logsError) throw logsError;

      // 최근 생산 실적
      const { data: productionRecords, error: productionError } = productionRecordsResult;
      if (productionError) throw productionError;

      // OEE 지표 계산 (개선된 로직)
      const oeeMetrics: Record<string, OEEMetrics> = {};
      if (machines) {
        machines.forEach(machine => {
          // 생산 실적 기반 OEE 데이터 찾기
          const machineRecords = productionRecords?.filter(r => r.machine_id === machine.id) || [];

          if (machineRecords.length > 0) {
            // 생산 실적이 있는 경우: 최신 데이터 사용
            const latestRecord = machineRecords[0];
            oeeMetrics[machine.id] = {
              availability: latestRecord.availability || 0,
              performance: latestRecord.performance || 0,
              quality: latestRecord.quality || 0,
              oee: latestRecord.oee || 0,
              actual_runtime: latestRecord.actual_runtime || 0,
              planned_runtime: latestRecord.planned_runtime || 480,
              ideal_runtime: latestRecord.ideal_runtime || 0,
              output_qty: latestRecord.output_qty || 0,
              defect_qty: latestRecord.defect_qty || 0
            };
          } else {
            // 생산 실적이 없는 경우: 기본값 또는 실시간 계산
            // machine_logs 기반으로 가용성만이라도 계산
            const todayLogs = machineLogs?.filter(log =>
              log.machine_id === machine.id &&
              new Date(log.start_time).toDateString() === new Date().toDateString()
            ) || [];

            let availability = 0;
            if (todayLogs.length > 0) {
              // 정상 작동 시간 계산
              const normalOperationTime = todayLogs
                .filter(log => log.state === 'NORMAL_OPERATION')
                .reduce((acc, log) => {
                  const start = new Date(log.start_time).getTime();
                  const end = log.end_time ? new Date(log.end_time).getTime() : Date.now();
                  return acc + (end - start) / (1000 * 60); // 분 단위
                }, 0);

              // 계획된 작동 시간 (현재까지의 시간)
              const now = new Date();
              const todayStart = new Date(now);
              todayStart.setHours(0, 0, 0, 0);
              const plannedTime = Math.min((now.getTime() - todayStart.getTime()) / (1000 * 60), 480);

              availability = plannedTime > 0 ? normalOperationTime / plannedTime : 0;
            }

            // 기본 OEE 메트릭 설정 (데이터 없는 경우)
            oeeMetrics[machine.id] = {
              availability: availability,
              performance: 0, // 생산 데이터 없으면 0
              quality: 0, // 품질 데이터 없으면 0
              oee: 0, // OEE는 모든 요소가 있어야 계산 가능
              actual_runtime: 0,
              planned_runtime: 480,
              ideal_runtime: 0,
              output_qty: 0,
              defect_qty: 0
            };
          }
        });
      }

      if (!isMountedRef.current) return;

      setState(prev => ({
        ...prev,
        machines: machines || [],
        machineLogs: machineLogs || [],
        productionRecords: productionRecords || [],
        oeeMetrics,
        userProfile,
        loading: false,
        error: null,
        connectionStatus: 'connected',
        lastUpdated: Date.now()
      }));

      console.info('✅ 초기 데이터 로드 완료:', {
        machines: machines?.length || 0,
        machineLogs: machineLogs?.length || 0,
        productionRecords: productionRecords?.length || 0,
        oeeMetrics: Object.keys(oeeMetrics).length
      });

    } catch (error) {
      console.error('❌ 초기 데이터 로드 실패:', error);

      if (!isMountedRef.current) return;

      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : '데이터 로드에 실패했습니다.',
        connectionStatus: 'error'
      }));

      // 에러 발생시 자동 재연결 스케줄
      scheduleReconnect();
    }
  }, [scheduleReconnect]);

  // 채널 정리 함수
  const cleanupChannels = useCallback(() => {
    channelsRef.current.forEach(channel => {
      try {
        channel.unsubscribe();
      } catch (error) {
        console.warn('채널 구독 해제 중 오류:', error);
      }
    });
    channelsRef.current = [];
  }, []);

  // 실시간 구독 설정 (최적화)
  const setupRealtimeSubscriptions = useCallback(() => {
    // Supabase가 제대로 설정되지 않은 경우 구독 설정하지 않음
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('demo') || supabaseUrl.includes('your_supabase')) {
      console.warn('⚠️ Supabase URL이 설정되지 않아 실시간 구독을 건너뜁니다');
      return;
    }

    console.log('🔗 실시간 구독 설정 시작...');

    // 기존 채널 정리
    cleanupChannels();

    // 설비 로그 실시간 구독 (최적화)
    const machineLogsChannel = supabase
      .channel('machine_logs_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'machine_logs'
        },
        (payload) => {
          console.log('📊 Machine log 변경:', payload.eventType, (payload.new as Partial<MachineLog>).log_id);

          if (!isMountedRef.current) return;

          setState(prev => {
            let newLogs = [...prev.machineLogs];

            if (payload.eventType === 'INSERT') {
              newLogs = [payload.new as MachineLog, ...newLogs.slice(0, 99)];
            } else if (payload.eventType === 'UPDATE') {
              const index = newLogs.findIndex(log => log.log_id === payload.new.log_id);
              if (index !== -1) {
                newLogs[index] = payload.new as MachineLog;
              }
            } else if (payload.eventType === 'DELETE') {
              newLogs = newLogs.filter(log => log.log_id !== payload.old.log_id);
            }

            return {
              ...prev,
              machineLogs: newLogs,
              lastUpdated: Date.now()
            };
          });
        }
      )
      .subscribe((status, error) => {
        if (status === 'SUBSCRIBED') {
          console.log('✅ Machine logs 실시간 구독 성공');
          updateConnectionStatus('connected');
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Machine logs 구독 오류:', error);
          updateConnectionStatus('error');
          scheduleReconnect();
        } else if (status === 'CLOSED') {
          console.warn('⚠️ Machine logs 구독 연결 종료');
          updateConnectionStatus('disconnected');
          scheduleReconnect();
        }
      });

    // 생산 실적 실시간 구독
    const productionChannel = supabase
      .channel('production_records_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'production_records'
        },
        (payload) => {
          console.log('Production record change:', payload);

          if (!isMountedRef.current) return;

          setState(prev => {
            let newRecords = [...prev.productionRecords];
            const newOeeMetrics = { ...prev.oeeMetrics };

            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const record = payload.new as ProductionRecord;

              if (payload.eventType === 'INSERT') {
                newRecords = [record, ...newRecords];
              } else {
                const index = newRecords.findIndex(r => r.record_id === record.record_id);
                if (index !== -1) {
                  newRecords[index] = record;
                }
              }

              // OEE 지표 업데이트
              newOeeMetrics[record.machine_id] = {
                availability: record.availability || 0,
                performance: record.performance || 0,
                quality: record.quality || 0,
                oee: record.oee || 0,
                actual_runtime: record.actual_runtime || 0,
                planned_runtime: record.planned_runtime || 480,
                ideal_runtime: record.ideal_runtime || 0,
                output_qty: record.output_qty || 0,
                defect_qty: record.defect_qty || 0
              };
            }

            return {
              ...prev,
              productionRecords: newRecords,
              oeeMetrics: newOeeMetrics
            };
          });
        }
      )
      .subscribe((status, error) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('❌ Production records 구독 오류:', error);
          scheduleReconnect();
        } else if (status === 'CLOSED') {
          console.warn('⚠️ Production records 구독 연결 종료');
          scheduleReconnect();
        }
      });

    // 설비 정보 실시간 구독
    const machinesChannel = supabase
      .channel('machines_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'machines'
        },
        (payload) => {
          console.log('Machine change:', payload);

          if (!isMountedRef.current) return;

          setState(prev => {
            let newMachines = [...prev.machines];

            if (payload.eventType === 'INSERT') {
              newMachines = [...newMachines, payload.new as Machine];
            } else if (payload.eventType === 'UPDATE') {
              const index = newMachines.findIndex(m => m.id === payload.new.id);
              if (index !== -1) {
                newMachines[index] = payload.new as Machine;
              }
            } else if (payload.eventType === 'DELETE') {
              newMachines = newMachines.filter(m => m.id !== payload.old.id);
            }

            return { ...prev, machines: newMachines };
          });
        }
      )
      .subscribe((status, error) => {
        if (status === 'CHANNEL_ERROR') {
          console.error('❌ Machines 구독 오류:', error);
          scheduleReconnect();
        } else if (status === 'CLOSED') {
          console.warn('⚠️ Machines 구독 연결 종료');
          scheduleReconnect();
        }
      });

    // 채널 참조 저장
    channelsRef.current = [machineLogsChannel, productionChannel, machinesChannel];

    console.log('🔗 실시간 구독 설정 완료');
  }, [cleanupChannels, updateConnectionStatus, scheduleReconnect]);

  // 실시간 구독 설정
  useEffect(() => {
    // 이펙트가 재실행되는 경우(StrictMode 재마운트 등)에도 마운트 상태를 다시 true로
    // 설정해야 한다. 그렇지 않으면 cleanup에서 false로 내려간 뒤 영원히 복구되지 않아
    // 이후의 모든 setState가 isMountedRef 가드에 막혀 버린다.
    isMountedRef.current = true;

    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      loadInitialData();
      setupRealtimeSubscriptions();
    }

    // 정리 함수
    return () => {
      isMountedRef.current = false;
      // 다음 마운트에서 초기화 로직(데이터 로드 + 구독 설정)이 다시 실행되도록 리셋
      isInitializedRef.current = false;
      cleanupChannels();
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [loadInitialData, setupRealtimeSubscriptions, cleanupChannels]);

  // 수동 새로고침 함수 (최적화)
  const refresh = useCallback(() => {
    console.log('🔄 수동 새로고침 시작...');
    loadInitialData();
    setupRealtimeSubscriptions();
  }, [loadInitialData, setupRealtimeSubscriptions]);

  // 역할별 필터링된 데이터 반환
  const getFilteredData = useCallback(() => {
    if (!userId || !userRole) return state;

    if (userRole === 'admin' || userRole === 'engineer') {
      return state; // 관리자와 엔지니어는 모든 데이터 접근
    }

    if (userRole === 'operator') {
      // 운영자는 담당 설비만 접근
      const assignedMachineIds = state.userProfile?.assigned_machines || [];

      if (assignedMachineIds.length === 0) {
        return {
          ...state,
          machines: [],
          machineLogs: [],
          productionRecords: []
        };
      }

      const filteredMachines = state.machines.filter(machine =>
        assignedMachineIds.includes(machine.id)
      );

      const filteredLogs = state.machineLogs.filter(log =>
        assignedMachineIds.includes(log.machine_id)
      );

      const filteredRecords = state.productionRecords.filter(record =>
        assignedMachineIds.includes(record.machine_id)
      );

      return {
        ...state,
        machines: filteredMachines,
        machineLogs: filteredLogs,
        productionRecords: filteredRecords
      };
    }

    return state;
  }, [state, userId, userRole]);

  // 메모화된 반환값 (성능 최적화)
  const memoizedResult = useMemo(() => ({
    ...getFilteredData(),
    refresh,
    isConnected: state.connectionStatus === 'connected',
    connectionStatus: state.connectionStatus,
    lastUpdated: state.lastUpdated
  }), [getFilteredData, refresh, state.connectionStatus, state.lastUpdated]);

  return memoizedResult;
};
