import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

export interface Interval {
  start: number;
  end: number;
}

export interface DowntimeIntervalEntry extends Interval {
  id: string;
  machineId: string;
  businessDate: string;
  shift: string;
}

export interface AllocatedDowntimeEntry<T extends DowntimeIntervalEntry = DowntimeIntervalEntry> {
  entry: T;
  id: string;
  intervals: Interval[];
}

interface ShiftWindowOptions {
  startDate: string;
  endDate: string;
  timezone: string;
  shiftAStart: string;
  shiftBStart: string;
  requestedShifts?: string[] | null;
}

const parseTime = (value: string): [number, number] => {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) throw new Error(`Invalid shift time: ${value}`);

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    throw new Error(`Invalid shift time: ${value}`);
  }
  return [hour, minute];
};

const atLocalTime = (
  date: string,
  timezoneName: string,
  time: string
) => {
  const [hour, minute] = parseTime(time);
  const result = dayjs.tz(date, timezoneName)
    .hour(hour)
    .minute(minute)
    .second(0)
    .millisecond(0);

  if (!result.isValid()) throw new Error(`Invalid business date: ${date}`);
  return result;
};

export const mergeIntervals = (intervals: Interval[]): Interval[] => {
  const sorted = intervals
    .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end))
    .filter(interval => interval.end > interval.start)
    .map(interval => ({ ...interval }))
    .sort((left, right) => left.start - right.start || left.end - right.end);

  if (sorted.length === 0) return [];

  const merged: Interval[] = [sorted[0]];
  for (let index = 1; index < sorted.length; index++) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];
    if (current.start > previous.end) {
      merged.push(current);
    } else {
      previous.end = Math.max(previous.end, current.end);
    }
  }

  return merged;
};

export const subtractIntervals = (base: Interval[], cut: Interval[]): Interval[] => {
  const cuts = mergeIntervals(cut);
  const result: Interval[] = [];

  for (const interval of mergeIntervals(base)) {
    let cursor = interval.start;
    for (const removed of cuts) {
      if (removed.end <= cursor) continue;
      if (removed.start >= interval.end) break;
      if (removed.start > cursor) {
        result.push({ start: cursor, end: Math.min(removed.start, interval.end) });
      }
      cursor = Math.max(cursor, removed.end);
      if (cursor >= interval.end) break;
    }
    if (cursor < interval.end) result.push({ start: cursor, end: interval.end });
  }

  return result;
};

export const clipInterval = (interval: Interval, windows: Interval[]): Interval[] => {
  const intersections: Interval[] = [];
  for (const window of windows) {
    const start = Math.max(interval.start, window.start);
    const end = Math.min(interval.end, window.end);
    if (end > start) intersections.push({ start, end });
  }
  return mergeIntervals(intersections);
};

export const totalMinutes = (intervals: Interval[]): number =>
  Math.round(
    (mergeIntervals(intervals).reduce(
      (sum, interval) => sum + interval.end - interval.start,
      0
    ) /
      60000) *
      100
  ) / 100;

export const buildBusinessRange = (
  startDate: string,
  endDate: string,
  timezoneName: string,
  shiftAStart: string
): Interval => {
  const start = atLocalTime(startDate, timezoneName, shiftAStart);
  const finalBusinessDayStart = atLocalTime(endDate, timezoneName, shiftAStart);
  if (finalBusinessDayStart.isBefore(start)) {
    throw new Error('endDate must not be before startDate');
  }

  return {
    start: start.valueOf(),
    end: finalBusinessDayStart.add(1, 'day').valueOf(),
  };
};

export const buildShiftWindows = ({
  startDate,
  endDate,
  timezone: timezoneName,
  shiftAStart,
  shiftBStart,
  requestedShifts,
}: ShiftWindowOptions): Interval[] => {
  const businessRange = buildBusinessRange(
    startDate,
    endDate,
    timezoneName,
    shiftAStart
  );
  const selected = new Set(
    (requestedShifts ?? ['A', 'B']).map(shift => shift.trim().toUpperCase())
  );
  if (selected.size === 0) return [businessRange];

  const windows: Interval[] = [];
  let cursor = dayjs.tz(startDate, timezoneName).startOf('day');
  const lastDate = dayjs.tz(endDate, timezoneName).startOf('day');

  while (cursor.valueOf() <= lastDate.valueOf()) {
    const date = cursor.format('YYYY-MM-DD');
    const aStart = atLocalTime(date, timezoneName, shiftAStart);
    const bStart = atLocalTime(date, timezoneName, shiftBStart);

    if (selected.has('A')) {
      windows.push({ start: aStart.valueOf(), end: bStart.valueOf() });
    }
    if (selected.has('B')) {
      windows.push({
        start: bStart.valueOf(),
        end: aStart.add(1, 'day').valueOf(),
      });
    }

    cursor = cursor.add(1, 'day');
  }

  return mergeIntervals(
    windows.flatMap(window => clipInterval(window, [businessRange]))
  );
};

/**
 * Allocate overlapping manual downtime deterministically inside one
 * machine/business-date/shift scope. Earlier-starting entries own an overlap;
 * later entries keep only their still-unclaimed intervals. This makes the sum
 * of all returned rows equal to the interval union while preserving a stable
 * reason attribution rule.
 */
export const allocateDowntimeIntervals = <T extends DowntimeIntervalEntry>(
  entries: T[]
): Array<AllocatedDowntimeEntry<T>> => {
  const ordered = entries
    .map((entry, originalIndex) => ({ entry, originalIndex }))
    .sort(
      (left, right) =>
        left.entry.start - right.entry.start || left.originalIndex - right.originalIndex
    );
  const claimedByScope = new Map<string, Interval[]>();

  return ordered.map(({ entry }) => {
    const scope = `${entry.machineId}\u0000${entry.businessDate}\u0000${entry.shift}`;
    const claimed = claimedByScope.get(scope) ?? [];
    const intervals = subtractIntervals(
      [{ start: entry.start, end: entry.end }],
      claimed
    );

    claimedByScope.set(
      scope,
      mergeIntervals([...claimed, { start: entry.start, end: entry.end }])
    );

    return { entry, id: entry.id, intervals };
  });
};
