import type { ForecastSnapshotMachine } from '@/types/forecast';
import type { ModelProcessRequirement } from '../requiredMachines';
import type { WeeklyModelDemand } from '../weeklyDemand';
import { proposeReassignment } from '../reassignment';

const req = (forecastModel: string, dbId: string, process: 'CNC1' | 'CNC2', required: number | null, current: number, status: ModelProcessRequirement['status']): ModelProcessRequirement => ({
  key: `${forecastModel}:${process}`, forecastModel, dbModel: { id: dbId, name: dbId.toUpperCase() }, process, processId: `${dbId}-${process}`, tactTimeSeconds: 600, dailyCapacity: 100,
  peakQuantity: required ? required * 100 : 0, peakDate: null, required, current, gap: required === null ? null : required - current, status, warnings: [],
});
const machine = (name: string, modelId: string | null, processId: string | null): ForecastSnapshotMachine => ({ id: name, name, location: 'B동', isActive: true, modelId, processId });
const machines = [
  machine('CNC-001', 'on1', 'on1-CNC1'), machine('CNC-002', 'on1', 'on1-CNC1'), machine('CNC-003', 'on1', 'on1-CNC1'),
  machine('CNC-010', 'm3', 'm3-CNC1'), machine('CNC-011', 'm3', 'm3-CNC1'),
  machine('CNC-020', null, null),
  machine('CNC-030', 'pa1', 'pa1-CNC2'),
];
const nextWeekOn1: WeeklyModelDemand[] = [{ model: 'ON 1', week: '2026-W38', peakQuantity: 500, peakDate: '2026-09-15', numericDays: 7, blankCells: 0, errorCells: 0, fractional: false, warnings: [] }];

describe('minimal-change reassignment proposal', () => {
  it('moves surplus first, then unassigned, then zero-demand machines, highest machine number first', () => {
    const requirements = [
      req('ON 1', 'on1', 'CNC1', 1, 3, 'surplus'),
      req('M3', 'm3', 'CNC1', 0, 2, 'zero_demand'),
      req('PA1', 'pa1', 'CNC2', 1, 1, 'ok'),
      req('H8 MAIN', 'h8m', 'CNC2', 4, 0, 'shortage'),
    ];
    const proposal = proposeReassignment({ requirements, machines, nextWeekDemands: [] });
    expect(proposal.moves.map(m => [m.machineName, m.reason])).toEqual([['CNC-003', 'surplus'], ['CNC-002', 'surplus'], ['CNC-020', 'unassigned'], ['CNC-011', 'zero_demand']]);
    expect(proposal.moves[0]).toMatchObject({ from: { model: 'ON1', process: 'CNC1' }, to: { model: 'H8M', process: 'CNC2' }, location: 'B동', nextWeekDemand: false });
    expect(proposal.unresolved).toEqual([]);
    expect(proposal.summary).toEqual({ required: 6, current: 6, shortage: 4, surplus: 4, changes: 4 });
  });
  it('fills the largest shortage first and reports what the pool could not cover', () => {
    const requirements = [req('ON 1', 'on1', 'CNC1', 2, 3, 'surplus'), req('A', 'a', 'CNC1', 3, 0, 'shortage'), req('B', 'b', 'CNC2', 5, 0, 'shortage')];
    const proposal = proposeReassignment({ requirements, machines: machines.slice(0, 3), nextWeekDemands: [] });
    expect(proposal.moves).toHaveLength(1);
    expect(proposal.moves[0].to).toEqual({ model: 'B', process: 'CNC2' });
    expect(proposal.unresolved).toEqual([{ dbModel: 'B', process: 'CNC2', remaining: 4 }, { dbModel: 'A', process: 'CNC1', remaining: 3 }]);
  });
  it('uses machines whose model has demand next week only as a last resort', () => {
    const requirements = [req('ON 1', 'on1', 'CNC1', 1, 3, 'surplus'), req('M3', 'm3', 'CNC1', 0, 2, 'zero_demand'), req('X', 'x', 'CNC1', 3, 0, 'shortage')];
    const proposal = proposeReassignment({ requirements, machines, nextWeekDemands: nextWeekOn1 });
    expect(proposal.moves.map(m => [m.machineName, m.nextWeekDemand])).toEqual([['CNC-020', false], ['CNC-011', false], ['CNC-010', false]]);
  });
  it('flags a move that had to use a next-week machine', () => {
    const requirements = [req('ON 1', 'on1', 'CNC1', 1, 3, 'surplus'), req('X', 'x', 'CNC1', 1, 0, 'shortage')];
    const proposal = proposeReassignment({ requirements, machines: machines.slice(0, 3), nextWeekDemands: nextWeekOn1 });
    expect(proposal.moves).toEqual([expect.objectContaining({ machineName: 'CNC-003', nextWeekDemand: true })]);
  });
  it('never pools machines of unmapped, no_tact, or not_in_forecast rows, and never moves inactive machines', () => {
    const requirements: ModelProcessRequirement[] = [
      { ...req('Hubble Y2', 'y2', 'CNC1', null, 0, 'unmapped'), dbModel: null, processId: null },
      req('ZERO', 'zero', 'CNC1', null, 2, 'no_tact'),
      { ...req('', 'idle', 'CNC1', null, 1, 'not_in_forecast'), forecastModel: null },
      req('X', 'x', 'CNC1', 5, 0, 'shortage'),
    ];
    const pool = [machine('CNC-050', 'zero', 'zero-CNC1'), machine('CNC-051', 'idle', 'idle-CNC1'), { ...machine('CNC-052', null, null), isActive: false }];
    const proposal = proposeReassignment({ requirements, machines: pool, nextWeekDemands: [] });
    expect(proposal.moves).toEqual([]);
    expect(proposal.unresolved).toEqual([{ dbModel: 'X', process: 'CNC1', remaining: 5 }]);
  });
  it('is deterministic for equal inputs', () => {
    const requirements = [req('ON 1', 'on1', 'CNC1', 0, 3, 'zero_demand'), req('X', 'x', 'CNC1', 2, 0, 'shortage')];
    const a = proposeReassignment({ requirements, machines, nextWeekDemands: [] });
    const b = proposeReassignment({ requirements: [...requirements].reverse(), machines: [...machines].reverse(), nextWeekDemands: [] });
    expect(a).toEqual(b);
  });
});
