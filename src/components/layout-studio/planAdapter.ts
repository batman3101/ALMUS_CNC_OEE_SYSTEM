import { summarizeCapacity, type CapacitySummary, type GroupCapacity, type PlanRequirement } from '@/lib/layout-planning/summarizeCapacity';
import type { ForecastCapacitySnapshot } from '@/types/forecast';

/**
 * Server plan ⇄ studio engine. The engine (ported preview) speaks machine *numbers* and code strings
 * ('ON1' / 'C1'); the server speaks uuids. Everything that crosses that line goes through here, so a wrong
 * conversion cannot save the wrong machine unnoticed (see planAdapter.test.ts).
 */

export interface WorkspacePayload {
  geometry: null | {
    id: string; sourceFile: string; sourceSheet: string | null; sourceHash: string;
    positions: Array<{ machineId: string; building: string; cell: string; x: number; y: number; width: number; height: number }>;
  };
  snapshot: ForecastCapacitySnapshot;
}
export interface PlanAssignmentRow {
  machine_id: string;
  base_model_id: string | null; base_process_id: string | null;
  recommended_model_id: string | null; recommended_process_id: string | null;
  final_model_id: string | null; final_process_id: string | null;
  is_locked: boolean;
}
export interface SetupTaskRow {
  id: string; machine_id: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled'; revision: number;
  before_model_id: string | null; before_process_id: string | null; target_model_id: string | null; target_process_id: string | null;
  created_at: string; started_at: string | null; completed_at: string | null;
}
export interface PlanPayload {
  plan: { id: string; status: 'draft' | 'confirmed' | 'superseded' | 'discarded'; revision: number; title: string };
  requirements: PlanRequirement[];
  assignments: PlanAssignmentRow[];
  setupTasks: SetupTaskRow[];
}

type Code = { model: string; process: string };
export interface StudioDraft { edits: Record<number, Code>; locks: number[]; demo: boolean }
export interface StudioSetup {
  previewOnly: false; sourceHash: string; version: string; at: string;
  tasks: Record<number, { before: Code; target: Code; status: 'pending' | 'in_progress' | 'completed'; events: Array<{ status: string; at: string; actor: string }> }>;
}
export interface StudioGroup extends GroupCapacity { code: string; model: string; process: string }

