import { buildStudioView, processCode, type PlanPayload, type WorkspacePayload } from '../planAdapter';

const P = (id: string, name: string, order: number, tact: number | null = 600) => ({ id, name, order, tactTimeSeconds: tact });
const workspace: WorkspacePayload = {
  geometry: {
    id: 'g1', sourceFile: 'Setting CNC.xlsx', sourceSheet: 'W39', sourceHash: 'hash',
    positions: [
      { machineId: 'm-305', building: 'B', cell: 'U20', x: 60, y: 100, width: 104, height: 62 },
      { machineId: 'm-306', building: 'B', cell: 'U22', x: 176, y: 100, width: 104, height: 62 },
      { machineId: 'm-449', building: 'A', cell: 'B43', x: 60, y: 1700, width: 104, height: 62 },
      { machineId: 'm-500', building: 'A', cell: 'C43', x: 176, y: 1700, width: 104, height: 62 },
    ],
  },
  snapshot: {
    status: 'available', takenAt: 't',
    models: [
      { id: 'on1', name: 'ON1', isActive: true, processes: [P('on1-1', 'CNC #1', 1), P('on1-2', 'CNC #2', 2)] },
      { id: 'h8', name: 'H8 M', isActive: true, processes: [P('h8-0', 'CNC #0', 1, 63), P('h8-1', 'CNC #1', 2), P('h8-2', 'CNC # 2', 3)] },
      { id: 'old', name: 'OLD', isActive: false, processes: [P('old-1', 'CNC #1', 1)] },
    ],
    machines: [
      { id: 'm-305', name: 'CNC-305', location: '', isActive: true, modelId: 'on1', processId: 'on1-1' },
      { id: 'm-306', name: 'CNC-306', location: '', isActive: true, modelId: 'on1', processId: 'on1-1' },
      { id: 'm-449', name: 'CNC-449', location: '', isActive: true, modelId: null, processId: null },
      { id: 'm-500', name: 'CNC-500', location: '', isActive: true, modelId: 'h8', processId: 'h8-0' },
    ],
  },
};
const assignment = (machine: string, base: [string | null, string | null], rec: [string | null, string | null], fin: [string | null, string | null], locked = false) => ({
  machine_id: machine, base_model_id: base[0], base_process_id: base[1], recommended_model_id: rec[0], recommended_process_id: rec[1],
  final_model_id: fin[0], final_process_id: fin[1], is_locked: locked,
});
const plan: PlanPayload = {
  plan: { id: 'plan-1', status: 'draft', revision: 3, title: 'W39 · f.xlsx' },
  requirements: [
    { modelId: 'h8', modelName: 'H8 M', processId: 'h8-1', processName: 'CNC #1', forecastModel: 'H8 MAIN', peakQuantity: 260, dailyCapacityPerMachine: 130, requiredMachines: 2 },
    { modelId: 'on1', modelName: 'ON1', processId: 'on1-1', processName: 'CNC #1', forecastModel: 'ON 1', peakQuantity: 130, dailyCapacityPerMachine: 130, requiredMachines: 1 },
  ],
  assignments: [
    assignment('m-305', ['on1', 'on1-1'], ['h8', 'h8-1'], ['h8', 'h8-1']),
    assignment('m-306', ['on1', 'on1-1'], ['on1', 'on1-1'], ['on1', 'on1-1'], true),
    assignment('m-449', [null, null], ['h8', 'h8-1'], [null, null]),        // user undid one recommendation
    assignment('m-500', ['h8', 'h8-0'], ['h8', 'h8-0'], ['h8', 'h8-0']),
  ],
  setupTasks: [],
};

describe('process codes', () => {
  it('maps DB process names to the studio codes, keeping sub-processes distinct', () => {
    expect(['CNC #0', 'CNC #1', 'CNC # 2', 'CNC #2-1'].map(processCode)).toEqual(['C0', 'C1', 'C2', 'C2-1']);
  });
});

