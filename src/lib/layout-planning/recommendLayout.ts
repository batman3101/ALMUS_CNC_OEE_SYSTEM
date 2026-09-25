import type { ForecastSnapshotMachine } from '@/types/forecast';
import type { ModelProcessRequirement } from '@/lib/forecast/requiredMachines';
import type { WeeklyModelDemand } from '@/lib/forecast/weeklyDemand';

/** Drawing position of one machine (layout geometry). Cell grid, not physical distance. */
export interface MachinePosition { building: string; x: number; y: number; width: number; height: number }

/** Where the moved machine came from; stored as `layout_plan_assignments.recommendation_reason`. */
export type MoveReason = 'surplus_release' | 'unassigned_fill' | 'zero_demand_release';
export interface Assignment { modelId: string | null; processId: string | null }
export interface LayoutMove {
  machineId: string; machineName: string;
  from: Assignment; to: { modelId: string; processId: string };
  reason: MoveReason; nextWeekDemand: boolean;
}
export interface LayoutRecommendation {
  moves: LayoutMove[];
  /** Shortages the pool could not cover. The user decides what to do (overtime, more machines, …). */
  unresolved: Array<{ modelId: string; processId: string; remaining: number }>;
}
export interface RecommendInput {
  requirements: ModelProcessRequirement[];
  machines: ForecastSnapshotMachine[];
  positions: ReadonlyMap<string, MachinePosition>;
  /** Machines the user pinned; never moved and never taken from. */
  locked: ReadonlySet<string>;
  nextWeekDemands: WeeklyModelDemand[];
}

/** Proven pool order (PRD 6.3, reassignment.ts): take from surplus, then idle machines, then zero-demand groups. */
const TIER: Record<MoveReason, number> = { surplus_release: 0, unassigned_fill: 1, zero_demand_release: 2 };
/** Another building is "far" whatever the coordinates say; used before any cross-building move is considered. */
const OTHER_BUILDING = 1e6;

const centre = (p: MachinePosition) => ({ x: p.x + p.width / 2, y: p.y + p.height / 2 });

/**
 * The 8 surrounding cells. Measured on W39: 116 × 72 pitch for 104 × 62 boxes, aisle rows 108 apart,
 * buildings 340 apart — so the thresholds (1.2 w, 1.3 h) include the next cell and exclude an aisle.
 */
export function areNeighbors(a: MachinePosition, b: MachinePosition): boolean {
  if (a.building !== b.building) return false;
  const [ca, cb] = [centre(a), centre(b)];
  const dx = Math.abs(ca.x - cb.x), dy = Math.abs(ca.y - cb.y);
  if (dx === 0 && dy === 0) return false;
  return dx <= Math.max(a.width, b.width) * 1.2 && dy <= Math.max(a.height, b.height) * 1.3;
}

/** Distance in machine-size units, so a horizontal and a vertical step weigh about the same. */
function distance(a: MachinePosition, b: MachinePosition): number {
  if (a.building !== b.building) return OTHER_BUILDING;
  const [ca, cb] = [centre(a), centre(b)];
  return Math.hypot((ca.x - cb.x) / a.width, (ca.y - cb.y) / a.height);
}

const groupKey = (modelId: string, processId: string) => `${modelId}\u0000${processId}`;

interface Candidate { machine: ForecastSnapshotMachine; reason: MoveReason; group: string | null; nextWeekDemand: boolean }

/**
 * Minimal-change recommendation with spatial grouping (user requirement 2026-09-25).
 *
 * Change count is fixed by the shortages: one moved machine fills one missing unit, and no machine is
 * moved unless a shortage needs it (surplus alone is kept — PRD 6.5). What this adds over the
 * quantity-only proposal is *which* machine moves:
 *   1. tier first — the proven order, with next-week-demand machines last (PRD 6.3);
 *   2. within a tier, the machine closest to the short group as it grows, so the group stays together
 *      (a brand-new group starts where the most usable machines touch, so it has room to grow);
 *   3. then the machine with the fewest neighbours of its own group — releasing from the edge keeps the
 *      source group together too;
 *   4. then machine name, so the result is reproducible.
 * Greedy, not a proven optimum of "togetherness"; the change count is still the minimum for the pool.
 */
