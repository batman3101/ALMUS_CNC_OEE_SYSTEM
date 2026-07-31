'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { Machine, MachineLog, ProductionRecord, OEEMetrics, User } from '@/types';
import { RealtimeChannel } from '@supabase/supabase-js';
import { authFetch } from '@/lib/authFetch';
import { replayBufferedUpdates } from './realtimeBuffer';
import { createReadinessGate, type ReadinessGate } from './subscriptionGate';

/**
 * 구독 준비를 기다리는 상한. 넘으면 스냅샷을 그냥 진행한다.
 *
 * 정상적으로는 수백 ms 안에 SUBSCRIBED 가 온다. 이 값은 "Realtime 이 죽었을 때 화면이
 * 얼마나 늦게 뜨는가"의 상한이고, 포기해도 잃는 것은 **원래 있던 그 유실 창**뿐이다.
 * 재연결 주기(5초)보다 짧게 잡아, 기다리다 재연결과 겹치지 않게 한다.
 */
const SUBSCRIPTION_READY_TIMEOUT_MS = 3000;

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
/**
 * 최근 창의 생산 실적을 모두 가져온다. 스코프는 **서버가** 건다.
 *
 * 예전에는 운영자일 때 담당 설비 배열을 받아 **설비마다 한 번씩** 이 API 를 불렀다.
 * `/api/oee-data` 가 운영자에게 `machine_id` 를 필수로 요구했기 때문이다. 그런데 이
 * 프로젝트의 운영자는 전원 800대를 배정받으므로 **800번의 순차 요청**이 됐고, 요청당
 * 200ms 만 잡아도 160초다 — 운영자 대시보드가 사실상 뜨지 않았다.
 *
 * 이제 라우트가 담당 설비 목록으로 직접 좁힌다(2026-07-31). 호출자는 스코프를 몰라도
 * 되고, 요청은 한 벌의 페이지네이션으로 끝난다.
 *
 * `include_statistics` 를 요청하지 않는 이유: 이 함수는 `oee_data` 행만 쓰고 통계 묶음은
 * 읽지 않는다. 게다가 담당 설비 스코프에서는 통계 RPC 가 설비를 하나만 받아 계산할 수
 * 없다(라우트가 400 으로 거절한다). `total` 은 통계 없이도 정확히 내려온다.
 */
