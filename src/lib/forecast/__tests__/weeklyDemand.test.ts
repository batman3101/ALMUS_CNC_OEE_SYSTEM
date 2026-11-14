import { readFileSync } from 'node:fs';
import type { ForecastSourceRow } from '@/types/forecast';
import { parseForecastFile } from '../parseForecast';
import { defaultSimulationWeek, groupWeeks, isoWeek, plantToday, weeklyModelDemand } from '../weeklyDemand';
import { mergePoOverrides } from '../poOverrides';

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

describe('defaultSimulationWeek (user decision 2026-09-29: next week, else the file\'s last week)', () => {
  const weeks = groupWeeks(days('2026-09-07', 42)); // W37 … W42
  it('opens on next week, not the first week of the file', () => {
    expect(defaultSimulationWeek(weeks, '2026-09-29')?.label).toBe('W41');
  });
  it('treats Sunday as the end of its week', () => {
    expect(defaultSimulationWeek(weeks, '2026-10-04')?.label).toBe('W41');
    expect(defaultSimulationWeek(weeks, '2026-10-05')?.label).toBe('W42');
  });
  it('falls back to the last week when the file does not reach next week', () => {
    expect(defaultSimulationWeek(weeks, '2026-10-19')?.label).toBe('W42');
  });
  it('returns undefined only when there are no weeks', () => {
    expect(defaultSimulationWeek([], '2026-09-29')).toBeUndefined();
  });
});

describe('plantToday', () => {
  // 2026-09-29 18:30 UTC is already 09-30 in Vietnam (UTC+7).
  const now = new Date('2026-09-29T18:30:00Z');
  it('uses the plant timezone', () => { expect(plantToday('Asia/Ho_Chi_Minh', now)).toBe('2026-09-30'); });
  it('falls back to the browser date on an invalid timezone', () => { expect(plantToday('Not/AZone', now)).toMatch(/^\d{4}-\d{2}-\d{2}$/); });
});

describe('weeklyModelDemand — 실제 PO 수정값 (사용자 요청 2026-09-29)', () => {
  const week = groupWeeks(days('2026-10-05', 7))[0];
  const po = (sourceRow: number, date: string, quantity: number) => ({ sourceRow, date, quantity, updatedAt: 't' });
  const forecast = [row('ON 1', [['2026-10-05', 100], ['2026-10-06', 300], ['2026-10-07', 200]], { sourceRow: 15 })];
  const of = (rows: ForecastSourceRow[], options?: { usePo?: boolean }) => weeklyModelDemand(rows, week, options).find(d => d.model === 'ON 1')!;

  it('수정값이 그 날짜의 Forecast 수량을 대신해 주간 최대값이 바뀐다', () => {
    const rows = mergePoOverrides(forecast, [po(15, '2026-10-06', 50), po(15, '2026-10-07', 800)]);
    const demand = of(rows);
    expect(demand).toMatchObject({ peakQuantity: 800, peakDate: '2026-10-07' });
    expect(demand.warnings).toContain('po_override');
  });

  it('원본 최대일을 더 낮게 고치면 다음으로 큰 날이 최대가 된다', () => {
    expect(of(mergePoOverrides(forecast, [po(15, '2026-10-06', 50)]))).toMatchObject({ peakQuantity: 200, peakDate: '2026-10-07' });
  });

  it('usePo: false 면 접수한 Forecast 그대로 읽고 경고도 없다', () => {
    const demand = of(mergePoOverrides(forecast, [po(15, '2026-10-06', 50)]), { usePo: false });
    expect(demand).toMatchObject({ peakQuantity: 300, peakDate: '2026-10-06' });
    expect(demand.warnings).not.toContain('po_override');
  });

  it('빈 칸은 PO 로 채워지고, 오류 칸은 PO 로 해소되어 error_cells 경고가 사라진다', () => {
    const rows = [row('ON 1', [['2026-10-05', 100], ['2026-10-06', null, 'blank'], ['2026-10-07', null, 'error']], { sourceRow: 15 })];
    const before = of(rows);
    expect(before).toMatchObject({ blankCells: 1, errorCells: 1 });
    expect(before.warnings).toContain('error_cells');
    const after = of(mergePoOverrides(rows, [po(15, '2026-10-06', 400), po(15, '2026-10-07', 250)]));
    expect(after).toMatchObject({ blankCells: 0, errorCells: 0, peakQuantity: 400, numericDays: 3 });
    expect(after.warnings).not.toContain('error_cells');
  });

  it('0 인 PO 는 그날 수요가 0 이라는 뜻이다', () => {
    expect(of(mergePoOverrides(forecast, [po(15, '2026-10-06', 0), po(15, '2026-10-07', 0)]))).toMatchObject({ peakQuantity: 100, peakDate: '2026-10-05' });
  });

  it('같은 모델의 다른 행은 자기 행의 수정값만 받는다 — 합계는 행별 유효 값의 합이다', () => {
    const rows = [
      row('ON 1', [['2026-10-05', 100]], { sourceRow: 15 }),
      row('ON 1', [['2026-10-05', 40]], { sourceRow: 20, vendor: 'OTHER' }),
    ];
    expect(of(mergePoOverrides(rows, [po(20, '2026-10-05', 60)]))).toMatchObject({ peakQuantity: 160, peakDate: '2026-10-05' });
  });

  it('그 주 밖의 수정값은 그 주 계산과 경고에 영향을 주지 않는다', () => {
    const rows = [row('ON 1', [['2026-10-05', 100], ['2026-10-12', 900]], { sourceRow: 15 })];
    const demand = of(mergePoOverrides(rows, [po(15, '2026-10-12', 1)]));
    expect(demand).toMatchObject({ peakQuantity: 100 });
    expect(demand.warnings).not.toContain('po_override');
  });

  it('수정값을 쓴 모델에만 경고가 붙는다', () => {
    const rows = [...forecast, row('M3', [['2026-10-05', 10]], { sourceRow: 16 })];
    const demands = weeklyModelDemand(mergePoOverrides(rows, [po(15, '2026-10-06', 1)]), week);
    expect(demands.find(d => d.model === 'ON 1')!.warnings).toContain('po_override');
    expect(demands.find(d => d.model === 'M3')!.warnings).not.toContain('po_override');
  });

  it('CNC1~CNC2 로 매핑되지 않은 행은 수정값이 있어도 수요에 들어가지 않는다(시뮬레이션 대상이 아니다)', () => {
    const rows = [row('CNC3', [['2026-10-05', 100]], { sourceRow: 30, processes: [] })];
    expect(weeklyModelDemand(mergePoOverrides(rows, [po(30, '2026-10-05', 999)]), week)).toEqual([]);
  });
});
