/** One (model, process) demand line of a layout plan — the snapshot stored in `layout_plan_requirements`. */
export interface PlanRequirement {
  modelId: string; modelName: string; processId: string; processName: string;
  forecastModel: string; peakQuantity: number;
  /** Pieces one machine makes per day (OEE input formula). NULL = no usable T/T. */
  dailyCapacityPerMachine: number | null;
  /** NULL = not computable. Never 0 in disguise. */
  requiredMachines: number | null;
}
export interface FinalAssignment { machineId: string; modelId: string | null; processId: string | null }

export type CapacityStatus = 'shortage' | 'not_computable' | 'surplus' | 'zero_demand' | 'not_in_forecast' | 'ok';
export interface GroupCapacity {
  modelId: string; modelName: string | null; processId: string; processName: string | null; forecastModel: string | null;
  peakQuantity: number | null;
  required: number | null;
  assigned: number;
  /** assigned − required: negative = short, positive = spare. NULL when required is unknown. */
  gap: number | null;
  /** Machines the group could give away while still meeting its peak. NULL when unknown. */
  spare: number | null;
  /** assigned × daily capacity per machine. */
  capacity: number | null;
  /** peak ÷ capacity (0..n). >1 means the group cannot meet its peak day. */
  utilization: number | null;
  status: CapacityStatus;
}
export interface CapacitySummary {
  groups: GroupCapacity[];
  totals: { shortageMachines: number; spareMachines: number; unassignedMachines: number; notComputableGroups: number };
}

/** Problems first (user requirement 5: the alert must be where the eye lands). */
const RANK: Record<CapacityStatus, number> = { shortage: 0, not_computable: 1, surplus: 2, zero_demand: 3, not_in_forecast: 4, ok: 5 };
const key = (modelId: string, processId: string) => `${modelId}\u0000${processId}`;

/**
 * Capacity alerts for a layout — recomputed from the *final* assignments on every fine-tune, so the user
 * sees at once whether moving a machine opened a shortage or freed spare capacity. The decision to act on
 * a surplus stays with the user (requirement 5); nothing here moves machines.
 */
export function summarizeCapacity(requirements: PlanRequirement[], assignments: FinalAssignment[]): CapacitySummary {
  const counts = new Map<string, number>();
  let unassignedMachines = 0;
  for (const a of assignments) {
    if (!a.modelId || !a.processId) { unassignedMachines++; continue; }
    const k = key(a.modelId, a.processId);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }

  const groups: GroupCapacity[] = requirements.map(r => {
    const assigned = counts.get(key(r.modelId, r.processId)) ?? 0;
    const base = { modelId: r.modelId, modelName: r.modelName, processId: r.processId, processName: r.processName, forecastModel: r.forecastModel, peakQuantity: r.peakQuantity, assigned };
    if (r.requiredMachines === null || r.dailyCapacityPerMachine === null) {
      return { ...base, required: null, gap: null, spare: null, capacity: null, utilization: null, status: 'not_computable' as const };
    }
    const capacity = assigned * r.dailyCapacityPerMachine;
    const gap = assigned - r.requiredMachines;
    const utilization = capacity > 0 ? r.peakQuantity / capacity : null;
    const status: CapacityStatus = r.requiredMachines === 0 ? (assigned > 0 ? 'zero_demand' : 'ok') : gap < 0 ? 'shortage' : gap > 0 ? 'surplus' : 'ok';
    return { ...base, required: r.requiredMachines, gap, spare: Math.max(0, gap), capacity, utilization, status };
  });

  // Machines on a model/process the forecast never mentions: demand unknown, shown so they are not forgotten.
  const planned = new Set(requirements.map(r => key(r.modelId, r.processId)));
  for (const [k, assigned] of counts) {
    if (planned.has(k)) continue;
    const [modelId, processId] = k.split('\u0000');
    groups.push({ modelId, modelName: null, processId, processName: null, forecastModel: null, peakQuantity: null, required: null, assigned, gap: null, spare: null, capacity: null, utilization: null, status: 'not_in_forecast' });
  }

  groups.sort((a, b) => RANK[a.status] - RANK[b.status] || (a.gap ?? 0) - (b.gap ?? 0) || (a.modelName ?? a.modelId).localeCompare(b.modelName ?? b.modelId));

  return {
    groups,
    totals: {
      shortageMachines: groups.reduce((sum, g) => sum + (g.status === 'shortage' ? -(g.gap ?? 0) : 0), 0),
      spareMachines: groups.reduce((sum, g) => sum + (g.status === 'surplus' || g.status === 'zero_demand' ? g.spare ?? 0 : 0), 0),
      unassignedMachines,
      notComputableGroups: groups.filter(g => g.status === 'not_computable').length,
    },
  };
}
