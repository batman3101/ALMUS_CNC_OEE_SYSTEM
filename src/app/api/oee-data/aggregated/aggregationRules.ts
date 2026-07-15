export type AggregationPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface TrendPoint {
  period: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
}

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

export function isoWeek(dateOnly: string): { key: string; label: string } {
  const [year, month, day] = dateOnly.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - weekday);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return {
    key: `${isoYear}-W${String(week).padStart(2, '0')}`,
    label: `${isoYear}년 ${week}주`,
  };
}

export function calculateChronologicalTrend(
  data: TrendPoint[],
  key: keyof Omit<TrendPoint, 'period'>
): number {
  if (data.length < 2) return 0;
  const sorted = [...data].sort((a, b) => a.period.localeCompare(b.period));
  const split = Math.ceil(sorted.length / 2);
  const older = sorted.slice(0, split);
  const recent = sorted.slice(split);
  if (recent.length === 0) return 0;
  const average = (items: TrendPoint[]) =>
    items.reduce((sum, item) => sum + item[key], 0) / items.length;
  const olderAverage = average(older);
  if (olderAverage === 0) return 0;
  return ((average(recent) - olderAverage) / olderAverage) * 100;
}

export function sortPeriodsChronologically<T extends { period: string }>(data: T[]): T[] {
  return [...data].sort((left, right) => left.period.localeCompare(right.period));
}
