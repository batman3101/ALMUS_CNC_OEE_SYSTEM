import type { ForecastSnapshotMachine, ForecastSnapshotModel } from '@/types/forecast';
import { matchModels } from '../modelAliases';
import type { WeeklyModelDemand } from '../weeklyDemand';
import { buildRequirements, dailyCapacityPerMachine } from '../requiredMachines';

const demand = (model: string, peakQuantity: number, warnings: WeeklyModelDemand['warnings'] = []): WeeklyModelDemand =>
  ({ model, week: '2026-W37', peakQuantity, peakDate: peakQuantity ? '2026-09-08' : null, numericDays: 7, blankCells: 0, errorCells: 0, fractional: false, warnings });
const models: ForecastSnapshotModel[] = [
  { id: 'on1', name: 'ON1', isActive: true, processes: [{ id: 'on1-c1', name: 'CNC #1', order: 1, tactTimeSeconds: 560 }, { id: 'on1-c2', name: 'CNC #2', order: 2, tactTimeSeconds: 558 }] },
  { id: 'zero', name: 'ZERO', isActive: true, processes: [{ id: 'zero-c1', name: 'CNC #1', order: 1, tactTimeSeconds: 0 }, { id: 'zero-c2', name: 'CNC #2', order: 2, tactTimeSeconds: null }] },
  { id: 'h8', name: 'H8 M', isActive: true, processes: [{ id: 'h8-c0', name: 'CNC #0', order: 1, tactTimeSeconds: 63 }, { id: 'h8-c1', name: 'CNC #1', order: 2, tactTimeSeconds: 593 }, { id: 'h8-c2', name: 'CNC #2', order: 3, tactTimeSeconds: 453 }] },
  { id: 'side', name: 'SIDE', isActive: true, processes: [{ id: 'side-c0', name: 'CNC #0', order: 1, tactTimeSeconds: 68 }, { id: 'side-c1', name: 'CNC #1', order: 2, tactTimeSeconds: 807 }] },
  { id: 'idle', name: 'IDLE', isActive: true, processes: [{ id: 'idle-c1', name: 'CNC #1', order: 1, tactTimeSeconds: 600 }, { id: 'idle-c2', name: 'CNC #2', order: 2, tactTimeSeconds: 600 }] },
];
const machine = (name: string, modelId: string | null, processId: string | null, isActive = true): ForecastSnapshotMachine => ({ id: name, name, location: 'A동', isActive, modelId, processId });
const machines = [
  ...Array.from({ length: 15 }, (_, i) => machine(`CNC-${String(i + 1).padStart(3, '0')}`, 'on1', 'on1-c1')),
  ...Array.from({ length: 10 }, (_, i) => machine(`CNC-${String(i + 101).padStart(3, '0')}`, 'on1', 'on1-c2')),
  machine('CNC-900', 'on1', 'on1-c2', false),
  machine('CNC-950', 'idle', 'idle-c1'),
  machine('CNC-126', 'h8', 'h8-c0'),
  machine('CNC-780', 'side', 'side-c0'),
];
const build = (demands: WeeklyModelDemand[]) => buildRequirements({ demands, matches: matchModels(demands.map(d => d.model), models), models, machines, breakMinutes: 110 });

