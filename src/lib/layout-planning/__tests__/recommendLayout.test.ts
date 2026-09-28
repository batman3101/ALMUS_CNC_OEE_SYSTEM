import type { ForecastSnapshotMachine } from '@/types/forecast';
import type { ModelProcessRequirement } from '@/lib/forecast/requiredMachines';
import type { WeeklyModelDemand } from '@/lib/forecast/weeklyDemand';
import { areNeighbors, recommendLayout, type MachinePosition } from '../recommendLayout';

// Real W39 geometry: 104×62 boxes on a 116 × 72 pitch; aisles are 108 tall, buildings 340 apart.
const W = 104, H = 62, PX = 116, PY = 72;
const at = (col: number, row: number, building = 'B'): MachinePosition => ({ building, x: col * PX, y: row * PY, width: W, height: H });

const req = (model: string, required: number | null, current: number, status: ModelProcessRequirement['status'], forecastModel: string | null = model): ModelProcessRequirement => ({
  key: `${model}:CNC1`, forecastModel, dbModel: { id: model, name: model }, process: 'CNC1', processId: `${model}-p`, tactTimeSeconds: 600, dailyCapacity: 100,
  peakQuantity: required ? required * 100 : 0, peakDate: null, required, current, gap: required === null ? null : required - current, status, warnings: [],
});
const m = (name: string, model: string | null, isActive = true): ForecastSnapshotMachine =>
  ({ id: name, name, location: '', isActive, modelId: model, processId: model ? `${model}-p` : null });

function build(layout: Array<[string, string | null, MachinePosition]>) {
  return {
    machines: layout.map(([name, model]) => m(name, model)),
    positions: new Map(layout.map(([name, , pos]) => [name, pos])),
  };
}

describe('neighbours on the real grid', () => {
  it('counts the 8 surrounding cells, but not across an aisle or into another building', () => {
    expect(areNeighbors(at(0, 0), at(1, 0))).toBe(true);
    expect(areNeighbors(at(0, 0), at(1, 1))).toBe(true);
    expect(areNeighbors(at(0, 0), at(2, 0))).toBe(false);
    expect(areNeighbors(at(0, 0), { ...at(0, 0), y: 108 })).toBe(false); // next row across an aisle (108 pitch, not 72)
    expect(areNeighbors(at(0, 0), at(1, 0, 'A'))).toBe(false);
  });
});

