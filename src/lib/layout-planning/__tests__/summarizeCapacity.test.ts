import { summarizeCapacity, type PlanRequirement } from '../summarizeCapacity';

const req = (modelId: string, processId: string, peak: number, daily: number | null, required: number | null): PlanRequirement =>
  ({ modelId, modelName: modelId.toUpperCase(), processId, processName: processId, forecastModel: modelId, peakQuantity: peak, dailyCapacityPerMachine: daily, requiredMachines: required });
const at = (machineId: string, modelId: string | null, processId: string | null) => ({ machineId, modelId, processId });

describe('capacity alerts per model/process from the final layout', () => {
  const requirements = [req('a', 'c1', 1000, 130, 8), req('b', 'c1', 390, 130, 3), req('c', 'c2', 0, 130, 0), req('d', 'c1', 500, null, null)];

  it('counts final assignments per group and classifies shortage, surplus, zero demand and not computable', () => {
    const final = [
      ...Array.from({ length: 6 }, (_, i) => at(`a${i}`, 'a', 'c1')),
      ...Array.from({ length: 5 }, (_, i) => at(`b${i}`, 'b', 'c1')),
      at('c0', 'c', 'c2'), at('d0', 'd', 'c1'), at('idle', null, null), at('x0', 'x', 'c9'),
    ];
    const { groups, totals } = summarizeCapacity(requirements, final);
    const by = (m: string) => groups.find(g => g.modelId === m)!;
    expect(by('a')).toMatchObject({ required: 8, assigned: 6, gap: -2, spare: 0, status: 'shortage' });
    expect(by('b')).toMatchObject({ required: 3, assigned: 5, gap: 2, spare: 2, status: 'surplus' });
    expect(by('c')).toMatchObject({ required: 0, assigned: 1, spare: 1, status: 'zero_demand' });
    // NULL is "not computable", never 0 and never "ok".
    expect(by('d')).toMatchObject({ required: null, assigned: 1, gap: null, spare: null, capacity: null, utilization: null, status: 'not_computable' });
    expect(by('x')).toMatchObject({ assigned: 1, required: null, status: 'not_in_forecast' });
    expect(totals).toEqual({ shortageMachines: 2, spareMachines: 3, unassignedMachines: 1, notComputableGroups: 1 });
  });

  it('reports daily capacity and utilisation so the user can judge whether a group can take more', () => {
    const { groups } = summarizeCapacity(requirements, Array.from({ length: 5 }, (_, i) => at(`b${i}`, 'b', 'c1')));
    // 5 machines × 130/day = 650 against a 390 peak → 60% busy, 2 machines spare.
    expect(groups.find(g => g.modelId === 'b')).toMatchObject({ capacity: 650, utilization: 0.6, spare: 2 });
  });

  it('lists problems first: shortages by size, then not computable, then surplus', () => {
    const final = [at('a0', 'a', 'c1'), ...Array.from({ length: 5 }, (_, i) => at(`b${i}`, 'b', 'c1'))];
    const order = summarizeCapacity([req('b', 'c1', 390, 130, 3), req('a', 'c1', 1000, 130, 8), req('e', 'c1', 300, 130, 3), req('d', 'c1', 1, null, null)], final)
      .groups.map(g => [g.modelId, g.status]);
    expect(order).toEqual([['a', 'shortage'], ['e', 'shortage'], ['d', 'not_computable'], ['b', 'surplus']]);
  });
});
