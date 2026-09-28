import type { ForecastSnapshotMachine, ForecastSnapshotModel } from '@/types/forecast';
import type { WeeklyModelDemand } from '@/lib/forecast/weeklyDemand';
import { buildPlanDraft, resolveModels } from '../planInput';
import type { MachinePosition } from '../recommendLayout';

const model = (id: string, name: string, tacts: Array<[string, number | null]>, isActive = true): ForecastSnapshotModel =>
  ({ id, name, isActive, processes: tacts.map(([p, tact], i) => ({ id: `${id}-${p}`, name: p, order: i + 1, tactTimeSeconds: tact })) });
const models = [
  model('on1', 'ON1', [['CNC #1', 560], ['CNC #2', 558]]),
  model('h8m', 'H8 M', [['CNC #0', 63], ['CNC #1', 593], ['CNC #2', 453]]),
  model('m3', 'M3', [['CNC #1', 851], ['CNC #2', 965]]),
  model('old', 'OLD', [['CNC #1', 500]], false),
];
const demand = (modelName: string, peak: number): WeeklyModelDemand =>
  ({ model: modelName, week: '2026-W39', peakQuantity: peak, peakDate: peak ? '2026-09-22' : null, numericDays: 7, blankCells: 0, errorCells: 0, fractional: false, warnings: [] });
const machine = (name: string, modelId: string | null, processId: string | null): ForecastSnapshotMachine =>
  ({ id: name, name, location: '', isActive: true, modelId, processId });

describe('forecast model resolution for a layout plan', () => {
  it('uses the saved user mapping before any automatic match, and reports unmapped models that have demand', () => {
    const { matches, unmapped, sources } = resolveModels(
      [demand('ON 1', 100), demand('H8 MAIN', 100), demand('Hubble Y2', 50), demand('Nobody', 0), demand('D3', 10)],
      models,
      [{ forecastModelKey: 'D3', productModelId: 'm3' }, { forecastModelKey: 'ON1', productModelId: 'h8m' }],
    );
    expect(matches.get('ON 1')?.dbModel?.id).toBe('h8m');       // saved mapping wins over the exact name
    expect(sources.get('ON 1')).toBe('saved');
    expect(matches.get('H8 MAIN')?.dbModel?.id).toBe('h8m');    // built-in alias
    expect(sources.get('H8 MAIN')).toBe('auto');
    expect(matches.get('D3')?.dbModel?.id).toBe('m3');
    expect(unmapped).toEqual(['Hubble Y2']);                     // zero demand does not block
  });

  it('ignores a saved mapping to an inactive model instead of planning onto it', () => {
    const { unmapped } = resolveModels([demand('Legacy', 10)], models, [{ forecastModelKey: 'LEGACY', productModelId: 'old' }]);
    expect(unmapped).toEqual(['Legacy']);
  });
});

describe('plan draft payload', () => {
  const positions = new Map<string, MachinePosition>([
    ['CNC-001', { building: 'B', x: 0, y: 0, width: 104, height: 62 }],
    ['CNC-002', { building: 'B', x: 116, y: 0, width: 104, height: 62 }],
    ['CNC-003', { building: 'B', x: 232, y: 0, width: 104, height: 62 }],
  ]);
  const machines = [machine('CNC-001', 'on1', 'on1-CNC #1'), machine('CNC-002', 'm3', 'm3-CNC #1'), machine('CNC-003', null, null)];

  it('builds requirement rows (with CNC #0 when the model has it) and moves only what a shortage needs', () => {
    const draft = buildPlanDraft({
      demands: [demand('ON 1', 260), demand('M3', 0)], nextWeekDemands: [], snapshotModels: models, machines, positions,
      mappings: [], breakMinutes: 110, locked: new Set(),
    });
    // ON1 CNC1: 260 / 130 per day = 2 needed, 1 present → 1 short; CNC2: 2 short. M3 zero demand → pool.
    expect(draft.requirements.map(r => [r.product_model_id, r.process_id, r.required_machines])).toEqual([
      ['m3', 'm3-CNC #1', 0], ['m3', 'm3-CNC #2', 0], ['on1', 'on1-CNC #1', 2], ['on1', 'on1-CNC #2', 2],
    ]);
    expect(draft.assignments.map(a => [a.machine_id, a.recommended_process_id, a.recommendation_reason])).toEqual([
      ['CNC-003', 'on1-CNC #2', 'unassigned_fill'], ['CNC-002', 'on1-CNC #2', 'zero_demand_release'],
    ]);
    expect(draft.unresolved).toEqual([{ modelId: 'on1', processId: 'on1-CNC #1', remaining: 1 }]);
  });

  it('merges two forecast names that point at one model by adding their peaks (conservative) and joins the labels', () => {
    const draft = buildPlanDraft({
      demands: [demand('ON 1', 100), demand('ON-ONE', 160)], nextWeekDemands: [], snapshotModels: models, machines, positions,
      mappings: [{ forecastModelKey: 'ON-ONE', productModelId: 'on1' }], breakMinutes: 110, locked: new Set(),
    });
    const on1 = draft.requirements.find(r => r.process_id === 'on1-CNC #1')!;
    expect(on1).toMatchObject({ peak_quantity: 260, forecast_model_label: 'ON 1 + ON-ONE', required_machines: 2 });
    expect(new Set(draft.requirements.map(r => `${r.product_model_id}:${r.process_id}`)).size).toBe(draft.requirements.length);
  });

  it('keeps locked machines where they are and records them as locked', () => {
    const draft = buildPlanDraft({
      demands: [demand('ON 1', 260), demand('M3', 0)], nextWeekDemands: [], snapshotModels: models, machines, positions,
      mappings: [], breakMinutes: 110, locked: new Set(['CNC-002']),
    });
    expect(draft.assignments.find(a => a.machine_id === 'CNC-002')).toEqual({
      machine_id: 'CNC-002', recommended_model_id: 'm3', recommended_process_id: 'm3-CNC #1', recommendation_reason: 'locked', is_locked: true,
    });
  });
});