describe('minimal-change layout recommendation with spatial grouping', () => {
  it('changes nothing when no model is short, even if some are in surplus', () => {
    const { machines, positions } = build([['CNC-001', 'Y', at(0, 0)], ['CNC-002', 'Y', at(1, 0)], ['CNC-003', 'X', at(2, 0)]]);
    const result = recommendLayout({ requirements: [req('Y', 1, 2, 'surplus'), req('X', 1, 1, 'ok')], machines, positions, locked: new Set(), nextWeekDemands: [] });
    expect(result.moves).toEqual([]);
    expect(result.unresolved).toEqual([]);
  });

  it('takes the surplus machine that sits next to the short group, not the highest-numbered one', () => {
    const { machines, positions } = build([
      ['CNC-101', 'X', at(0, 0)], ['CNC-102', 'X', at(1, 0)], ['CNC-103', 'X', at(2, 0)],
      ['CNC-104', 'Y', at(3, 0)], ['CNC-105', 'Y', at(4, 0)],
      ['CNC-001', 'Y', at(10, 5)],         // lowest name and an edge — only distance rules it out
    ]);
    const result = recommendLayout({ requirements: [req('X', 4, 3, 'shortage'), req('Y', 1, 3, 'surplus')], machines, positions, locked: new Set(), nextWeekDemands: [] });
    expect(result.moves.map(mv => [mv.machineName, mv.to.modelId, mv.reason])).toEqual([['CNC-104', 'X', 'surplus_release']]);
  });

  it('grows the short group contiguously: each pick is next to the group as it grows', () => {
    const { machines, positions } = build([
      ['CNC-101', 'X', at(0, 0)],
      ['CNC-102', 'Y', at(1, 0)], ['CNC-103', 'Y', at(2, 0)], ['CNC-104', 'Y', at(3, 0)],
      ['CNC-001', 'Y', at(0, 4)], ['CNC-002', 'Y', at(6, 4)],   // isolated, lower names: wrong unless distance counts
    ]);
    const result = recommendLayout({ requirements: [req('X', 3, 1, 'shortage'), req('Y', 3, 5, 'surplus')], machines, positions, locked: new Set(), nextWeekDemands: [] });
    expect(result.moves.map(mv => mv.machineName)).toEqual(['CNC-102', 'CNC-103']);
  });

  it('among equally close candidates, releases the one on the edge of its own group so that group stays together', () => {
    // X at col 5. Y at cols 2,3,4 and 6: col 4 and col 6 are equally close; col 6 has no Y neighbour, col 4 has one.
    const { machines, positions } = build([
      ['CNC-005', 'X', at(5, 0)],
      ['CNC-002', 'Y', at(2, 0)], ['CNC-003', 'Y', at(3, 0)], ['CNC-004', 'Y', at(4, 0)], ['CNC-006', 'Y', at(6, 0)],
    ]);
    const result = recommendLayout({ requirements: [req('X', 2, 1, 'shortage'), req('Y', 2, 4, 'surplus')], machines, positions, locked: new Set(), nextWeekDemands: [] });
    expect(result.moves.map(mv => mv.machineName)).toEqual(['CNC-006']);
  });

  it('never releases more than a surplus group can spare', () => {
    const { machines, positions } = build([
      ['CNC-001', 'X', at(0, 0)], ['CNC-002', 'Y', at(1, 0)], ['CNC-003', 'Y', at(2, 0)], ['CNC-004', 'Y', at(3, 0)],
    ]);
    const result = recommendLayout({ requirements: [req('X', 4, 1, 'shortage'), req('Y', 2, 3, 'surplus')], machines, positions, locked: new Set(), nextWeekDemands: [] });
    expect(result.moves).toHaveLength(1);
    expect(result.unresolved).toEqual([{ modelId: 'X', processId: 'X-p', remaining: 2 }]);
  });

  it('keeps the proven tier order (surplus → unassigned → zero-demand) and uses distance only within a tier', () => {
    const { machines, positions } = build([
      ['CNC-001', 'X', at(0, 0)],
      ['CNC-002', null, at(1, 0)],          // unassigned, adjacent
      ['CNC-050', 'Y', at(8, 4)],           // surplus, far
      ['CNC-003', 'Z', at(0, 1)],           // zero-demand, adjacent
    ]);
    const result = recommendLayout({ requirements: [req('X', 4, 1, 'shortage'), req('Y', 0, 1, 'surplus'), req('Z', 0, 1, 'zero_demand')], machines, positions, locked: new Set(), nextWeekDemands: [] });
    expect(result.moves.map(mv => [mv.machineName, mv.reason])).toEqual([
      ['CNC-050', 'surplus_release'], ['CNC-002', 'unassigned_fill'], ['CNC-003', 'zero_demand_release'],
    ]);
  });

  it('prefers the same building before crossing to another one', () => {
    const { machines, positions } = build([
      ['CNC-101', 'X', at(0, 0, 'B')],
      ['CNC-001', 'Y', at(0, 0, 'A')],     // same coordinates and lower name, but the other building
      ['CNC-300', 'Y', at(6, 3, 'B')],
    ]);
    const result = recommendLayout({ requirements: [req('X', 2, 1, 'shortage'), req('Y', 0, 2, 'surplus')], machines, positions, locked: new Set(), nextWeekDemands: [] });
    expect(result.moves.map(mv => mv.machineName)).toEqual(['CNC-300']);
  });

  it('never moves a locked machine, an inactive machine, or a machine of a group that is not computable', () => {
    const { machines, positions } = build([
      ['CNC-001', 'X', at(0, 0)], ['CNC-002', 'Y', at(1, 0)], ['CNC-003', 'U', at(2, 0)], ['CNC-004', 'Y', at(3, 0)],
    ]);
    machines[3] = { ...machines[3], isActive: false };
    const requirements = [req('X', 3, 1, 'shortage'), req('Y', 0, 2, 'surplus'), req('U', null, 1, 'no_tact')];
    const result = recommendLayout({ requirements, machines, positions, locked: new Set(['CNC-002']), nextWeekDemands: [] });
    expect(result.moves).toEqual([]);
    expect(result.unresolved).toEqual([{ modelId: 'X', processId: 'X-p', remaining: 2 }]);
  });

  it('uses a machine whose model has demand next week only as a last resort, and flags it', () => {
    const nextWeek: WeeklyModelDemand[] = [{ model: 'Y', week: 'w', peakQuantity: 100, peakDate: null, numericDays: 1, blankCells: 0, errorCells: 0, fractional: false, warnings: [] }];
    const { machines, positions } = build([['CNC-001', 'X', at(0, 0)], ['CNC-002', 'Y', at(1, 0)], ['CNC-009', 'Z', at(7, 7)]]);
    const result = recommendLayout({ requirements: [req('X', 3, 1, 'shortage'), req('Y', 0, 1, 'surplus'), req('Z', 0, 1, 'zero_demand')], machines, positions, locked: new Set(), nextWeekDemands: nextWeek });
    expect(result.moves.map(mv => [mv.machineName, mv.nextWeekDemand])).toEqual([['CNC-009', false], ['CNC-002', true]]);
  });

  it('seeds a brand-new group where the most usable neighbours are, then keeps it together', () => {
    const { machines, positions } = build([
      ['CNC-101', null, at(0, 0)], ['CNC-102', null, at(1, 0)], ['CNC-103', null, at(2, 0)],
      ['CNC-001', null, at(9, 6)],         // lowest name but alone: a poor place to start a group
    ]);
    const result = recommendLayout({ requirements: [req('N', 3, 0, 'shortage')], machines, positions, locked: new Set(), nextWeekDemands: [] });
    expect(result.moves.map(mv => mv.machineName)).toEqual(['CNC-102', 'CNC-101', 'CNC-103']);
  });

  it('fills the largest shortage first and is deterministic', () => {
    const { machines, positions } = build([['CNC-001', 'A', at(0, 0)], ['CNC-005', 'B', at(5, 0)], ['CNC-003', null, at(3, 0)]]);
    const input = { requirements: [req('A', 2, 1, 'shortage'), req('B', 4, 1, 'shortage')], machines, positions, locked: new Set<string>(), nextWeekDemands: [] };
    const first = recommendLayout(input);
    expect(first.moves.map(mv => [mv.machineName, mv.to.modelId])).toEqual([['CNC-003', 'B']]);
    expect(recommendLayout(input)).toEqual(first);
  });
});
