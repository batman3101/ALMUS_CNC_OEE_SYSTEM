import { readFileSync } from 'node:fs';
import type { ForecastSourceRow } from '@/types/forecast';
import { parseForecastFile } from '../parseForecast';
import { groupWeeks, isoWeek, weeklyModelDemand } from '../weeklyDemand';

const row = (model: string, quantities: Array<[string, number | null, ForecastSourceRow['quantities'][number]['state']?]>, extra: Partial<ForecastSourceRow> = {}): ForecastSourceRow => ({
  sourceRow: 1, model, displayModel: model, vendor: 'ALMUS', processGroup: 'CNC', processLabel: 'CNC 1 ~ CNC 2', processes: ['CNC1', 'CNC2'], issues: [],
  quantities: quantities.map(([date, quantity, state]) => ({ date, cell: 'A1', quantity, state: state ?? (quantity === null ? 'blank' : 'number'), formula: false, error: null })),
  ...extra,
});
const days = (start: string, count: number) => Array.from({ length: count }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

describe('ISO weeks', () => {
  it('starts weeks on Monday and numbers them by ISO 8601', () => {
    expect(isoWeek('2026-09-07')).toEqual({ year: 2026, week: 37, monday: '2026-09-07' });
    expect(isoWeek('2026-09-13')).toEqual({ year: 2026, week: 37, monday: '2026-09-07' });
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1, monday: '2025-12-29' });
  });
  it('groups 77 days starting on a Monday into 11 full weeks', () => {
    const weeks = groupWeeks(days('2026-09-07', 77));
    expect(weeks).toHaveLength(11);
    expect(weeks[0]).toMatchObject({ key: '2026-W37', label: 'W37', start: '2026-09-07', end: '2026-09-13', partial: false });
    expect(weeks[0].dates).toHaveLength(7);
    expect(weeks[10]).toMatchObject({ key: '2026-W47', end: '2026-11-22' });
  });
  it('marks a week that the file does not fully cover as partial', () => {
    const weeks = groupWeeks(days('2026-09-09', 10));
    expect(weeks[0]).toMatchObject({ key: '2026-W37', partial: true });
    expect(weeks[0].dates).toEqual(days('2026-09-09', 5));
    expect(weeks[1]).toMatchObject({ key: '2026-W38', partial: true });
  });
});

describe('weekly peak demand', () => {
  const week = groupWeeks(days('2026-09-07', 7))[0];
  it('uses the largest daily quantity in the week and remembers its date', () => {
    const [demand] = weeklyModelDemand([row('H8 MAIN', [['2026-09-07', 100], ['2026-09-08', 900], ['2026-09-09', 300]])], week);
    expect(demand).toMatchObject({ model: 'H8 MAIN', week: '2026-W37', peakQuantity: 900, peakDate: '2026-09-08', numericDays: 3, warnings: [] });
  });
  it('sums rows of the same model per date before taking the peak', () => {
    const rows = [row('M1', [['2026-09-07', 400]]), row('M1', [['2026-09-07', 500]], { vendor: 'OTHER', sourceRow: 2 })];
    expect(weeklyModelDemand(rows, week)[0]).toMatchObject({ peakQuantity: 900, peakDate: '2026-09-07' });
  });
  it('flags duplicate source rows because their sum may double count', () => {
    const rows = [row('M1', [['2026-09-07', 400]], { issues: ['duplicate_row'] }), row('M1', [['2026-09-07', 400]], { sourceRow: 2, issues: ['duplicate_row'] })];
    expect(weeklyModelDemand(rows, week)[0].warnings).toContain('duplicate_rows');
  });
  it('treats blanks as zero, warns on error cells, and rounds fractions up', () => {
    const [demand] = weeklyModelDemand([row('ON 1', [['2026-09-07', null], ['2026-09-08', null, 'error'], ['2026-09-09', 10.2]])], week);
    expect(demand).toMatchObject({ peakQuantity: 11, peakDate: '2026-09-09', blankCells: 1, errorCells: 1, fractional: true });
    expect(demand.warnings).toEqual(expect.arrayContaining(['error_cells', 'fractional']));
  });
  it('reports a model with no numeric cell in the week instead of inventing zero demand', () => {
    const [demand] = weeklyModelDemand([row('E1', [['2026-09-07', null, 'missing_cache']])], week);
    expect(demand).toMatchObject({ peakQuantity: 0, peakDate: null, numericDays: 0 });
    expect(demand.warnings).toContain('no_numeric');
  });
  it('ignores dates outside the week, rows without a model, and unsupported processes', () => {
    const rows = [row('M3', [['2026-09-14', 999], ['2026-09-07', 1]]), row('', [['2026-09-07', 5]]), row('X', [['2026-09-07', 5]], { processes: [] })];
    const demands = weeklyModelDemand(rows, week);
    expect(demands).toHaveLength(1);
    expect(demands[0]).toMatchObject({ model: 'M3', peakQuantity: 1 });
  });
  it('adds partial_week when the selected week is incomplete', () => {
    const partial = groupWeeks(days('2026-09-09', 2))[0];
    expect(weeklyModelDemand([row('M3', [['2026-09-09', 1]])], partial)[0].warnings).toContain('partial_week');
  });
});

const samplePath = process.env.FORECAST_SAMPLE_PATH;
(samplePath ? describe : describe.skip)('real forecast file', () => {
  it('finds 11 full ISO weeks starting 2026-W37 and a peak for H8 MAIN in the first week', () => {
    const preview = parseForecastFile(readFileSync(samplePath!));
    const weeks = groupWeeks(preview.dates);
    expect(weeks).toHaveLength(11);
    expect(weeks[0]).toMatchObject({ key: '2026-W37', start: '2026-09-07', end: '2026-09-13', partial: false });
    const demands = weeklyModelDemand(preview.rows, weeks[0]);
    const h8 = demands.find(d => d.model === 'H8 MAIN')!;
    // Independent check: the peak must equal the max over the week of the summed daily quantities.
    const daily = weeks[0].dates.map(date => preview.rows.filter(r => r.model === 'H8 MAIN').reduce((sum, r) => sum + (r.quantities.find(q => q.date === date)?.quantity ?? 0), 0));
    expect(h8.peakQuantity).toBe(Math.ceil(Math.max(...daily)));
    expect(h8.peakQuantity).toBeGreaterThan(0);
  });
});
