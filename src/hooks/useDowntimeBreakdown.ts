'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authFetch';
import type {
  DowntimeBreakdownRow,
  DowntimeBreakdownResponse,
  DowntimeShiftTotal,
} from '@/utils/downtimeBreakdown';

interface Args {
  machineId: string | null;
  date: string;
}

interface Result {
  /** null = 계산 보류(계획정지·휴식 겹침) 또는 아직 조회 전. 0 과 구분한다. */
  totalMinutes: number | null;
  /** 주간/야간 소계. null = 아직 조회 전 또는 실패. */
  shiftTotals: { day: DowntimeShiftTotal; night: DowntimeShiftTotal } | null;
  /** 진행 중 비가동의 클립되지 않은 시작(ISO). null = 진행 중인 비가동 없음. */
  ongoingSince: string | null;
  intervals: DowntimeBreakdownRow[];
  /** 조회를 한 번이라도 성공했는가. "0건"과 "아직 모름"을 구분하는 데 쓴다. */
  loaded: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * 이 업무일의 비가동 누적 + 건별 내역 조회.
 *
 * 실패를 0 이나 빈 배열로 채우지 않는다. "비가동 0건"과 "조회 실패"는 다르고, 섞으면
 * 멈춰 있는 설비가 멀쩡해 보인다. loaded 플래그로 둘을 구분한다.
 *
 * 요청 순번(reqRef) 가드는 useRealtimeProgress 와 같은 이유로 둔다: 설비를 빠르게 바꾸면
 * 옛 설비의 응답이 늦게 도착해 새 화면을 덮을 수 있고, refresh 가 폴링과 겹쳐 불려
 * 조회 도중 언마운트가 실제로 일어난다.
 */
export function useDowntimeBreakdown({ machineId, date }: Args): Result {
  const [totalMinutes, setTotalMinutes] = useState<number | null>(null);
  const [shiftTotals, setShiftTotals] = useState<Result['shiftTotals']>(null);
  const [ongoingSince, setOngoingSince] = useState<string | null>(null);
  const [intervals, setIntervals] = useState<DowntimeBreakdownRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqRef = useRef(0);

  const fetchBreakdown = useCallback(async () => {
    if (!machineId) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date });
      const res = await authFetch(
        `/api/machines/${machineId}/downtime?${params}`,
        { cache: 'no-store' }
      );
      if (reqId !== reqRef.current) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = await res.json() as DowntimeBreakdownResponse;
      if (reqId !== reqRef.current) return;

      setTotalMinutes(body.total_minutes);
      setShiftTotals(body.shift_totals);
      setOngoingSince(body.ongoing_since);
      setIntervals(body.intervals ?? []);
      setLoaded(true);
    } catch (e) {
      if (reqId !== reqRef.current) return;
      setError(e instanceof Error ? e.message : 'Unknown error');
      // 실패한 조회의 결과가 "현재 상태"처럼 남지 않게 비운다. loaded 를 내려
      // 화면이 "0건"이 아니라 오류를 보여주게 한다.
      setTotalMinutes(null);
      setShiftTotals(null);
      setOngoingSince(null);
      setIntervals([]);
      setLoaded(false);
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  }, [machineId, date]);

  useEffect(() => { void fetchBreakdown(); }, [fetchBreakdown]);

  // 설비·일자가 바뀌면 이전 값이 새 응답 도착 전까지 남지 않게 즉시 비운다.
  // deps 를 좁혀 폴링 refresh(같은 인자)에는 걸리지 않게 한다 — 안 그러면 매 틱 깜빡인다.
  useEffect(() => {
    setTotalMinutes(null);
    setShiftTotals(null);
    setOngoingSince(null);
    setIntervals([]);
    setLoaded(false);
    setError(null);
  }, [machineId, date]);

  // 언마운트 시 진행 중 요청을 모두 무효화한다 (마운트 해제 후 setState 금지).
  useEffect(() => () => { reqRef.current++; }, []);

  return {
    totalMinutes, shiftTotals, ongoingSince, intervals,
    loaded, loading, error, refresh: fetchBreakdown,
  };
}