/** 'CNC #1' → 'C1', 'CNC # 2' → 'C2', 'CNC #2-1' → 'C2-1' (sub-processes stay distinct). */
export function processCode(name: string): string {
  const digits = name.replace(/^\s*CNC\s*#?\s*/i, '').replace(/\s+/g, '');
  return 'C' + (digits || name.replace(/\s+/g, ''));
}

const machineNumber = (name: string, fallback: number) => {
  const match = /(\d+)\s*$/.exec(name);
  return match ? Number(match[1]) : fallback;
};

export function buildStudioView(workspace: WorkspacePayload, plan: PlanPayload | null) {
  if (!workspace.geometry) throw new Error('no geometry');
  if (workspace.snapshot.status !== 'available') throw new Error('snapshot unavailable');
  const { models, machines } = workspace.snapshot;

  const modelName = new Map(models.map(m => [m.id, m.name]));
  const processByKey = new Map<string, string>();          // `${modelName}\u0000${code}` → process id
  const codeOfProcess = new Map<string, string>();         // process id → code
  const processesByModel: Record<string, string[]> = {};
  for (const m of models) {
    const sorted = [...m.processes].sort((a, b) => a.order - b.order);
    for (const p of sorted) {
      const code = processCode(p.name);
      codeOfProcess.set(p.id, code);
      processByKey.set(`${m.name}\u0000${code}`, p.id);
    }
    if (m.isActive) processesByModel[m.name] = [...new Set(sorted.map(p => processCode(p.name)))];
  }
  const codeOf = (modelId: string | null, processId: string | null): Code =>
    modelId && processId ? { model: modelName.get(modelId) ?? modelId, process: codeOfProcess.get(processId) ?? '' } : { model: '', process: '' };
  const idsOf = (code: Code): { modelId: string | null; processId: string | null } => {
    if (!code.model) return { modelId: null, processId: null };
    const model = models.find(m => m.name === code.model);
    return { modelId: model?.id ?? null, processId: processByKey.get(`${code.model}\u0000${code.process}`) ?? null };
  };

  const machineById = new Map(machines.map(m => [m.id, m]));
  const assignmentById = new Map((plan?.assignments ?? []).map(a => [a.machine_id, a]));
  const numberOf = new Map<string, number>();
  const idOfNumber = new Map<number, string>();
  let fallback = 9000;
  const studioMachines = workspace.geometry.positions
    .flatMap(p => {
      const machine = machineById.get(p.machineId);
      if (!machine) return [];
      let no = machineNumber(machine.name, fallback++);
      while (idOfNumber.has(no)) no = fallback++;
      numberOf.set(machine.id, no); idOfNumber.set(no, machine.id);
      const a = assignmentById.get(machine.id);
      const base = a ? codeOf(a.base_model_id, a.base_process_id) : codeOf(machine.modelId, machine.processId);
      return [{ id: no, uuid: machine.id, building: p.building, cell: p.cell, x: p.x, y: p.y, width: p.width, height: p.height, ...base }];
    })
    .sort((a, b) => a.id - b.id);

  const byBuilding = new Map<string, typeof studioMachines>();
  for (const m of studioMachines) byBuilding.set(m.building, [...(byBuilding.get(m.building) ?? []), m]);
  // Building frames around their machines, with the preview's margins (name/count label above the first row).
  const buildings = [...byBuilding.entries()].map(([id, list]) => {
    const minX = Math.min(...list.map(m => m.x)), minY = Math.min(...list.map(m => m.y));
    const maxX = Math.max(...list.map(m => m.x + m.width)), maxY = Math.max(...list.map(m => m.y + m.height));
    return { id, count: list.length, x: minX - 32, y: minY - 78, width: maxX - minX + 64, height: maxY - minY + 110 };
  }).sort((a, b) => a.y - b.y || a.id.localeCompare(b.id));

  const toDraft = (pick: (a: PlanAssignmentRow) => [string | null, string | null], demo: boolean): StudioDraft => {
    const edits: Record<number, Code> = {};
    const locks: number[] = [];
    for (const m of studioMachines) {
      const a = assignmentById.get(m.uuid);
      if (!a) continue;
      const code = codeOf(...pick(a));
      if (code.model !== m.model || code.process !== m.process) edits[m.id] = code;
      if (a.is_locked) locks.push(m.id);
    }
    return { edits, locks, demo };
  };
  const draft = plan ? toDraft(a => [a.final_model_id, a.final_process_id], true) : { edits: {}, locks: [], demo: false };
  const recommended = plan ? toDraft(a => [a.recommended_model_id, a.recommended_process_id], true) : draft;

  const setupRefs = new Map<number, { id: string; revision: number }>();
  const setup: StudioSetup | null = plan && plan.setupTasks.length ? {
    previewOnly: false, sourceHash: workspace.geometry.sourceHash, version: plan.plan.title, at: plan.setupTasks[0].created_at,
    tasks: Object.fromEntries(plan.setupTasks.flatMap(task => {
      const no = numberOf.get(task.machine_id);
      if (no === undefined || task.status === 'cancelled') return [];
      setupRefs.set(no, { id: task.id, revision: task.revision });
      const events = [
        { status: 'pending', at: task.created_at, actor: '' },
        ...(task.started_at ? [{ status: 'in_progress', at: task.started_at, actor: '' }] : []),
        ...(task.completed_at ? [{ status: 'completed', at: task.completed_at, actor: '' }] : []),
      ];
      return [[no, { before: codeOf(task.before_model_id, task.before_process_id), target: codeOf(task.target_model_id, task.target_process_id), status: task.status, events }]];
    })),
  } : null;

  /** The final layout a draft describes, per machine uuid, with locks. */
  const finalOf = (d: StudioDraft) => studioMachines.map(m => {
    const code = d.edits[m.id] ?? { model: m.model, process: m.process };
    return { machineId: m.uuid, no: m.id, ...idsOf(code), locked: d.locks.includes(m.id) };
  });

  let saved = new Map(finalOf(draft).map(f => [f.machineId, f]));
  const requirements = plan?.requirements ?? [];

  return {
    readOnly: !plan || plan.plan.status !== 'draft',
    data: {
      source: workspace.geometry.sourceFile, sheet: workspace.geometry.sourceSheet ?? '', sha256: workspace.geometry.sourceHash,
      machines: studioMachines, buildings,
      models: [...new Set(models.filter(m => m.isActive).map(m => m.name))].sort((a, b) => a.localeCompare(b)),
      processes: [...new Set(Object.values(processesByModel).flat())].sort(),
      processesByModel,
    },
    initial: { draft, recommended, setup },
    /** Server changes needed to go from the last saved state to `d` (only machines that differ). */
    changesFor(d: StudioDraft) {
      return finalOf(d).flatMap(f => {
        const prev = saved.get(f.machineId);
        if (prev && prev.modelId === f.modelId && prev.processId === f.processId && prev.locked === f.locked) return [];
        return [{ machineId: f.machineId, finalModelId: f.modelId, finalProcessId: f.processId, isLocked: f.locked }];
      });
    },
    markSaved(d: StudioDraft) { saved = new Map(finalOf(d).map(f => [f.machineId, f])); },
    summarize(d: StudioDraft): { groups: StudioGroup[]; totals: CapacitySummary['totals'] } {
      const summary = summarizeCapacity(requirements, finalOf(d).map(f => ({ machineId: f.machineId, modelId: f.modelId, processId: f.processId })));
      return {
        totals: summary.totals,
        groups: summary.groups.map(g => {
          const code = codeOf(g.modelId, g.processId);
          return { ...g, model: code.model, process: code.process, code: `${code.model}-${code.process}` };
        }),
      };
    },
    taskRef: (no: number) => setupRefs.get(no) ?? null,
    machineUuid: (no: number) => idOfNumber.get(no) ?? null,
  };
}

export type StudioView = ReturnType<typeof buildStudioView>;
