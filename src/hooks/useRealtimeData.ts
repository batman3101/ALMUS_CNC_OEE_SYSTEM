'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Machine, MachineLog, ProductionRecord, OEEMetrics, User } from '@/types';
import { RealtimeChannel } from '@supabase/supabase-js';
import { authFetch } from '@/lib/authFetch';

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

/** 최근 N건은 제한하되, 제한 밖의 열린 로그는 설비 현재 상태 근거이므로 모두 보존한다. */
export const retainRecentAndOpenMachineLogs = (
  logs: MachineLog[],
  recentLimit: number = MAX_LOGS
): MachineLog[] => {
  const seen = new Set<string>();
  const unique = logs.filter(log => {
    if (seen.has(log.log_id)) return false;
    seen.add(log.log_id);
    return true;
  });
  const recent = unique.slice(0, recentLimit);
  const recentIds = new Set(recent.map(log => log.log_id));
  return [...recent, ...unique.filter(log => !log.end_time && !recentIds.has(log.log_id))];
};

export const applyRealtimeMachineLog = (
  logs: MachineLog[],
  eventType: 'INSERT' | 'UPDATE' | 'DELETE',
  next?: MachineLog,
  previousId?: string
): MachineLog[] => {
  if (eventType === 'DELETE') {
    return logs.filter(log => log.log_id !== previousId);
  }
  if (!next) return logs;
  const merged = [next, ...logs.filter(log => log.log_id !== next.log_id)];
  return retainRecentAndOpenMachineLogs(merged);
};

interface OeeDataPage {
  oee_data: ProductionRecord[];
  pagination: { offset: number; returned: number; total: number; has_more: boolean };
}

/** API의 명시적 페이지 계약을 끝까지 따라가 Supabase max_rows 절삭을 피한다. */
export const fetchAllRecentProductionRecords = async (machineIds?: string[]): Promise<ProductionRecord[]> => {
  const pageLimit = 5000;
  const records: ProductionRecord[] = [];

  // undefined는 관리자/엔지니어의 전체 조회, []는 담당 설비가 없는 운영자의 빈 결과다.
  // 운영자는 각 담당 설비를 단일 machine_id로 조회해야 서버의 assigned-machine 검사를
  // 우회하지 않으면서 여러 담당 설비를 모두 볼 수 있다.
  const scopes: Array<string | undefined> = machineIds === undefined
    ? [undefined]
    : [...new Set(machineIds)];

  for (const machineId of scopes) {
    let offset = 0;
    let knownTotal = 0;

    while (true) {
      const params = new URLSearchParams({
        start_date: getProductionWindowStart(),
        end_date: new Date().toISOString().split('T')[0],
        limit: String(pageLimit),
        offset: String(offset),
        include_statistics: offset === 0 ? 'true' : 'false',
        ...(machineId ? { machine_id: machineId } : {}),
        ...(offset > 0 ? { known_total: String(knownTotal) } : {})
      });
      const response = await authFetch(`/api/oee-data?${params}`);
      if (!response.ok) throw new Error(`OEE data HTTP ${response.status}`);
      const page = await response.json() as OeeDataPage;
      records.push(...(page.oee_data || []));
      knownTotal = page.pagination?.total ?? records.length;
      if (!page.pagination?.has_more) break;
      if (!page.pagination.returned) throw new Error('OEE data pagination made no progress');
      offset += page.pagination.returned;
    }
  }

  return records;
};

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
/**
 * 저장된 실적을 게이지용 지표로 옮긴다. 계산할 수 없으면 null 을 돌려준다.
 *
 * 예전에는 `record.oee || 0`, `record.planned_runtime || 480` 로 NULL 을 뭉갰다.
 * `/api/oee-data` 는 toNullableNumber 로 "미보고(NULL)"와 "확인된 0"을 구분해
 * 내려주는데(oee-data/__tests__/completenessContract.test.ts 가 고정),
 * 그 구분이 여기서 한 겹 위에 올라오자마자 사라지고 있었다. 그 결과 미보고 설비가
 * 멀쩡한데도 빨간 0.0% 로 표시됐다.
 *
 * 480 은 근거가 없는 숫자이기도 했다 — 교대 기본 계획시간은 660분(12시간 − 휴식 60분)이다.
 *
 * 하나라도 NULL 이면 게이지의 어느 칸도 정직하게 채울 수 없으므로 지표 자체를 만들지 않는다.
 * 호출부는 "항목 없음"을 이미 빈 상태로 처리한다(OperatorDashboard 의 OEE 탭).
 */
