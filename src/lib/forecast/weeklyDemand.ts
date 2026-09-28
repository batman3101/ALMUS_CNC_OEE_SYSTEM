import type { ForecastSourceRow } from '@/types/forecast';

export interface ForecastWeek { key: string; label: string; start: string; end: string; dates: string[]; partial: boolean }
export type DemandWarning = 'error_cells' | 'fractional' | 'partial_week' | 'no_numeric' | 'duplicate_rows';
export interface WeeklyModelDemand {
  model: string; week: string; peakQuantity: number; peakDate: string | null;
  numericDays: number; blankCells: number; errorCells: number; fractional: boolean; warnings: DemandWarning[];
}

const DAY = 86_400_000;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Monday-start week containing the date, numbered by ISO 8601 (week 1 holds the first Thursday). */
export function isoWeek(date: string): { year: number; week: number; monday: string } {
  const ms = utc(date);
  const monday = ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY;
  const thursday = monday + 3 * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.ceil(((thursday - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return { year, week, monday: iso(monday) };
}

export function groupWeeks(dates: string[]): ForecastWeek[] {
  const weeks = new Map<string, ForecastWeek>();
  for (const date of [...dates].sort()) {
    const { year, week, monday } = isoWeek(date);
    const label = `W${String(week).padStart(2, '0')}`;
    const key = `${year}-${label}`;
    let entry = weeks.get(key);
    if (!entry) { entry = { key, label, start: monday, end: iso(utc(monday) + 6 * DAY), dates: [], partial: false }; weeks.set(key, entry); }
    entry.dates.push(date);
  }
  for (const week of weeks.values()) week.partial = week.dates.length < 7;
  return [...weeks.values()];
}

/**
 * Peak daily quantity per model inside one week (user decision 2026-09-25: the week's busiest day,
 * not its total or average). Same-model rows are summed per date first (PRD 6.2).
 * Blank = 0; error cells are counted and flagged, never silently zero; fractions round up.
 */
export function weeklyModelDemand(rows: ForecastSourceRow[], week: ForecastWeek): WeeklyModelDemand[] {
  const inWeek = new Set(week.dates);
  const models = new Map<string, { daily: Map<string, number>; blank: number; error: number; fractional: boolean; duplicate: boolean }>();
  for (const row of rows) {
    if (!row.model || !row.processes.length) continue;
    let entry = models.get(row.model);
    if (!entry) { entry = { daily: new Map(), blank: 0, error: 0, fractional: false, duplicate: false }; models.set(row.model, entry); }
    if (row.issues.includes('duplicate_row')) entry.duplicate = true;
    for (const q of row.quantities) {
      if (!inWeek.has(q.date)) continue;
      if (q.state === 'blank') { entry.blank++; continue; }
      if (q.state !== 'number' || q.quantity === null) { entry.error++; continue; }
      if (!Number.isInteger(q.quantity)) entry.fractional = true;
      entry.daily.set(q.date, (entry.daily.get(q.date) ?? 0) + q.quantity);
    }
  }
  return [...models.entries()].map(([model, entry]) => {
    let peak = 0; let peakDate: string | null = null;
    for (const date of week.dates) { const value = entry.daily.get(date); if (value !== undefined && value > peak) { peak = value; peakDate = date; } }
    const warnings: DemandWarning[] = [];
    if (entry.error) warnings.push('error_cells');
    if (entry.fractional) warnings.push('fractional');
    if (entry.duplicate) warnings.push('duplicate_rows');
    if (week.partial) warnings.push('partial_week');
    if (!entry.daily.size) warnings.push('no_numeric');
    return { model, week: week.key, peakQuantity: Math.ceil(peak), peakDate, numericDays: entry.daily.size, blankCells: entry.blank, errorCells: entry.error, fractional: entry.fractional, warnings };
  }).sort((a, b) => a.model.localeCompare(b.model));
}
