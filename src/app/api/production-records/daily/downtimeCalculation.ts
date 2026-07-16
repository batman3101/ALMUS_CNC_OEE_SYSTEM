import { clipInterval, totalMinutes, type Interval } from '@/utils/downtimeIntervals';

export interface DowntimeSourceInterval {
  start_time: string;
  end_time: string | null;
  is_planned?: boolean;
}

/**
 * 비가동 항목이 0건이면 실제로 비가동이 없었던 것으로 본다.
 *
 * 현장은 비가동이 발생했을 때만 기록한다. "비가동이 없었음"을 매 교대마다 별도로
 * 확인/체크하도록 요구하면 지켜지지 않고, 정상 가동한 설비가 계산 보류(NULL)로
 * 남는다. 2026-07-16 실제로 396건(전체 10.3%)이 이 이유로 OEE 미계산 상태였고
 * 화면에는 0.0% 로 표시됐다.
 *
 * 단, `measuredMinutes === null` 은 다른 종류의 모름이다 — 비가동 조회 자체가
 * 실패했다는 뜻이므로 0 으로 단정하지 않고 NULL 을 유지한다. "0건 조회됨"과
 * "조회 못함"을 섞으면 안 된다.
 */
export function resolveConfirmedDowntimeMinutes(
  measuredMinutes: number | null
): number | null {
  if (measuredMinutes === null) return null;
  return measuredMinutes > 0 ? measuredMinutes : 0;
}

/**
 * Calculates the interval union inside one shift. An ongoing event ends at
 * `nowMs` for the current shift and at the shift boundary for a completed one.
 * Overlapping manual and automatic events are counted once.
 */
export function calculateDowntimeMinutesForWindow(
  rows: DowntimeSourceInterval[],
  window: Interval,
  nowMs = Date.now()
): number {
  const intervals = rows.flatMap(row => {
    const start = Date.parse(row.start_time);
    const rawEnd = row.end_time ? Date.parse(row.end_time) : nowMs;
    if (!Number.isFinite(start) || !Number.isFinite(rawEnd)) return [];
    const end = Math.min(rawEnd, window.end);
    if (end <= start) return [];
    return clipInterval({ start, end }, [window]);
  });

  return totalMinutes(intervals);
}

/**
 * The legacy configuration stores only a break duration, not exact break
 * intervals. If a planned-stop event exists in the same shift we cannot know
 * how much overlaps the scheduled break. Returning null prevents double
 * subtraction and marks OEE as incomplete until exact break windows exist.
 */
export function calculateVerifiedDowntimeMinutesForWindow(
  rows: DowntimeSourceInterval[],
  window: Interval,
  breakMinutes: number,
  nowMs = Date.now()
): number | null {
  if (
    breakMinutes > 0 &&
    rows.some(row => row.is_planned && calculateDowntimeMinutesForWindow([row], window, nowMs) > 0)
  ) {
    return null;
  }
  return calculateDowntimeMinutesForWindow(rows, window, nowMs);
}
