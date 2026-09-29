import type { ForecastProcess, ForecastSnapshotMachine } from '@/types/forecast';
import { hasUnreadableDemand, type ModelProcessRequirement } from './requiredMachines';

export type MoveReason = 'surplus' | 'unassigned' | 'zero_demand';
export interface ReassignmentMove {
  machineId: string; machineName: string; location: string;
  from: { model: string | null; process: ForecastProcess | null };
  to: { model: string; process: ForecastProcess };
  reason: MoveReason;
}
export interface ReassignmentProposal {
  moves: ReassignmentMove[];
  unresolved: Array<{ dbModel: string; process: ForecastProcess; remaining: number }>;
  summary: { required: number; current: number; shortage: number; surplus: number; changes: number };
}
export interface ReassignmentInput { requirements: ModelProcessRequirement[]; machines: ForecastSnapshotMachine[] }

const REASON_RANK: Record<MoveReason, number> = { surplus: 0, unassigned: 1, zero_demand: 2 };
const byNameDesc = (a: ForecastSnapshotMachine, b: ForecastSnapshotMachine) => b.name.localeCompare(a.name);

/**
 * Greedy, deterministic, quantity-only. One machine move = one change (PRD 6.4/6.5).
 * Pool order: surplus → unassigned → zero-demand. Next week's demand is not used — the Forecast beyond the planned
 * week changes too much to hold machines for it (user decision 2026-09-29, replaces PRD 6.3). Compatibility, changeover time and JIG are
 * not modeled — the output is a review draft, never an instruction.
 */
export function proposeReassignment({ requirements, machines }: ReassignmentInput): ReassignmentProposal {
  const pool: Array<{ machine: ForecastSnapshotMachine; from: ReassignmentMove['from']; reason: MoveReason }> = [];

  for (const row of requirements) {
    if (!row.dbModel || !row.processId || row.gap === null || row.gap >= 0) continue;
    if (row.status !== 'surplus' && row.status !== 'zero_demand') continue;
    if (hasUnreadableDemand(row.warnings)) continue; // lower-bound demand: its "surplus" is not proven (audit BUG-01)
    const { id: modelId, name: modelName } = row.dbModel;
    const candidates = machines.filter(m => m.isActive && m.modelId === modelId && m.processId === row.processId).sort(byNameDesc).slice(0, -row.gap);
    for (const machine of candidates) pool.push({ machine, from: { model: modelName, process: row.process }, reason: row.status });
  }
  for (const machine of machines.filter(m => m.isActive && (!m.modelId || !m.processId)).sort(byNameDesc)) {
    pool.push({ machine, from: { model: null, process: null }, reason: 'unassigned' });
  }
  pool.sort((a, b) => REASON_RANK[a.reason] - REASON_RANK[b.reason] || byNameDesc(a.machine, b.machine));

  const shortages = requirements
    .flatMap(r => r.status === 'shortage' && r.dbModel && r.gap !== null && r.gap > 0 ? [{ dbModel: r.dbModel.name, process: r.process, remaining: r.gap }] : [])
    .sort((a, b) => b.remaining - a.remaining || a.dbModel.localeCompare(b.dbModel) || a.process.localeCompare(b.process));

  const moves: ReassignmentMove[] = [];
  for (const shortage of shortages) {
    while (shortage.remaining > 0 && pool.length) {
      const { machine, from, reason } = pool.shift()!;
      moves.push({ machineId: machine.id, machineName: machine.name, location: machine.location, from, to: { model: shortage.dbModel, process: shortage.process }, reason });
      shortage.remaining--;
    }
  }
  const computed = requirements.filter(r => r.required !== null && r.gap !== null);
  return {
    moves,
    unresolved: shortages.filter(s => s.remaining > 0),
    summary: {
      required: computed.reduce((sum, r) => sum + (r.required ?? 0), 0),
      current: computed.reduce((sum, r) => sum + r.current, 0),
      shortage: computed.reduce((sum, r) => sum + Math.max(0, r.gap ?? 0), 0),
      surplus: computed.reduce((sum, r) => sum + Math.max(0, -(r.gap ?? 0)), 0),
      changes: moves.length,
    },
  };
}