describe('studio view from a plan', () => {
  const view = buildStudioView(workspace, plan);

  it('numbers machines by their CNC number and uses the plan base as the "original" layout', () => {
    expect(view.data.machines.map(m => [m.id, m.building, m.model, m.process])).toEqual([
      [305, 'B', 'ON1', 'C1'], [306, 'B', 'ON1', 'C1'], [449, 'A', '', ''], [500, 'A', 'H8 M', 'C0'],
    ]);
    expect(view.data.models).toEqual(['H8 M', 'ON1']);                 // active models only
    expect(view.data.processesByModel['H8 M']).toEqual(['C0', 'C1', 'C2']);
    expect(view.data.buildings.map(b => [b.id, b.count])).toEqual([['B', 2], ['A', 2]]);
  });

  it('turns final ≠ base into draft edits and recommended ≠ base into the recommendation', () => {
    expect(view.initial.draft).toEqual({ edits: { 305: { model: 'H8 M', process: 'C1' } }, locks: [306], demo: true });
    expect(view.initial.recommended.edits).toEqual({ 305: { model: 'H8 M', process: 'C1' }, 449: { model: 'H8 M', process: 'C1' } });
  });

  it('diffs a draft against the last saved state into server changes (uuids, nulls for "no model")', () => {
    const draft = { edits: { 305: { model: 'H8 M', process: 'C1' }, 449: { model: 'ON1', process: 'C2' }, 500: { model: '', process: 'C0' } }, locks: [], demo: true };
    expect(view.changesFor(draft)).toEqual([
      { machineId: 'm-306', finalModelId: 'on1', finalProcessId: 'on1-1', isLocked: false },
      { machineId: 'm-449', finalModelId: 'on1', finalProcessId: 'on1-2', isLocked: false },
      { machineId: 'm-500', finalModelId: null, finalProcessId: null, isLocked: false },
    ]);
  });

  it('summarises capacity alerts for any draft in studio codes', () => {
    const summary = view.summarize(view.initial.draft);
    expect(summary.groups.find(g => g.code === 'H8 M-C1')).toMatchObject({ model: 'H8 M', process: 'C1', required: 2, assigned: 1, gap: -1, status: 'shortage' });
    expect(summary.groups.find(g => g.code === 'ON1-C1')).toMatchObject({ required: 1, assigned: 1, status: 'ok' });
    expect(summary.totals.unassignedMachines).toBe(1);
  });

  it('is read-only for a confirmed plan and exposes its setup tasks by machine number', () => {
    const confirmed = buildStudioView(workspace, {
      ...plan, plan: { ...plan.plan, status: 'confirmed' },
      setupTasks: [{ id: 't1', machine_id: 'm-305', status: 'in_progress', revision: 2, before_model_id: 'on1', before_process_id: 'on1-1', target_model_id: 'h8', target_process_id: 'h8-1', created_at: '2026-09-25T01:00:00Z', started_at: '2026-09-25T02:00:00Z', completed_at: null }],
    });
    expect(confirmed.readOnly).toBe(true);
    expect(confirmed.initial.setup?.tasks[305]).toMatchObject({ status: 'in_progress', before: { model: 'ON1', process: 'C1' }, target: { model: 'H8 M', process: 'C1' } });
    expect(confirmed.initial.setup?.tasks[305].events.map(e => e.status)).toEqual(['pending', 'in_progress']);
    expect(confirmed.taskRef(305)).toEqual({ id: 't1', revision: 2 });
  });

  it('without a plan shows the current machines read-only with no recommendation', () => {
    const current = buildStudioView(workspace, null);
    expect(current.readOnly).toBe(true);
    expect(current.initial.draft.edits).toEqual({});
    expect(current.summarize(current.initial.draft).groups.every(g => g.status === 'not_in_forecast')).toBe(true);
  });
});
