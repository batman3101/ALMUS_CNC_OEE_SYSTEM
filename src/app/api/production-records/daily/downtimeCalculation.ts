import { clipInterval, totalMinutes, type Interval } from '@/utils/downtimeIntervals';

export interface DowntimeSourceInterval {
  start_time: string;
  end_time: string | null;
  is_planned?: boolean;
}

/** Empty rows prove only that no event was saved, not that the operator checked
 * the whole shift. Keep runtime unknown until zero downtime is confirmed. */
export function resolveConfirmedDowntimeMinutes(
  measuredMinutes: number | null,
  zeroDowntimeConfirmed: boolean
): number | null {
  if (measuredMinutes === null) return null;
  if (measuredMinutes > 0) return measuredMinutes;
  return zeroDowntimeConfirmed ? 0 : null;
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