describe('required machines from weekly peak demand', () => {
  it('reuses the OEE capacity formula: two 720-minute shifts, breaks subtracted once, floored per shift', () => {
    // (720 - 110) * 60 / 560 = 65.35 → 65 per shift → 130 per day. No cavity factor.
    expect(dailyCapacityPerMachine(560, 110)).toBe(130);
    expect(dailyCapacityPerMachine(0, 110)).toBeNull();
    expect(dailyCapacityPerMachine(null, 110)).toBeNull();
  });
  it('computes required = ceil(peak / daily capacity) per process with the same quantity for CNC1 and CNC2', () => {
    const rows = build([demand('ON 1', 2000)]);
    const c1 = rows.find(r => r.forecastModel === 'ON 1' && r.process === 'CNC1')!;
    const c2 = rows.find(r => r.forecastModel === 'ON 1' && r.process === 'CNC2')!;
    expect(c1).toMatchObject({ dbModel: { id: 'on1', name: 'ON1' }, tactTimeSeconds: 560, dailyCapacity: 130, peakQuantity: 2000, required: 16, current: 15, gap: 1, status: 'shortage' });
    // (720 - 110) * 60 / 558 = 65.59 → 65 → 130/day; 2000 / 130 = 15.38 → 16 needed, 10 active (inactive CNC-900 not counted)
    expect(c2).toMatchObject({ dailyCapacity: 130, required: 16, current: 10, gap: 6, status: 'shortage' });
  });
  it('includes CNC0 with the same quantity when the DB model has a CNC #0 process', () => {
    const rows = build([demand('H8 M', 2000)]);
    expect(rows.filter(r => r.forecastModel === 'H8 M').map(r => r.process)).toEqual(['CNC0', 'CNC1', 'CNC2']);
    // (720 - 110) * 60 / 63 = 580.95 → 580 per shift → 1160/day; 2000 / 1160 = 1.72 → 2 needed, 1 on CNC #0
    expect(rows.find(r => r.forecastModel === 'H8 M' && r.process === 'CNC0')).toMatchObject({ processId: 'h8-c0', tactTimeSeconds: 63, dailyCapacity: 1160, required: 2, current: 1, gap: 1, status: 'shortage' });
  });
  it('adds no CNC0 row for a model without a CNC #0 process, and none for unmapped models', () => {
    const rows = build([demand('ON 1', 2000), demand('Hubble Y2', 500)]);
    expect(rows.filter(r => r.forecastModel !== null && r.process === 'CNC0')).toEqual([]);
  });
  it('marks surplus, exact fit, and zero demand', () => {
    const rows = build([demand('ON 1', 1300)]);
    expect(rows.find(r => r.forecastModel === 'ON 1' && r.process === 'CNC1')).toMatchObject({ required: 10, current: 15, gap: -5, status: 'surplus' });
    expect(rows.find(r => r.forecastModel === 'ON 1' && r.process === 'CNC2')).toMatchObject({ required: 10, current: 10, gap: 0, status: 'ok' });
    const idle = build([demand('ON 1', 0)]);
    expect(idle.find(r => r.forecastModel === 'ON 1' && r.process === 'CNC1')).toMatchObject({ required: 0, gap: -15, status: 'zero_demand' });
  });
  it('holds unmapped models and processes without tact time instead of guessing', () => {
    const rows = build([demand('Hubble Y2', 500), demand('ZERO', 500)]);
    expect(rows.filter(r => r.forecastModel === 'Hubble Y2')).toEqual([expect.objectContaining({ process: 'CNC1', status: 'unmapped', required: null, gap: null }), expect.objectContaining({ process: 'CNC2', status: 'unmapped' })]);
    expect(rows.filter(r => r.forecastModel === 'ZERO').map(r => r.status)).toEqual(['no_tact', 'no_tact']);
  });
  it('lists DB models that hold machines but are absent from the forecast as not_in_forecast', () => {
    const rows = build([demand('ON 1', 1300)]);
    expect(rows.find(r => r.dbModel?.id === 'idle' && r.process === 'CNC1')).toMatchObject({ forecastModel: null, status: 'not_in_forecast', current: 1, required: null, tactTimeSeconds: 600 });
    expect(rows.find(r => r.dbModel?.id === 'idle' && r.process === 'CNC2')).toBeUndefined();
    expect(rows.find(r => r.dbModel?.id === 'side' && r.process === 'CNC0')).toMatchObject({ status: 'not_in_forecast', current: 1, tactTimeSeconds: 68 });
  });
  it('carries demand warnings through', () => {
    const rows = build([demand('ON 1', 10, ['error_cells'])]);
    expect(rows[0].warnings).toEqual(['error_cells']);
  });
});
