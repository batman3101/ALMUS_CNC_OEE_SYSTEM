/**
 * Regression tests for docs/AUDIT_LAYOUT_STUDIO_2026-09-28_CODEX.md — each case is the audit's own repro.
 */
import type { ForecastSnapshotMachine, ForecastSnapshotModel, ForecastSourceRow } from '@/types/forecast';
import { weeklyModelDemand, type ForecastWeek, type WeeklyModelDemand } from '@/lib/forecast/weeklyDemand';
import { buildRequirements, dailyCapacityPerMachine } from '@/lib/forecast/requiredMachines';
import { matchModels } from '@/lib/forecast/modelAliases';
import { proposeReassignment } from '@/lib/forecast/reassignment';
import { buildPlanDraft } from '../planInput';
import { summarizeCapacity } from '../summarizeCapacity';
import type { MachinePosition } from '../recommendLayout';

const week: ForecastWeek = { key: '2026-W39', label: 'W39', start: '2026-09-21', end: '2026-09-27', dates: ['2026-09-21', '2026-09-22'], partial: true };
const row = (model: string, cells: Array<{ quantity: number | null; state: 'number' | 'error' }>): ForecastSourceRow => ({
  sourceRow: 1, model, displayModel: model, vendor: 'v', processGroup: 'CNC', processLabel: 'CNC 1 ~ CNC 2', processes: ['CNC1', 'CNC2'], issues: [],
  quantities: cells.map((c, i) => ({ date: week.dates[i], cell: `X${i}`, quantity: c.quantity, state: c.state, formula: c.state === 'error', error: c.state === 'error' ? '#REF!' : null })),
});
const model = (id: string, procs: Array<[string, number | null]>): ForecastSnapshotModel =>
  ({ id, name: id, isActive: true, processes: procs.map(([p, tact], i) => ({ id: `${id}-${p.replace(/\D/g, '')}`, name: p, order: i + 1, tactTimeSeconds: tact })) });
const models = [model('A', [['CNC #1', 600], ['CNC #2', 600]]), model('B', [['CNC #1', 600]]), model('C', [['CNC #1', 600], ['CNC #2', 600]])];
const machine = (id: string, modelId: string | null, processId: string | null): ForecastSnapshotMachine => ({ id, name: `CNC-${id}`, location: '', isActive: true, modelId, processId });
const positions = (ids: string[]) => new Map<string, MachinePosition>(ids.map((id, i) => [id, { building: 'B', x: i * 116, y: 0, width: 104, height: 62 }]));
const demand = (m: string, peak: number, warnings: WeeklyModelDemand['warnings'] = [], numericDays = 7): WeeklyModelDemand =>
  ({ model: m, week: 'W', peakQuantity: peak, peakDate: null, numericDays, blankCells: 0, errorCells: warnings.includes('error_cells') ? 1 : 0, fractional: false, warnings });

describe('BUG-01 — unreadable demand is unknown, never zero', () => {
  const machines = [machine('1', 'A', 'A-1'), machine('2', 'A', 'A-2')];

  it('a model whose week holds only error cells is demand_unknown with no requirement, not zero demand', () => {
    const [a] = weeklyModelDemand([row('A', [{ quantity: null, state: 'error' }])], week);
    const rows = buildRequirements({ demands: [a], matches: matchModels(['A'], models), models, machines, breakMinutes: 110 });
    expect(rows.map(r => [r.process, r.status, r.required, r.gap])).toEqual([['CNC1', 'demand_unknown', null, null], ['CNC2', 'demand_unknown', null, null]]);
  });

  it('the audit repro: A (error cells only) keeps its machines while C has demand', () => {
    const demands = weeklyModelDemand([row('A', [{ quantity: null, state: 'error' }]), row('C', [{ quantity: 100, state: 'number' }])], week);
    const draft = buildPlanDraft({ demands, snapshotModels: models, machines, positions: positions(['1', '2']), mappings: [], breakMinutes: 110, locked: new Set() });
    expect(draft.assignments).toEqual([]);
    expect(draft.requirements.filter(r => r.product_model_id === 'A').map(r => [r.required_machines, r.warnings])).toEqual([
      [null, ['error_cells', 'partial_week', 'no_numeric']], [null, ['error_cells', 'partial_week', 'no_numeric']],
    ]);
  });

  it('a model with some error cells is never a release source even when its readable days look like surplus', () => {
    // Readable day: 10 pieces → 1 machine needed on each process, 2 present → "surplus" 1, but the error day is unknown.
    const two = [machine('1', 'A', 'A-1'), machine('2', 'A', 'A-1'), machine('3', 'A', 'A-2'), machine('4', 'A', 'A-2')];
    const demands = [demand('A', 10, ['error_cells']), demand('C', 100)];
    const draft = buildPlanDraft({ demands, snapshotModels: models, machines: two, positions: positions(['1', '2', '3', '4']), mappings: [], breakMinutes: 110, locked: new Set() });
    expect(draft.assignments).toEqual([]);
    // Same rule in the Forecast screen's quantity-only proposal.
    const requirements = buildRequirements({ demands, matches: matchModels(['A', 'C'], models), models, machines: two, breakMinutes: 110 });
    expect(proposeReassignment({ requirements, machines: two }).moves).toEqual([]);
  });

  it('the plan keeps the demand warnings, and the capacity alert says demand is unknown', () => {
    const { groups } = summarizeCapacity(
      [{ modelId: 'A', modelName: 'A', processId: 'A-1', processName: 'CNC #1', forecastModel: 'A', peakQuantity: 0, dailyCapacityPerMachine: 130, requiredMachines: null, warnings: ['error_cells', 'no_numeric'] }],
      [{ machineId: '1', modelId: 'A', processId: 'A-1' }],
    );
    expect(groups[0]).toMatchObject({ status: 'demand_unknown', required: null, gap: null, spare: null });
  });
});

describe('BUG-03 — a required process that is not registered stays visible', () => {
  it('lists CNC1/CNC2 missing on a model with demand; CNC0 (optional) and zero-demand models are not listed', () => {
    const draft = buildPlanDraft({
      demands: [demand('B', 100), demand('C', 0)], snapshotModels: models,
      machines: [machine('1', 'B', 'B-1')], positions: positions(['1']), mappings: [], breakMinutes: 110, locked: new Set(),
    });
    expect(draft.missingProcesses).toEqual([{ forecastModel: 'B', modelId: 'B', modelName: 'B', process: 'CNC2' }]);
  });

  it('shows missing processes as their own alert rows', () => {
    const { groups } = summarizeCapacity([], [], [{ forecastModel: 'B', modelId: 'B', modelName: 'B', process: 'CNC2' }]);
    expect(groups).toEqual([expect.objectContaining({ modelId: 'B', processName: 'CNC2', status: 'process_missing', required: null, assigned: 0 })]);
  });
});

describe('BUG-06 — zero daily capacity is "not computable", never Infinity', () => {
  it('returns null when the break eats the shift', () => {
    expect(dailyCapacityPerMachine(60, 720)).toBeNull();
    expect(dailyCapacityPerMachine(60, 800)).toBeNull();
  });

  it('marks the rows no_tact with a null requirement', () => {
    const rows = buildRequirements({ demands: [demand('C', 100)], matches: matchModels(['C'], models), models, machines: [], breakMinutes: 720 });
    expect(rows.map(r => [r.status, r.required, r.dailyCapacity])).toEqual([['no_tact', null, null], ['no_tact', null, null]]);
  });
});