export function recommendLayout({ requirements, machines, positions, locked, nextWeekDemands }: RecommendInput): LayoutRecommendation {
  const nextWeek = new Set(nextWeekDemands.filter(d => d.peakQuantity > 0).map(d => d.model));
  const usable = machines.filter(m => m.isActive && !locked.has(m.id));

  // Current members per group (active machines only), used both to grow short groups and to judge edges.
  const members = new Map<string, Set<string>>();
  for (const m of machines) {
    if (!m.isActive || !m.modelId || !m.processId) continue;
    const key = groupKey(m.modelId, m.processId);
    if (!members.has(key)) members.set(key, new Set());
    members.get(key)!.add(m.id);
  }

  const quota = new Map<string, number>();
  const pool: Candidate[] = [];
  for (const row of requirements) {
    if (!row.dbModel || !row.processId || row.gap === null || row.gap >= 0) continue;
    if (row.status !== 'surplus' && row.status !== 'zero_demand') continue;
    const key = groupKey(row.dbModel.id, row.processId);
    quota.set(key, -row.gap);
    const reason: MoveReason = row.status === 'surplus' ? 'surplus_release' : 'zero_demand_release';
    const nextWeekDemand = row.forecastModel !== null && nextWeek.has(row.forecastModel);
    for (const machine of usable) {
      if (machine.modelId === row.dbModel.id && machine.processId === row.processId) pool.push({ machine, reason, group: key, nextWeekDemand });
    }
  }
  for (const machine of usable) {
    if (!machine.modelId || !machine.processId) pool.push({ machine, reason: 'unassigned_fill', group: null, nextWeekDemand: false });
  }

  const shortages = requirements
    .flatMap(r => r.status === 'shortage' && r.dbModel && r.processId && r.gap !== null && r.gap > 0
      ? [{ modelId: r.dbModel.id, name: r.dbModel.name, process: r.process, processId: r.processId, remaining: r.gap }] : [])
    .sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name) || a.process.localeCompare(b.process));

  const used = new Set<string>();
  const moves: LayoutMove[] = [];
  const unresolved: LayoutRecommendation['unresolved'] = [];

  const sameGroupNeighbours = (c: Candidate): number => {
    if (!c.group) return 0;
    const pos = positions.get(c.machine.id);
    if (!pos) return 0;
    let count = 0;
    for (const id of members.get(c.group) ?? []) {
      if (id === c.machine.id) continue;
      const other = positions.get(id);
      if (other && areNeighbors(pos, other)) count++;
    }
    return count;
  };

  for (const shortage of shortages) {
    const target = groupKey(shortage.modelId, shortage.processId);
    const cluster = [...(members.get(target) ?? [])].flatMap(id => positions.get(id) ?? []);
    /**
     * Lower is better. With members: distance to the nearest one. With none (a brand-new group), seed where
     * the most still-usable machines touch the candidate, so the group has room to grow — returned negative
     * so that "more room" sorts first.
     */
    const placementCost = (c: Candidate, eligible: Candidate[]): number => {
      const pos = positions.get(c.machine.id);
      if (!pos) return Number.POSITIVE_INFINITY; // no drawing position: usable, but after every placed machine
      if (!cluster.length) {
        return -eligible.filter(o => o !== c && o.reason === c.reason && positions.has(o.machine.id)
          && areNeighbors(pos, positions.get(o.machine.id)!)).length;
      }
      return Math.min(...cluster.map(p => distance(pos, p)));
    };

    while (shortage.remaining > 0) {
      const eligible = pool.filter(c => !used.has(c.machine.id) && (c.group === null || (quota.get(c.group) ?? 0) > 0));
      if (!eligible.length) break;
      const scored = eligible.map(c => ({ c, key: [Number(c.nextWeekDemand), TIER[c.reason], placementCost(c, eligible), sameGroupNeighbours(c)] }));
      scored.sort((a, b) => {
        for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
        return a.c.machine.name.localeCompare(b.c.machine.name);
      });
      const pick = scored[0].c;
      used.add(pick.machine.id);
      if (pick.group) {
        quota.set(pick.group, (quota.get(pick.group) ?? 0) - 1);
        members.get(pick.group)?.delete(pick.machine.id);
      }
      if (!members.has(target)) members.set(target, new Set());
      members.get(target)!.add(pick.machine.id);
      const pos = positions.get(pick.machine.id);
      if (pos) cluster.push(pos);
      moves.push({
        machineId: pick.machine.id, machineName: pick.machine.name,
        from: { modelId: pick.machine.modelId, processId: pick.machine.processId },
        to: { modelId: shortage.modelId, processId: shortage.processId },
        reason: pick.reason, nextWeekDemand: pick.nextWeekDemand,
      });
      shortage.remaining--;
    }
    if (shortage.remaining > 0) unresolved.push({ modelId: shortage.modelId, processId: shortage.processId, remaining: shortage.remaining });
  }

  return { moves, unresolved };
}