export const fetchAllRecentProductionRecords = async (): Promise<ProductionRecord[]> => {
  const pageLimit = 5000;
  const records: ProductionRecord[] = [];
  let offset = 0;
  let knownTotal = 0;

  while (true) {
    const params = new URLSearchParams({
      start_date: getProductionWindowStart(),
      end_date: new Date().toISOString().split('T')[0],
      limit: String(pageLimit),
      offset: String(offset),
      include_statistics: 'false',
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
  // 구독 세대. cleanupChannels() 의 unsubscribe() 는 정리한 채널의 상태 콜백을 CLOSED 로
  // 발화시키고, 그 CLOSED 핸들러가 scheduleReconnect() 를 부른다. 재연결은 다시
  // setupRealtimeSubscriptions → cleanupChannels 로 이어져 5초마다 무한 반복됐다
  // (한 세션에서 501회 누적, oee-data 를 끝없이 재조회). 채널을 열 때 현재 세대를 캡처해
  // 상태 콜백에 실어 보내고, 콜백이 불릴 때 세대가 바뀌었으면(=우리가 이미 정리한 채널이면)
  // 무시한다. useRealtimeProgress 의 reqRef 와 같은 규율 — 늦게 도착한 콜백은 현재 상태에
  // 영향을 주면 안 된다.
  const subscriptionGenerationRef = useRef(0);
  // 로드 순번. 채널 세대(subscriptionGenerationRef)와는 **다른 축**이다 — 정상 로드는 자기
  // 사이클 안에서 afterScopeResolved → setup → cleanup 으로 세대를 올리므로, 세대로 비교하면
  // 정상 로드가 스스로를 취소한다. 늦게 끝난 옛 로드가 새 구독을 덮지 않게 하는 것이 목적이다.
  const loadSequenceRef = useRef(0);
  // 스냅샷이 아직 적용되지 않은 동안 도착한 구독 이벤트를 담아둔다.
  //
  // 왜 필요한가 — 구독은 스냅샷 조회보다 **먼저** 열린다(조회↔구독 갭 방지). 그래서 스냅샷
  // SELECT 가 도는 동안 이벤트가 먼저 도착할 수 있는데, 스냅샷 적용은 `machines`,
  // `machineLogs`, `productionRecords` 를 **배열째 교체**한다. 그 결과 먼저 반영해 둔 이벤트가
  // 통째로 지워졌다(Codex 감사 2026-07-29 #8). 구독을 먼저 여는 설계가 오히려 이 경로를 만들었다.
  //
  // loadSequenceRef 로는 못 막는다 — 그건 **로드끼리**의 경합을 다루는 축이고, 이건 한 번의
  // 로드와 그 로드가 연 구독 사이의 문제다.
  //
  // 해법: 스냅샷 적용 전에는 상태를 바로 바꾸지 않고 갱신 함수를 모아 두었다가, 스냅샷을
  // 교체한 **바로 그 갱신 안에서** 순서대로 재생한다. 스냅샷에 이미 반영된 이벤트를 다시
  // 재생해도 각 갱신이 id 기준이라 결과가 같다(멱등) — 중복 걱정 없이 전부 재생할 수 있다.
  const pendingRealtimeUpdatesRef = useRef<Array<(prev: RealtimeDataState) => RealtimeDataState>>([]);
  const snapshotAppliedRef = useRef(false);

  // 구독이 **실제로 준비될 때까지** 스냅샷을 미루는 게이트(적대적 재감사 #8).
  //
  // 위 버퍼는 "전달됐지만 아직 스냅샷이 없는" 이벤트를 담는다. 그런데 `subscribe()` 가
  // 비동기라, 스냅샷이 DB 를 읽은 뒤 `SUBSCRIBED` 가 오기 전에 커밋된 변경은 **전달 자체가
  // 되지 않는다.** 보존할 것이 없으니 버퍼로는 원리적으로 못 막는다. 순서를 바꿔 그 창을
  // 없애는 수밖에 없다. 자세한 근거는 `subscriptionGate.ts` 주석 참조.
  const readinessGateRef = useRef<ReadinessGate | null>(null);

  /** 스냅샷 적용 전이면 버퍼에 쌓고, 적용된 뒤면 곧바로 반영한다. */
  const applyRealtimeUpdate = useCallback(
    (updater: (prev: RealtimeDataState) => RealtimeDataState) => {
      if (!snapshotAppliedRef.current) {
        pendingRealtimeUpdatesRef.current.push(updater);
        return;
      }
      setState(updater);
    },
    []
  );

  /**
   * 스냅샷을 적용하면서 버퍼에 쌓인 이벤트를 이어서 재생한다.
   *
   * 목록을 setState **이전에** 꺼내 비우는 것이 중요하다. 갱신 함수는 나중에 실행되므로,
   * 그때 ref 를 읽으면 이미 비워진(혹은 새로 쌓인) 배열을 보게 된다.
   */
  const applySnapshot = useCallback((snapshot: (prev: RealtimeDataState) => RealtimeDataState) => {
    const buffered = pendingRealtimeUpdatesRef.current;
    pendingRealtimeUpdatesRef.current = [];
    snapshotAppliedRef.current = true;
    setState(prev => replayBufferedUpdates(snapshot(prev), buffered));
  }, []);
  // scheduleReconnect 는 순환 의존(setup → scheduleReconnect → load → scheduleReconnect) 때문에
  // deps 를 비워야 한다. 그 대가로 최초 렌더의 클로저를 영구히 붙잡아, 사용자·역할이 바뀐 뒤
  // 재연결하면 **이전 권한 범위**로 조회·구독한다. 최신 함수를 ref 로 건네 순환을 깨면서
  // 스코프는 최신으로 유지한다.
  const reconnectTargetRef = useRef<{
    load: (afterScopeResolved?: () => void) => Promise<void>;
    setup: () => void;
  } | null>(null);

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
      // 최신 함수를 ref 에서 읽는다 — 이 타임아웃 클로저는 최초 렌더에 고정돼 있으므로
      // 직접 참조하면 사용자·역할이 바뀐 뒤에도 그 이전의 loadInitialData/
      // setupRealtimeSubscriptions 를 계속 부른다(=이전 권한 범위로 재연결).
      const target = reconnectTargetRef.current;
      if (!target) return;
      console.log('🔄 실시간 연결 재시도...');
      updateConnectionStatus('connecting');
      // 담당 필터 확정 직후(스냅샷 조회 전) 구독을 연다 — 갭 이벤트 유실 방지.
      void target.load(target.setup);
    }, 5000); // 5초 후 재연결 시도
    // 의존성이 **완전하다**. 예전에는 loadInitialData/setupRealtimeSubscriptions 를 직접
    // 참조해 넣을 수가 없었고(넣으면 setup → scheduleReconnect → load → scheduleReconnect
    // 순환), 그래서 배열을 비운 채 경고를 안고 갔다. 이제 그 둘은 ref 로 읽으므로 클로저가
    // 직접 참조하지 않는다. 남은 updateConnectionStatus 는 useCallback([], …) 이라 안정적이라
    // 넣어도 scheduleReconnect 의 정체성이 바뀌지 않는다 — 순환도 재발하지 않는다.
  }, [updateConnectionStatus]);

  // 초기 데이터 로드 (성능 최적화)
  // afterScopeResolved: 담당 설비(assignedIdsRef)가 확정된 직후, 무거운 스냅샷 조회 **이전에**
  // 호출된다. 구독을 이 시점에 열면 (a) 필터가 준비돼 있고 (b) 스냅샷 SELECT 가 구독 이후에
  // 실행돼 그 사이 커밋된 변경을 모두 포함하므로 "조회↔구독 갭" 이벤트 유실이 없다(후속 #3).
  const loadInitialData = useCallback(async (afterScopeResolved?: () => void) => {
    if (!isMountedRef.current) return;
    // 이 호출의 순번을 캡처한다. loadInitialData 는 마운트, refresh(), scheduleReconnect 에서
    // 각각 독립적으로 불릴 수 있어, 먼저 시작한 호출이 await 사이에 더 새 호출에게 추월당할
    // 수 있다. 채널 세대(subscriptionGenerationRef)로는 못 막는다 — 정상 로드도 자기 사이클
    // 안에서(afterScopeResolved → setup → cleanup) 세대를 스스로 올리기 때문이다.
    // useRealtimeProgress 의 reqRef 와 같은 규율.
    const sequence = ++loadSequenceRef.current;
    // 이 로드의 스냅샷이 아직 적용되지 않았다. 지금부터 오는 이벤트는 버퍼에 쌓인다.
    // (refresh() 로 다시 부를 때도 마찬가지다 — 스냅샷은 언제 적용되든 배열을 교체하므로,
    //  그 사이 이벤트를 바로 반영하면 똑같이 지워진다)
    snapshotAppliedRef.current = false;
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

      // 스코프는 RLS 가 건다 (위 machinesQuery 주석 참고).
      const fetchRecentMachineLogs = async (): Promise<MachineLog[]> => {
        const pageSize = 1000;
        const recent: MachineLog[] = [];
        for (let offset = 0; offset < MAX_LOGS; offset += pageSize) {
          const query = supabase
            .from('machine_logs')
            .select('*')
            .not('end_time', 'is', null)
            .gte('start_time', getLogWindowStart());
          const { data, error } = await query
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
      // 더 새 로드가 이미 시작됐다 — 이 결과로 스코프를 확정하거나 afterScopeResolved 를
      // 불러 채널을 (이전 권한 범위로) 재구독하면 안 된다.
      if (sequence !== loadSequenceRef.current) return;
      const assignedMachineIds = userRole === 'operator'
        ? (userProfile?.assigned_machines || [])
        : undefined;
      // 구독이 채널 필터로 쓸 수 있게 심고, 곧바로 구독을 연다(스냅샷 조회보다 먼저).
      assignedIdsRef.current = assignedMachineIds;
      if (afterScopeResolved && isMountedRef.current) {
        afterScopeResolved();

        // 구독이 **실제로 준비된 뒤**에 스냅샷을 조회한다(적대적 재감사 #8).
        //
        // 예전에는 setup 호출 직후 곧바로 조회했다. `subscribe()` 는 비동기라 그 시점에
        // 채널은 아직 열리는 중이고, 스냅샷이 DB 를 읽은 뒤 SUBSCRIBED 가 오기 전에 커밋된
        // 변경은 **전달 자체가 되지 않는다.** 버퍼는 전달된 이벤트만 보존하므로 이 창은
        // 버퍼로 못 메운다 — 보존할 것이 없다.
        const gate = readinessGateRef.current;
        if (gate) {
          const outcome = await gate.wait();
          // 기다리는 동안 더 새 로드가 시작됐을 수 있다.
          if (sequence !== loadSequenceRef.current) return;
          if (!isMountedRef.current) return;
          if (outcome === 'timeout') {
            // 포기해도 잃는 것은 원래 있던 그 창뿐이다. 빈 화면이 훨씬 나쁘다.
            console.warn('⚠️ 실시간 구독 준비를 기다리다 시간 초과 — 스냅샷을 먼저 조회합니다');
          }
        }
      }

      // 스코프는 **DB 가 건다.** 클라이언트에서 다시 걸지 않는다.
      //
      // 예전 주석은 "RLS 가 authenticated 전체 조회를 아직 허용하므로 이 클라이언트
      // 스코프가 방어선"이라고 적혀 있었다. 그건 2026-07-29 마이그레이션
      // (20260729140000_scope_operational_reads)이 machines·machine_logs·
      // production_records 에 `Scoped read` 정책을 붙이면서 사실이 아니게 됐다. 지금은
      // 운영자에게 담당 설비 행만 돌아온다 — 정책이 `current_user_machines()` 로 좁힌다.
      //
      // 그런데 필터가 남아 있는 동안 방어가 두 겹이 된 게 아니라 **요청이 깨졌다.**
      // `.in('id', 800개)` 는 URL 이 약 30 KB 가 되고 게이트웨이가 400 으로 거절한다
      // (근거는 `@/lib/idFilter`). 운영자 대시보드가 뜨지 않던 원인 중 하나다.
      // 서비스 롤(RLS 우회)을 쓰는 API 라우트에서는 여전히 명시적 스코프가 필요하지만,
      // 여기 브라우저 클라이언트는 anon 키라 RLS 아래에 있다.
      const machinesQuery = supabase.from('machines').select('*').eq('is_active', true);

      const openLogsQuery = () =>
        supabase.from('machine_logs').select('*').is('end_time', null)
          .order('start_time', { ascending: false });

      const [machinesResult, openLogsResult, recentMachineLogs, productionRecords] = await Promise.all([
        machinesQuery,
        // 쓰지 않을 데이터는 받지 않는다. 가장 빠른 조회는 실행하지 않는 조회다.
        includeMachineLogs ? openLogsQuery() : Promise.resolve({ data: [] as MachineLog[], error: null }),
        includeMachineLogs ? fetchRecentMachineLogs() : Promise.resolve([] as MachineLog[]),
        includeProductionRecords
          ? fetchAllRecentProductionRecords()
          : Promise.resolve([] as ProductionRecord[])
      ]);
      // 더 새 로드가 이미 시작됐다 — 이 결과로 상태를 덮지 않는다(늦게 끝난 옛 로드가
      // 새 구독의 결과를 이전 권한 범위 데이터로 덮어쓰는 것을 막는다).
      if (sequence !== loadSequenceRef.current) return;

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

      // 배열을 통째로 교체하되, 스냅샷 조회 중 도착한 이벤트를 그 위에 이어서 재생한다.
      applySnapshot(prev => ({
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
      // 더 새 로드가 이미 시작(또는 성공)됐다면 이 실패는 stale 이다 — 새 로드의 성공 상태를
      // error 로 덮어쓰거나, 이미 회복된 연결에 불필요한 재연결을 또 예약하면 안 된다.
      if (sequence !== loadSequenceRef.current) return;

      // 스냅샷은 못 받았지만 버퍼를 계속 쌓아두면 안 된다 — 그러면 이후 모든 실시간 이벤트가
      // 영원히 화면에 닿지 못한다. 실패한 스냅샷 대신 **기존 상태 위에** 버퍼를 재생하고
      // 버퍼링을 해제한다. 재연결이 성공하면 그때 스냅샷이 다시 배열을 맞춘다.
      applySnapshot(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : '데이터 로드에 실패했습니다.',
        connectionStatus: 'error'
      }));

      // 에러 발생시 자동 재연결 스케줄
      scheduleReconnect();
    }
    // userId/userRole 을 deps 에 포함해야 사용자 전환 후 이전 담당 설비로 조회하는
    // stale closure 를 피한다(후속 MEDIUM). 이 함수가 재생성되면 mount effect 도 재실행된다.
    // applySnapshot 은 useCallback([], …) 이라 정체성이 안정적이다 — deps 에 넣어도
    // loadInitialData 가 매 렌더 재생성되지 않는다(=mount effect 도 재실행되지 않는다).
  }, [applySnapshot, scheduleReconnect, includeProductionRecords, includeMachineLogs, userId, userRole]);

  // 채널 정리 함수
  const cleanupChannels = useCallback(() => {
    // unsubscribe() 보다 먼저 세대를 올린다 — 이후 발화하는 상태 콜백은 모두 이전 세대다.
    subscriptionGenerationRef.current += 1;
    // 아직 재생하지 못한 이벤트는 버린다. 사용자·역할이 바뀌어 재구독하는 경우, 이전 담당
    // 설비의 이벤트를 새 스냅샷 위에 재생하면 담당 밖 데이터가 목록에 섞인다. 버려도
    // 유실되지 않는다 — 새 구독은 새 스냅샷 조회보다 먼저 열리므로 그 사이가 비지 않는다.
    pendingRealtimeUpdatesRef.current = [];
    // 이 세대를 기다리던 로드가 있으면 풀어 준다. 정리된 채널은 SUBSCRIBED 를 주지 않으므로,
    // 풀지 않으면 그 로드가 타임아웃까지 매달린다(언마운트 시에는 영영).
    readinessGateRef.current?.cancel();
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
      // 열 채널이 없으므로 기다릴 것도 없다. 게이트를 비워 두면 스냅샷이 타임아웃만큼
      // 헛되이 지연된다 — 데모/미설정 환경에서 3초씩 빈 화면이 뜨게 된다.
      readinessGateRef.current = createReadinessGate(0, SUBSCRIPTION_READY_TIMEOUT_MS);
      return;
    }

    console.log('🔗 실시간 구독 설정 시작...');

    // 기존 채널 정리 (이 호출로 세대가 하나 올라간다 — cleanupChannels 참고)
    cleanupChannels();
    // 지금부터 여는 채널들이 속한 세대. 아래 각 상태 콜백은 자신이 열릴 때의 세대를
    // 클로저로 들고 있다가, 불릴 때 subscriptionGenerationRef.current 와 비교한다.
    const generation = subscriptionGenerationRef.current;

    // 이번 세대에 열 채널 수만큼 게이트를 세운다. 조건부 채널(옵션으로 끈 경우)까지 세면
    // 오지 않을 SUBSCRIBED 를 기다리다 매번 타임아웃한다 — 게이트가 있으나 마나 해진다.
    const expectedChannels =
      1 + (includeMachineLogs ? 1 : 0) + (includeProductionRecords ? 1 : 0);
    const readinessGate = createReadinessGate(expectedChannels, SUBSCRIPTION_READY_TIMEOUT_MS);
    readinessGateRef.current = readinessGate;

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
          // 실제 unsubscribe() 는 비동기다 — 해제 중인 이전 세대 채널도 이 payload 콜백을
          // 발화시킬 수 있다. 아래 상태 콜백과 동일한 세대 가드를 여기에도 건다.
          if (generation !== subscriptionGenerationRef.current) return;

          applyRealtimeUpdate(prev => {
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
        // 이 채널이 이미 cleanupChannels() 로 정리된 이전 세대라면(=unsubscribe 가
        // 발화시킨 CLOSED 등), 지금 상태를 반영하거나 재연결을 재장전하면 안 된다.
        if (generation !== subscriptionGenerationRef.current) return;
        if (status === 'SUBSCRIBED') {
          console.log('✅ Machine logs 실시간 구독 성공');
          updateConnectionStatus('connected');
          readinessGate.markReady();
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Machine logs 구독 오류:', error);
          updateConnectionStatus('error');
          scheduleReconnect();
          // 이 채널은 영영 준비되지 않는다. 게이트를 풀지 않으면 스냅샷이 타임아웃까지
          // 통째로 지연된다 — 한 채널의 실패가 화면 전체를 늦추게 둘 이유가 없다.
          readinessGate.cancel();
        } else if (status === 'CLOSED') {
          console.warn('⚠️ Machine logs 구독 연결 종료');
          updateConnectionStatus('disconnected');
          scheduleReconnect();
          readinessGate.cancel();
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
          // machine_logs 핸들러와 동일한 세대 가드 — 해제 중인 이전 채널의 이벤트는 무시한다.
          if (generation !== subscriptionGenerationRef.current) return;

          applyRealtimeUpdate(prev => {
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
        // machine_logs 채널과 동일한 세대 가드 — 정리된 이전 세대의 콜백은 무시한다.
        if (generation !== subscriptionGenerationRef.current) return;
        if (status === 'SUBSCRIBED') {
          readinessGate.markReady();
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Production records 구독 오류:', error);
          scheduleReconnect();
          readinessGate.cancel();
        } else if (status === 'CLOSED') {
          console.warn('⚠️ Production records 구독 연결 종료');
          scheduleReconnect();
          readinessGate.cancel();
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
          // 위와 동일한 세대 가드 — 해제 중인 이전 채널의 이벤트는 무시한다.
          if (generation !== subscriptionGenerationRef.current) return;

          applyRealtimeUpdate(prev => {
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
        // machine_logs 채널과 동일한 세대 가드 — 정리된 이전 세대의 콜백은 무시한다.
        if (generation !== subscriptionGenerationRef.current) return;
        if (status === 'SUBSCRIBED') {
          readinessGate.markReady();
        } else if (status === 'CHANNEL_ERROR') {
          console.error('❌ Machines 구독 오류:', error);
          scheduleReconnect();
          readinessGate.cancel();
        } else if (status === 'CLOSED') {
          console.warn('⚠️ Machines 구독 연결 종료');
          scheduleReconnect();
          readinessGate.cancel();
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
    // applyRealtimeUpdate 도 useCallback([], …) 이라 안정적이다 — 재구독을 유발하지 않는다.
  }, [applyRealtimeUpdate, cleanupChannels, updateConnectionStatus, scheduleReconnect, includeProductionRecords, includeMachineLogs]);

  // scheduleReconnect 의 순환 의존(setup → scheduleReconnect → load → scheduleReconnect)을 깨기
  // 위해 deps 를 비워뒀다. 그 타임아웃 클로저가 최초 렌더에 고정되지 않도록, 매 렌더 후
  // (deps 없는 이펙트) 최신 loadInitialData/setupRealtimeSubscriptions 를 ref 에 담아둔다.
  useEffect(() => {
    reconnectTargetRef.current = { load: loadInitialData, setup: setupRealtimeSubscriptions };
  });

  // 실시간 구독 설정
  useEffect(() => {
    // 이펙트가 재실행되는 경우(StrictMode 재마운트 등)에도 마운트 상태를 다시 true로
    // 설정해야 한다. 그렇지 않으면 cleanup에서 false로 내려간 뒤 영원히 복구되지 않아
    // 이후의 모든 setState가 isMountedRef 가드에 막혀 버린다.
    isMountedRef.current = true;

    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      // 담당 필터 확정 직후(스냅샷 조회 전) 구독을 연다 (갭 유실 방지).
      void loadInitialData(setupRealtimeSubscriptions);
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
    void loadInitialData(setupRealtimeSubscriptions);
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
