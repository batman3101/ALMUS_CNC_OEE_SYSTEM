import type { ForecastSnapshotMachine } from '@/types/forecast';
import { hasUnreadableDemand, type ModelProcessRequirement } from '@/lib/forecast/requiredMachines';
import type { WeeklyModelDemand } from '@/lib/forecast/weeklyDemand';

/**
 * Drawing position of one machine (layout geometry). Cell grid, not physical distance.
 * `walkway`/`side`: the operator walkway (red line on the drawing) this machine faces and which side of it
 * (20260928130000). Absent for drawings whose walkways are not known yet — those use the distance rules.
 */
export interface MachinePosition {
  building: string; x: number; y: number; width: number; height: number;
  walkway?: string | null; side?: 'L' | 'R' | null;
}

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
  /** processId → process name ('CNC1', 'CNC2', …) for the "one process per walkway" rule. Falls back to the id. */
  processNames?: ReadonlyMap<string, string>;
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
export function recommendLayout(input: RecommendInput): LayoutRecommendation {
  const placed = input.machines.filter(m => m.isActive && input.positions.has(m.id));
  // Walkway rules only when the whole drawing carries them; a half-known drawing would mix two rule sets.
  const walkwayMode = placed.length > 0 && placed.every(m => !!input.positions.get(m.id)?.walkway && !!input.positions.get(m.id)?.side);
  if (!walkwayMode) return recommendByDistance(input);
  // Rule 3 guard (user decision 2026-09-28): converting a whole column beyond the need is allowed only when the
  // spare machines can still cover every shortage. Compared on the whole plan, because whether an excess starves
  // another model only shows once every shortage has been tried.
  const withExcess = recommendByWalkway(input, true);
  const short = (r: LayoutRecommendation) => r.unresolved.reduce((sum, u) => sum + u.remaining, 0);
  if (!short(withExcess)) return withExcess;
  const withoutExcess = recommendByWalkway(input, false);
  return short(withoutExcess) < short(withExcess) ? withoutExcess : withExcess;
}