export const toOeeMetrics = (record: ProductionRecord): OEEMetrics | null => {
  const { availability, performance, quality, oee } = record;
  const { planned_runtime, actual_runtime, ideal_runtime } = record;

  // == null 은 null 과 undefined 를 함께 거른다. 0 은 통과시켜야 한다 —
  // 확인된 무생산 교대의 0 은 진짜 측정값이다.
  if (
    availability == null || performance == null || quality == null || oee == null
    || planned_runtime == null || actual_runtime == null || ideal_runtime == null
  ) {
    return null;
  }

  return {
    availability,
    performance,
    quality,
    oee,
    actual_runtime,
    planned_runtime,
    ideal_runtime,
    output_qty: record.output_qty ?? 0,
    defect_qty: record.defect_qty ?? 0
  };
};

export interface UseRealtimeDataOptions {
  /**
   * 생산 실적을 조회해 설비별 OEE 지표를 계산할지 (기본 true).
   *
   * false 면 `/api/oee-data` 를 호출하지 않고 `oeeMetrics` 는 null 이 된다.
   * 엔지니어 화면은 이 훅에서 machines 만 쓰면서도 7일치 전체 실적
   * (2026-07-17 실측 4,052행 / 1.9MB)을 받아 전부 버렸고, 그 요청 하나가
   * 3~4초 동안 loading 을 붙잡아 "새로고침이 끝나지 않는" 증상을 만들었다.
   * 설비별 지표가 필요한 화면은 useMachineOEEStats 처럼 서버 집계를 쓴다.
   */
  includeProductionRecords?: boolean;
  /**
   * 설비 로그를 조회·구독할지 (기본 true).
   *
   * false 면 machine_logs 초기 조회(최대 5,000행)와 전체 테이블 실시간 채널을
   * 만들지 않고 `machineLogs` 는 빈 배열이 된다. 엔지니어 화면이 실적과 같은
   * 이유로 로그도 받아서 전부 버리고 있었다 — 쓰지 않는 데이터는 받지 않는다.
   */
  includeMachineLogs?: boolean;
}

/**
 * Realtime 채널용 in-필터. 담당 설비가 소수인 운영자는 전체 테이블 이벤트 대신
 * 자기 설비 이벤트만 받는다(800대 체제에서 이벤트 팬아웃 절감).
 * 주의: DELETE 이벤트는 replica identity(PK)만 실리므로 PK 가 아닌 컬럼 필터는
 * DELETE 를 걸러버린다 — 필터는 INSERT/UPDATE 반영용이고, 삭제 반영은 주기
 * 새로고침(useAutoRefresh/refresh)이 맡는다.
 */
const REALTIME_FILTER_MAX_IDS = 100;
export const buildRealtimeInFilter = (
  column: string,
  ids: string[] | undefined
): string | undefined =>
  ids && ids.length > 0 && ids.length <= REALTIME_FILTER_MAX_IDS
    ? `${column}=in.(${ids.join(',')})`
    : undefined;

interface RealtimeDataState {
  machines: Machine[];
  machineLogs: MachineLog[];
  productionRecords: ProductionRecord[];
  /**
   * 설비별 지표. null 은 "계산하지 않음"(includeProductionRecords: false 이거나 아직 조회 전)이다.
   * {} 는 "설비가 하나도 없음"이라는 뜻이므로 둘을 섞으면 안 된다 — 섞는 순간 다시 0% 표시가 된다.
   * 개별 설비의 항목이 없으면 그 설비는 "OEE 계산 불가"다.
   */
  oeeMetrics: Record<string, OEEMetrics> | null;
  userProfile: User | null;
  loading: boolean;
  error: string | null;
  connectionStatus: 'connecting' | 'connected' | 'disconnected' | 'error';
  lastUpdated: number;
}

