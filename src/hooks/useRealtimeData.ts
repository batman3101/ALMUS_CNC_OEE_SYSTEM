'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Machine, MachineLog, ProductionRecord, OEEMetrics, User } from '@/types';
import { RealtimeChannel } from '@supabase/supabase-js';

// 생산 실적 조회 기간 (초기 조회와 실시간 반영이 동일한 윈도우를 사용해야 배열이 무한히 커지지 않는다)
const PRODUCTION_WINDOW_DAYS = 7;

// 조회 윈도우의 시작 날짜 (yyyy-MM-dd)
const getProductionWindowStart = (): string =>
  new Date(Date.now() - PRODUCTION_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

// 설비 로그 조회 기간.
//
// 이전에는 전체 설비에서 `.order(start_time desc).limit(100)` 으로 최근 100건만 가져왔다.
// 활성 설비가 800대인데 그 100건이 커버하는 설비는 34대뿐이었다(실측). 나머지 766대는
// 로그가 하나도 없는 것처럼 보여, 운영자 화면의 "현재 상태 지속시간"과 엔지니어 화면의
// "설비별 비가동 시간"이 0으로 표시됐다.
//
// 화면이 실제로 쓰는 것은 (a) 설비별 열린 로그(end_time=null, 현재 상태 지속시간 계산용)와
// (b) 최근 로그다. 그래서 "열린 로그는 오래됐어도 전부" + "최근 30일" 을 가져온다.
// (전체 machine_logs 는 5,351건뿐이므로 이 조건으로도 충분히 작다)
const LOG_WINDOW_DAYS = 30;
const MAX_LOGS = 5000;

const getLogWindowStart = (): string =>
  new Date(Date.now() - LOG_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();

// 같은 날짜에서는 B(야간, 20:00~08:00)조가 A(주간)조보다 나중이다.
// 초기 조회 정렬(date desc, shift desc)과 동일한 기준으로 "최신" 실적을 정의한다.
const isNewerRecord = (candidate: ProductionRecord, current: ProductionRecord): boolean => {
  if (candidate.date !== current.date) return candidate.date > current.date;
  return candidate.shift > current.shift;
};

// 설비의 실적 목록에서 가장 최신 실적을 고른다 (없으면 null)
const findLatestRecord = (records: ProductionRecord[]): ProductionRecord | null =>
  records.reduce<ProductionRecord | null>(
    (latest, record) => (latest === null || isNewerRecord(record, latest) ? record : latest),
    null
  );

// 생산 실적 1건을 OEE 지표로 변환
const toOeeMetrics = (record: ProductionRecord): OEEMetrics => ({
  availability: record.availability || 0,
  performance: record.performance || 0,
  quality: record.quality || 0,
  oee: record.oee || 0,
  actual_runtime: record.actual_runtime || 0,
  planned_runtime: record.planned_runtime || 480,
  ideal_runtime: record.ideal_runtime || 0,
  output_qty: record.output_qty || 0,
  defect_qty: record.defect_qty || 0
});

// 생산 실적이 하나도 남지 않은 설비의 기본 지표
const createEmptyOeeMetrics = (): OEEMetrics => ({
  availability: 0,
  performance: 0,
  quality: 0,
  oee: 0,
  actual_runtime: 0,
  planned_runtime: 480,
  ideal_runtime: 0,
  output_qty: 0,
  defect_qty: 0
});

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
          // 열린 로그(현재 상태)는 오래됐어도 반드시 포함한다. 설비별 지속시간 계산의 근거다.
          .or(`end_time.is.null,start_time.gte.${getLogWindowStart()}`)
          .order('start_time', { ascending: false })
          .limit(MAX_LOGS),
        supabase
          .from('production_records')
          .select('*')
          .gte('date', getProductionWindowStart())
          // date만으로 정렬하면 같은 날짜에 A/B 교대 행이 함께 있을 때 첫 행이 비결정적이다.
          // shift 내림차순을 2차 정렬로 추가해 B(야간)조가 A(주간)조보다 앞(=최신)에 오게 한다.
          .order('date', { ascending: false })
          .order('shift', { ascending: false })
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

          const latestRecord = findLatestRecord(machineRecords);

          if (latestRecord) {
            // 생산 실적이 있는 경우: 최신 데이터 사용 (date, shift 기준 최신)
            oeeMetrics[machine.id] = toOeeMetrics(latestRecord);
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
            const windowStart = getProductionWindowStart();

            // 변경이 영향을 준 설비. 이 설비의 OEE 지표만 남은 실적으로 다시 계산한다.
            let affectedMachineId: string | null = null;

            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const record = payload.new as ProductionRecord;
              affectedMachineId = record.machine_id;

              const index = newRecords.findIndex(r => r.record_id === record.record_id);
              if (index !== -1) {
                newRecords[index] = record;
              } else {
                newRecords = [record, ...newRecords];
              }
            } else if (payload.eventType === 'DELETE') {
              // DELETE payload(old)에는 보통 PK만 담기므로 설비 ID는 현재 목록에서 찾는다
              const deletedId = (payload.old as Partial<ProductionRecord>).record_id;
              const deletedRecord = deletedId
                ? newRecords.find(r => r.record_id === deletedId)
                : undefined;

              if (!deletedRecord) return prev; // 목록에 없던 행이면 변경 없음

              affectedMachineId = deletedRecord.machine_id;
              newRecords = newRecords.filter(r => r.record_id !== deletedId);
            }

            if (affectedMachineId === null) return prev;

            // 초기 조회와 동일한 7일 윈도우로 배열을 제한한다 (INSERT가 누적되며 무한히 커지는 것 방지)
            newRecords = newRecords.filter(r => r.date >= windowStart);

            // 오래된 날짜/교대의 실적이 도착해도 최신 지표를 덮어쓰지 않도록,
            // 남은 실적 중 가장 최신(date, shift) 건으로 지표를 다시 계산한다.
            const machineRecords = newRecords.filter(r => r.machine_id === affectedMachineId);
            const latestRecord = findLatestRecord(machineRecords);
            newOeeMetrics[affectedMachineId] = latestRecord
              ? toOeeMetrics(latestRecord)
              : createEmptyOeeMetrics();

            return {
              ...prev,
              productionRecords: newRecords,
              oeeMetrics: newOeeMetrics,
              lastUpdated: Date.now()
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

            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              // 초기 조회가 is_active=true만 가져오므로, 실시간 반영도 is_active를 목록 포함 조건으로 삼는다.
              // (비활성화된 설비는 목록에서 제거하고, 다시 활성화되면 목록에 추가한다)
              const machine = payload.new as Machine;
              const index = newMachines.findIndex(m => m.id === machine.id);

              if (machine.is_active) {
                if (index !== -1) {
                  newMachines[index] = machine;
                } else {
                  newMachines = [...newMachines, machine];
                }
              } else if (index !== -1) {
                newMachines = newMachines.filter(m => m.id !== machine.id);
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