function recommendByDistance({ requirements, machines, positions, locked, nextWeekDemands }: RecommendInput): LayoutRecommendation {
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
    if (hasUnreadableDemand(row.warnings)) continue; // lower-bound demand: its "surplus" is not proven (audit BUG-01)
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

// ── Walkway rules (user decisions 2026-09-28) ──────────────────────────────────────────────────
//
// On the drawing a red line is an operator walkway; the two columns facing it are one operator's work, and
// the walkway ends at a cross aisle. The unit of grouping is therefore the walkway, not distance:
//   1. one process per walkway first (mixing processes only when nothing else is possible);
//   2. if a walkway must hold two, split it by side (a whole column each) first, then as top/bottom end
//      blocks of a column — never insert into the middle of a column;
//   3. walkway rules win over the minimum change count: a whole column may be converted even if it exceeds
//      the need, as long as the excess is less than half the column; otherwise an end block of the need;
//   4. more walkways of one model go next to each other (neighbouring walkway numbers);
//   5. a machine that is the odd one out in its column (e.g. CNC-613: one DM 3 inside an M3-C2 column) is only
//      ever changed into its column's model·process — never used to start something else in the middle;
//   6. only shortages cause changes (existing mixed walkways are not tidied up on their own).
// Moves happen in blocks: every candidate block is a contiguous run of one column, scored as a whole.

interface Block { ids: string[]; key: number[]; firstName: string }

function recommendByWalkway({ requirements, machines, positions, locked, nextWeekDemands, processNames }: RecommendInput, allowExcess: boolean): LayoutRecommendation {
  const nextWeek = new Set(nextWeekDemands.filter(d => d.peakQuantity > 0).map(d => d.model));
  const active = machines.filter(m => m.isActive && positions.has(m.id));
  const byId = new Map(active.map(m => [m.id, m]));

  // Columns: one side of one walkway, top → bottom.
  const columns = new Map<string, string[]>();
  for (const m of active) {
    const p = positions.get(m.id)!;
    const key = `${p.walkway}|${p.side}`;
    if (!columns.has(key)) columns.set(key, []);
    columns.get(key)!.push(m.id);
  }
  for (const ids of columns.values()) ids.sort((a, b) => positions.get(a)!.y - positions.get(b)!.y);
  const walkwayOf = (column: string) => column.slice(0, column.lastIndexOf('|'));
  const walkways = new Map<string, string[]>();
  for (const column of columns.keys()) {
    const w = walkwayOf(column);
    if (!walkways.has(w)) walkways.set(w, []);
    walkways.get(w)!.push(column);
  }

  // Current assignment, updated as moves are made.
  const current = new Map<string, string | null>(active.map(m => [m.id, m.modelId && m.processId ? groupKey(m.modelId, m.processId) : null]));
  const processOf = (group: string | null | undefined) => {
    if (!group) return null;
    const processId = group.slice(group.indexOf('\u0000') + 1);
    return processNames?.get(processId) ?? processId;
  };
  const modelOf = (group: string | null | undefined) => (group ? group.slice(0, group.indexOf('\u0000')) : null);

  // Rule 5: the odd one out of a column (the column's main group holds more than half of it).
  const onlyFor = new Map<string, string>();
  for (const ids of columns.values()) {
    const counts = new Map<string, number>();
    for (const id of ids) { const g = current.get(id); if (g) counts.set(g, (counts.get(g) ?? 0) + 1); }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top || top[1] * 2 <= ids.length) continue;
    for (const id of ids) if (current.get(id) !== top[0]) onlyFor.set(id, top[0]);
  }

  // Pool and quota: the same proven sources as the distance rules (PRD 6.3).
  const quota = new Map<string, number>();
  const pool = new Map<string, Candidate>();
  for (const row of requirements) {
    if (!row.dbModel || !row.processId || row.gap === null || row.gap >= 0) continue;
    if (row.status !== 'surplus' && row.status !== 'zero_demand') continue;
    if (hasUnreadableDemand(row.warnings)) continue; // lower-bound demand: its "surplus" is not proven (audit BUG-01)
    const key = groupKey(row.dbModel.id, row.processId);
    quota.set(key, -row.gap);
    const reason: MoveReason = row.status === 'surplus' ? 'surplus_release' : 'zero_demand_release';
    const nextWeekDemand = row.forecastModel !== null && nextWeek.has(row.forecastModel);
    for (const m of active) {
      if (!locked.has(m.id) && m.modelId === row.dbModel.id && m.processId === row.processId) pool.set(m.id, { machine: m, reason, group: key, nextWeekDemand });
    }
  }
  for (const m of active) {
    if (!locked.has(m.id) && (!m.modelId || !m.processId)) pool.set(m.id, { machine: m, reason: 'unassigned_fill', group: null, nextWeekDemand: false });
  }

  const shortages = requirements
    .flatMap(r => r.status === 'shortage' && r.dbModel && r.processId && r.gap !== null && r.gap > 0
      ? [{ modelId: r.dbModel.id, name: r.dbModel.name, process: r.process, processId: r.processId, remaining: r.gap }] : [])
    .sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name) || a.process.localeCompare(b.process));

  const used = new Set<string>();
  const moves: LayoutMove[] = [];
  const unresolved: LayoutRecommendation['unresolved'] = [];

  /**
   * Columns a block may attach to (user decision 2026-09-28 — no islands): the column facing it across the walkway,
   * and the column whose back touches it (walkway n's R side and walkway n+1's L side, same building and aisle side).
   * Walkway key: '<building>-<nn>-<U|D>'.
   */
  const neighbourColumns = (column: string): string[] => {
    const walkway = walkwayOf(column), side = column.slice(column.lastIndexOf('|') + 1);
    const [b, n, ud] = walkway.split('-');
    const next = Number(n) + (side === 'R' ? 1 : -1);
    const back = `${b}-${String(next).padStart(n.length, '0')}-${ud}|${side === 'R' ? 'L' : 'R'}`;
    return [`${walkway}|${side === 'L' ? 'R' : 'L'}`, back].filter(c => columns.has(c));
  };
  const roomAround = (column: string, available: (id: string) => boolean) => {
    const bySource = new Map<string | null, number>();
    for (const c of [column, ...neighbourColumns(column)]) {
      for (const id of columns.get(c)!) {
        if (!available(id)) continue;
        const g = pool.get(id)!.group;
        bySource.set(g, (bySource.get(g) ?? 0) + 1);
      }
    }
    return [...bySource].reduce((sum, [g, n]) => sum + (g === null ? n : Math.min(n, quota.get(g) ?? 0)), 0);
  };
  const runsOf = (groups: Array<string | null | undefined>) => groups.filter((g, i) => i === 0 || g !== groups[i - 1]).length;
  const rowSpan = (ids: string[]) => ({ top: positions.get(ids[0])!.y, bottom: positions.get(ids[ids.length - 1])!.y });
  /** Two machines are side by side when their rows overlap — one row pitch of tolerance (72 on a 62-high box). */
  const tolerance = Math.max(...active.map(m => positions.get(m.id)!.height)) * 1.3;

  // Members of each model·process as moves are made, for the source-side island check below.
  const membersOf = new Map<string, Set<string>>();
  for (const [id, g] of current) if (g) { if (!membersOf.has(g)) membersOf.set(g, new Set()); membersOf.get(g)!.add(id); }
  const columnOf = new Map<string, string>();
  for (const [column, ids] of columns) for (const id of ids) columnOf.set(id, column);
  /**
   * Pieces a model·process forms without `leaving`: next to each other in one column, or rows overlapping in the
   * facing / back-to-back column. Same connectivity as the attach rule and as puzzleRules.groupsOf on the screen.
   */
  const piecesOf = (group: string, leaving: ReadonlySet<string>) => {
    const members = [...(membersOf.get(group) ?? [])].filter(id => !leaving.has(id));
    const set = new Set(members);
    const parent = new Map(members.map(id => [id, id]));
    const find = (id: string): string => { while (parent.get(id) !== id) id = parent.get(id)!; return id; };
    const join = (a: string, b: string) => parent.set(find(a), find(b));
    for (const id of members) {
      const column = columnOf.get(id)!, ids = columns.get(column)!;
      const next = ids[ids.indexOf(id) + 1];
      if (next !== undefined && set.has(next)) join(id, next);
      const y = positions.get(id)!.y;
      for (const c of neighbourColumns(column)) {
        for (const other of columns.get(c)!) if (set.has(other) && Math.abs(positions.get(other)!.y - y) <= tolerance) join(id, other);
      }
    }
    return new Set(members.map(find)).size;
  };
  const NONE: ReadonlySet<string> = new Set();

  for (const shortage of shortages) {
    const target = groupKey(shortage.modelId, shortage.processId);
    const targetProcess = processOf(target);
    const available = (id: string) => {
      const c = pool.get(id);
      if (!c || used.has(id) || current.get(id) === target) return false;
      const only = onlyFor.get(id);
      return !only || only === target;
    };

    while (shortage.remaining > 0) {
      const need = shortage.remaining;
      const hasMembers = active.some(m => current.get(m.id) === target);
      /** Target machines already in `column` whose rows touch [top, bottom]. */
      const touches = (column: string, top: number, bottom: number) => columns.get(column)!
        .some(id => current.get(id) === target && positions.get(id)!.y >= top - tolerance && positions.get(id)!.y <= bottom + tolerance);
      const blocks: Block[] = [];
      const piecesNow = new Map<string, number>();
      const piecesBefore = (g: string) => { if (!piecesNow.has(g)) piecesNow.set(g, piecesOf(g, NONE)); return piecesNow.get(g)!; };

      for (const [column, ids] of columns) {
        const walkway = walkwayOf(column);
        const runsBefore = runsOf(ids.map(id => current.get(id)));
        for (let i = 0; i < ids.length; i++) {
          const taken = new Map<string, number>();
          for (let j = i; j < ids.length && available(ids[j]); j++) {
            const g = pool.get(ids[j])!.group;
            if (g) {
              taken.set(g, (taken.get(g) ?? 0) + 1);
              if (taken.get(g)! > (quota.get(g) ?? 0)) break;       // never take more than a source can give
            }
            const range = new Set(ids.slice(i, j + 1));
            const after = ids.map(id => (range.has(id) ? target : current.get(id)));
            // Rule 2: the target's machines in this column stay one run touching an end — no middle insertion.
            const first = after.indexOf(target), last = after.lastIndexOf(target);
            if (after.slice(first, last + 1).some(x => x !== target)) continue;
            if (first !== 0 && last !== ids.length - 1) continue;
            const wholeColumn = after.every(x => x === target);
            // Rule 3: exceed the need only to finish a whole column, and by less than half of it.
            const excess = range.size - need;
            if (excess > 0 && !(allowExcess && wholeColumn && excess * 2 < ids.length)) continue;
            // A column holds at most two pieces (top block + bottom block); one already in more is not split further.
            if (runsOf(after) > Math.max(2, runsBefore)) continue;
            // No islands (user decision 2026-09-28): once the model·process has machines, a block must continue its own
            // column or sit beside them in the facing / back-to-back column. Nowhere to attach → left as a shortage
            // alert for the user to fine-tune. A model with no machines yet starts one group here and grows from it.
            const span = rowSpan(ids.slice(i, j + 1));
            const attached = !hasMembers || ids.some(id => current.get(id) === target)
              || neighbourColumns(column).some(c => touches(c, span.top, span.bottom));
            if (!attached) continue;
            // No islands on the source side either (user decision 2026-09-29, W42 H8 SUB): taking a block must not split
            // what stays behind — e.g. a whole column that was the bridge between two columns of its group.
            if ([...taken.keys()].some(g => piecesOf(g, range) > piecesBefore(g))) continue;
            // Where a new group starts, it needs room to grow: what it could still take here and next door, each source
            // counted only up to what that source can still give (a surplus of 2 is 2, however many machines it has).
            const room = hasMembers ? need : roomAround(column, available);

            const walkwayGroups = walkways.get(walkway)!.flatMap(c => columns.get(c)!.map(id => (range.has(id) ? target : current.get(id))));
            const otherProcess = walkwayGroups.filter(x => x && processOf(x) !== targetProcess).length;
            const otherModel = walkwayGroups.filter(x => x && modelOf(x) !== shortage.modelId).length;
            const picked = [...range].map(id => pool.get(id)!);
            blocks.push({
              ids: [...range], firstName: byId.get(ids[i])!.name,
              key: [
                // Rule 1 first (user decision 2026-09-29): keeping the walkway to one process outranks sparing machines
                // whose model has demand next week — those were winning, and mixed walkways that had a clean option.
                Number(otherProcess > 0),
                Math.max(...picked.map(c => Number(c.nextWeekDemand))),   // next-week demand last (PRD 6.3)
                // A new group's start decides whether it can grow as one group at all (no islands), so room comes
                // before the source order — starting on 2 surplus machines with nowhere to grow strands the rest.
                Math.max(0, need - room),
                Math.max(...picked.map(c => TIER[c.reason])),             // proven source order
                Number(!wholeColumn),                                   // rule 2: a whole side before an end block
                otherProcess,                                             // less process mixing
                otherModel,                                               // then less model mixing
                Math.max(0, excess),                                      // least excess
                Math.abs(need - range.size),                              // closest to the need
                -range.size,                                              // fewer, larger blocks
              ],
            });
          }
        }
      }
      if (!blocks.length) break;
      blocks.sort((a, b) => {
        for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
        return a.firstName.localeCompare(b.firstName);
      });
      for (const id of blocks[0].ids) {
        const pick = pool.get(id)!;
        used.add(id);
        if (pick.group) quota.set(pick.group, (quota.get(pick.group) ?? 0) - 1);
        const was = current.get(id);
        if (was) membersOf.get(was)?.delete(id);
        if (!membersOf.has(target)) membersOf.set(target, new Set());
        membersOf.get(target)!.add(id);
        current.set(id, target);
        moves.push({
          machineId: id, machineName: pick.machine.name,
          from: { modelId: pick.machine.modelId, processId: pick.machine.processId },
          to: { modelId: shortage.modelId, processId: shortage.processId },
          reason: pick.reason, nextWeekDemand: pick.nextWeekDemand,
        });
        shortage.remaining--;
      }
    }
    if (shortage.remaining > 0) unresolved.push({ modelId: shortage.modelId, processId: shortage.processId, remaining: shortage.remaining });
  }

  return { moves, unresolved };
}