export const useRealtimeData = (
  userId?: string,
  userRole?: string,
  options?: UseRealtimeDataOptions
) => {
  const includeProductionRecords = options?.includeProductionRecords !== false;
  const includeMachineLogs = options?.includeMachineLogs !== false;
  const [state, setState] = useState<RealtimeDataState>({
    machines: [],
    machineLogs: [],
    productionRecords: [],
    // 조회 전에는 "지표 없음"이 아니라 "아직 모름"이다.
    oeeMetrics: null,
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
  // 운영자의 담당 설비 — 초기 조회에서 채워지고, 이후 구독 설정이 채널 필터로 쓴다.
  // undefined = 전체(관리자/엔지니어 또는 프로필 미조회).
  const assignedIdsRef = useRef<string[] | undefined>(undefined);

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
      // 구독은 초기 조회 완료 후에 연다 — 운영자 담당 설비 필터(assignedIdsRef)가
      // 프로필 조회로 채워진 뒤에야 채널에 적용될 수 있다.
      void loadInitialData().then(() => {
        if (isMountedRef.current) setupRealtimeSubscriptions();
      });
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

      const fetchRecentMachineLogs = async (): Promise<MachineLog[]> => {
        const pageSize = 1000;
        const recent: MachineLog[] = [];
        for (let offset = 0; offset < MAX_LOGS; offset += pageSize) {
          const { data, error } = await supabase
            .from('machine_logs')
            .select('*')
            .not('end_time', 'is', null)
            .gte('start_time', getLogWindowStart())
            .order('start_time', { ascending: false })
            .range(offset, Math.min(offset + pageSize - 1, MAX_LOGS - 1));
          if (error) throw error;
          recent.push(...((data || []) as MachineLog[]));
          if (!data || data.length < pageSize) break;
        }
        return recent;
      };

      // 열린 로그는 최근 N 제한과 분리한다. 오래 열린 설비도 현재 상태 계산에서 누락되지 않는다.
      // (기존에는 4개 쿼리를 순차적으로 await 하여 첫 화면 렌더링까지 불필요하게 오래 걸렸음)
      const userProfile = await fetchUserProfile();
      const assignedMachineIds = userRole === 'operator'
        ? (userProfile?.assigned_machines || [])
        : undefined;
      // 구독 설정(loadInitialData 완료 후 실행)이 채널 필터로 쓸 수 있게 심는다.
      assignedIdsRef.current = assignedMachineIds;

      const [machinesResult, openLogsResult, recentMachineLogs, productionRecords] = await Promise.all([
        supabase
          .from('machines')
          .select('*')
          .eq('is_active', true),
        // 쓰지 않을 데이터는 받지 않는다. 가장 빠른 조회는 실행하지 않는 조회다.
        includeMachineLogs
          ? supabase
              .from('machine_logs')
              .select('*')
              .is('end_time', null)
              .order('start_time', { ascending: false })
          : Promise.resolve({ data: [] as MachineLog[], error: null }),
        includeMachineLogs ? fetchRecentMachineLogs() : Promise.resolve([] as MachineLog[]),
        includeProductionRecords
          ? fetchAllRecentProductionRecords(assignedMachineIds)
          : Promise.resolve([] as ProductionRecord[])
      ]);

      // 설비 데이터
      const { data: machines, error: machinesError } = machinesResult;
      if (machinesError) throw machinesError;

      // 최근 설비 로그
      const { data: openLogs, error: openLogsError } = openLogsResult;
      if (openLogsError) throw openLogsError;
      const machineLogs = retainRecentAndOpenMachineLogs([
        ...recentMachineLogs,
        ...((openLogs || []) as MachineLog[])
      ]);

      // 설비별 OEE 지표.
      //
      // 계산 가능한 설비만 항목을 만든다. 예전에는 실적이 없는 설비에도 항목을 만들어
      // performance/quality/oee 를 0 으로, planned_runtime 을 480 으로 채워 넣었다.
      // 그 결과 (a) 아직 실적을 입력하지 않은 설비가 OEE 0.0% 인 것처럼 보였고,
      // (b) OperatorDashboard 의 OEE 탭에 이미 구현돼 있던 정직한 빈 상태
      //     ("생산 실적을 입력하면 OEE를 볼 수 있습니다")가 영원히 도달 불가능했다 —
      //     항목이 항상 존재해서 게이지가 늘 0% 로 그려졌기 때문이다.
      // 항목이 없으면 그 화면들이 알아서 빈 상태를 보여준다.
      //
      // 로그 기반으로 가용성만 따로 추정하던 코드도 함께 지웠다. 그 값은 하루 계획시간을
      // 480분으로 가정했는데 실제 교대 계획시간은 660분이라 근거가 없었고, 나머지 세 항목이
      // 0 인 지표에 섞여 들어가 결국 OEE 0% 를 만들 뿐이었다.
      const oeeMetrics: Record<string, OEEMetrics> | null = includeProductionRecords
        ? {}
        : null;
      if (machines && oeeMetrics) {
        machines.forEach(machine => {
          const machineRecords = productionRecords.filter(r => r.machine_id === machine.id);
          const latestRecord = findLatestRecord(machineRecords);
          const metrics = latestRecord ? toOeeMetrics(latestRecord) : null;
          if (metrics) {
            oeeMetrics[machine.id] = metrics;
          }
        });
      }

      if (!isMountedRef.current) return;

      setState(prev => ({
        ...prev,
        machines: machines || [],
        machineLogs: machineLogs || [],
        productionRecords,
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
        productionRecords: productionRecords.length,
        oeeMetrics: oeeMetrics ? Object.keys(oeeMetrics).length : '미조회'
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
  }, [scheduleReconnect, includeProductionRecords, includeMachineLogs]);

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

    // 운영자는 담당 설비 이벤트만 받는다 (담당이 소수일 때만 — buildRealtimeInFilter 참고).
    const assignedIds = assignedIdsRef.current;
    const machineIdFilter = buildRealtimeInFilter('machine_id', assignedIds);
    const machinePkFilter = buildRealtimeInFilter('id', assignedIds);

    // 설비 로그 실시간 구독 (초기 조회를 건너뛴 경우 구독도 하지 않는다 — 실적과 동일 규율)
    const machineLogsChannel = !includeMachineLogs ? null : supabase
      .channel('machine_logs_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'machine_logs',
          ...(machineIdFilter ? { filter: machineIdFilter } : {})
        },
        (payload) => {
          console.log('📊 Machine log 변경:', payload.eventType, (payload.new as Partial<MachineLog>).log_id);

          if (!isMountedRef.current) return;

          setState(prev => {
            const newLogs = applyRealtimeMachineLog(
              prev.machineLogs,
              payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE',
              payload.eventType === 'DELETE' ? undefined : payload.new as MachineLog,
              (payload.old as Partial<MachineLog>).log_id
            );

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

    // 생산 실적 실시간 구독.
    // 초기 조회를 건너뛴 경우(includeProductionRecords: false) 구독도 하지 않는다.
    // 구독만 살려두면 이벤트가 올 때마다 oeeMetrics 가 null(미조회)에서 부분 맵으로
    // 바뀌어, 조회한 적도 없는 지표가 생긴 것처럼 보인다.
    const productionChannel = !includeProductionRecords ? null : supabase
      .channel('production_records_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'production_records',
          ...(machineIdFilter ? { filter: machineIdFilter } : {})
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
            const metrics = latestRecord ? toOeeMetrics(latestRecord) : null;
            // 마지막 실적이 지워졌거나 미보고로 바뀌면 지표는 "계산 불가"가 된다.
            // 0% 로 남겨두면 설비가 멈춘 것처럼 보인다.
            if (metrics) {
              newOeeMetrics[affectedMachineId] = metrics;
            } else {
              delete newOeeMetrics[affectedMachineId];
            }

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
          table: 'machines',
          // machines 는 id 가 PK 라 DELETE 이벤트에도 필터가 적용된다.
          ...(machinePkFilter ? { filter: machinePkFilter } : {})
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

    // 채널 참조 저장 (생산 실적 구독은 옵션에 따라 없을 수 있다)
    const openedChannels: Array<RealtimeChannel | null> = [
      machineLogsChannel,
      productionChannel,
      machinesChannel
    ];
    channelsRef.current = openedChannels
      .filter((channel): channel is RealtimeChannel => channel !== null);

    console.log('🔗 실시간 구독 설정 완료');
  }, [cleanupChannels, updateConnectionStatus, scheduleReconnect, includeProductionRecords, includeMachineLogs]);

  // 실시간 구독 설정
  useEffect(() => {
    // 이펙트가 재실행되는 경우(StrictMode 재마운트 등)에도 마운트 상태를 다시 true로
    // 설정해야 한다. 그렇지 않으면 cleanup에서 false로 내려간 뒤 영원히 복구되지 않아
    // 이후의 모든 setState가 isMountedRef 가드에 막혀 버린다.
    isMountedRef.current = true;

    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      // 구독은 초기 조회 완료 후에 연다 (운영자 담당 설비 필터가 채워진 뒤).
      void loadInitialData().then(() => {
        if (isMountedRef.current) setupRealtimeSubscriptions();
      });
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
    void loadInitialData().then(() => {
      if (isMountedRef.current) setupRealtimeSubscriptions();
    });
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
