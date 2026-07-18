'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authFetch';

interface UseRealtimeProgressArgs {
  machineId: string | null;
  date: string;
  shift: 'A' | 'B';
}

interface UseRealtimeProgressResult {
  /** null = 아직 모름(조회 전/실패) 또는 보고 없음. 0 과 구분한다. */
  lastReportedQty: number | null;
  lastReportedAt: string | null;
  /** null = 조회 실패. "비가동 0분"과 구분해야 한다. */
  downtimeMinutes: number | null;
  /** 개당 가공시간(초). null 이면 성능률을 계산할 수 없다. 서버가 뷰에서 해결해 준다. */
  tactTimeSeconds: number | null;
  /**
   * 관리자가 설정한 휴식 총량이 shiftBreaks 의 시간대 합계와 일치하는지.
   * false 면 실시간 지표를 계산하면 안 된다 — 틀린 숫자보다 없는 숫자가 낫다.
   */
  breakConfigMatches: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * 교대 중 진행 상태 조회.
 *
 * 실패를 0 으로 채우지 않는다. "비가동 0분"과 "비가동을 못 읽었다"는 다르고, 섞으면
 * 가동률이 100% 인 것처럼 보인다.
 *
 * 요청 순번(reqRef) 가드로 두 성질을 지킨다:
 *  1. 인자(machineId/date/shift)가 빠르게 바뀌어 두 조회가 경쟁하면, 뒤늦게 도착한
 *     오래된 응답이 최신 상태를 덮지 않는다. (안 그러면 새 설비 화면에 옛 설비 데이터가 뜬다)
 *  2. 언마운트 후에는 어떤 setState 도 하지 않는다. (refresh 가 저장·폴링과 자주 겹쳐 불려
 *     조회 도중 언마운트가 실제로 발생한다 — CLAUDE.md 의 마운트 가드 규율)
 * refresh 는 명령형으로도 불리므로 effect 스코프 ignore 플래그로는 부족하다. ref 로 잡는다.
 */
export function useRealtimeProgress({ machineId, date, shift }: UseRealtimeProgressArgs): UseRealtimeProgressResult {
  const [lastReportedQty, setLastReportedQty] = useState<number | null>(null);
  const [lastReportedAt, setLastReportedAt] = useState<string | null>(null);
  const [downtimeMinutes, setDowntimeMinutes] = useState<number | null>(null);
  const [tactTimeSeconds, setTactTimeSeconds] = useState<number | null>(null);
  // 조회 전에는 일치를 가정하지 않는다. false 로 시작해 서버가 확인해 줄 때만 켠다.
  const [breakConfigMatches, setBreakConfigMatches] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 요청 순번. 새 요청마다 ++, 언마운트 때도 ++ 해서 진행 중 요청을 모두 무효화한다.
  const reqRef = useRef(0);

  const fetchProgress = useCallback(async () => {
    if (!machineId) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ machine_id: machineId, date, shift });
      const res = await authFetch(`/api/production-progress?${params}`, { cache: 'no-store' });
      // 더 새로운 요청이 떴거나 언마운트됐다 — 이 결과는 버린다.
      if (reqId !== reqRef.current) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = await res.json() as {
        last_report: { shift_output_qty: number; reported_at: string } | null;
        // null = 계획정지·휴식 겹침으로 계산 보류 (확정 OEE 와 동일 계약). 0 과 구분한다.
        downtime_minutes: number | null;
        tact_time_seconds: number | null;
        break_config_matches: boolean;
      };
      if (reqId !== reqRef.current) return;

      setLastReportedQty(body.last_report?.shift_output_qty ?? null);
      setLastReportedAt(body.last_report?.reported_at ?? null);
      setDowntimeMinutes(body.downtime_minutes);
      setTactTimeSeconds(body.tact_time_seconds);
      setBreakConfigMatches(body.break_config_matches);
    } catch (e) {
      if (reqId !== reqRef.current) return;
      setError(e instanceof Error ? e.message : 'Unknown error');
      // 조회에 실패하면 이전 성공값이 "현재 상태"처럼 남지 않게 모두 비운다.
      // 특히 downtime 을 0 이 아니라 null 로 돌려, "비가동 없음"으로 오독되지 않게 한다.
      setLastReportedQty(null);
      setLastReportedAt(null);
      setDowntimeMinutes(null);
      setTactTimeSeconds(null);
      setBreakConfigMatches(false);
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  }, [machineId, date, shift]);

  useEffect(() => { void fetchProgress(); }, [fetchProgress]);

  // 설비/일자/교대가 바뀌면 이전 설비의 값이 새 응답 도착 전까지 창에 남지 않게 즉시 비운다.
  // reqRef 는 뒤늦게 온 stale 응답의 덮어쓰기만 막을 뿐 "빈 창"을 만들지는 못한다. 이 초기화가
  // 없으면 A 설비의 누적 보고값이 B 설비 모달의 초기값으로 새어 B 에 잘못 저장될 수 있다.
  // deps 를 [machineId, date, shift] 로 좁혀 폴링 refresh(같은 인자)에는 걸리지 않게 한다 —
  // 안 그러면 매 틱 null 로 깜빡인다.
  useEffect(() => {
    setLastReportedQty(null);
    setLastReportedAt(null);
    setDowntimeMinutes(null);
    setTactTimeSeconds(null);
    setBreakConfigMatches(false);
    setError(null);
  }, [machineId, date, shift]);

  // 언마운트 시 진행 중 요청을 모두 무효화한다 (마운트 해제 후 setState 금지).
  useEffect(() => () => { reqRef.current++; }, []);

  return {
    lastReportedQty, lastReportedAt, downtimeMinutes, tactTimeSeconds, breakConfigMatches,
    loading, error, refresh: fetchProgress,
  };
}
