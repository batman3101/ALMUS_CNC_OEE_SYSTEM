import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse } from '@/lib/apiAuth';
import { BadRequest } from './requestBody';
import { loadForecastCapacitySnapshot } from '@/lib/forecast/capacitySnapshot';
import { loadForecastCapacityPolicy } from '@/lib/forecast/capacityPolicy';
import { normalizeModelName } from '@/lib/forecast/modelAliases';
import type { WeeklyModelDemand } from '@/lib/forecast/weeklyDemand';
import { buildPlanDraft, type ModelMapping } from './planInput';
import { summarizeCapacity, type PlanRequirement } from './summarizeCapacity';
import type { MachinePosition } from './recommendLayout';

/**
 * Server-only I/O for Layout planning. Every query is scoped by the *authenticated* factory id (never a
 * client value), and every write goes through the 20260925110000 RPCs — the tables have no write policy.
 */

/** Well above 800 machines; reaching it means PostgREST cut the result, so it is refused, never used. */
const ROW_LIMIT = 5000;
class TruncatedError extends Error {}
const bounded = <T>(rows: T[] | null): T[] => {
  if ((rows?.length ?? 0) >= ROW_LIMIT) throw new TruncatedError('row limit reached');
  return rows ?? [];
};

/** Business errors raised by the RPCs, mapped to what the screen can act on. */
const RPC_ERRORS: Array<[prefix: string, status: number, code: string]> = [
  ['PLAN_REVISION_CONFLICT', 409, 'plan_revision_conflict'],
  ['LAYOUT_BASE_STALE', 409, 'layout_base_stale'],
  ['PLAN_NOT_DRAFT', 409, 'plan_not_draft'],
  ['ASSIGNMENT_LOCKED', 409, 'assignment_locked'],
  ['MACHINE_INACTIVE', 409, 'machine_inactive'],
  ['NO_ACTIVE_GEOMETRY', 409, 'no_geometry'],
  ['INVALID_SETUP_TRANSITION', 409, 'invalid_setup_transition'],
  ['UNKNOWN_MACHINE', 400, 'unknown_machine'],
  ['PLAN_NOT_FOUND', 404, 'plan_not_found'],
  ['TASK_NOT_FOUND', 404, 'task_not_found'],
];

export class LayoutPlanningError extends Error {
  constructor(readonly status: number, readonly code: string, readonly detail?: unknown) { super(code); }
}

/** RPC / query error → LayoutPlanningError (or rethrow when it is not a known business rule). */
function raise(error: { message?: string; code?: string } | null): never {
  const message = error?.message ?? '';
  const known = RPC_ERRORS.find(([prefix]) => message.startsWith(prefix));
  if (known) {
    const machineId = message.slice(known[0].length).trim() || undefined;
    throw new LayoutPlanningError(known[1], known[2], machineId ? { machineId } : undefined);
  }
  // FK / check violations: the client sent a model/process pair or machine that does not fit this factory.
  if (error?.code === '23503' || error?.code === '23514') throw new LayoutPlanningError(400, 'invalid_assignment');
  throw new Error(message || 'layout planning query failed');
}

/** One error tail for every layout-planning route: auth → 401/403, bad body → 400, business rule → mapped, else 500. */
export function routeErrorResponse(error: unknown): NextResponse {
  const auth = apiAuthErrorResponse(error);
  if (auth) return auth;
  if (error instanceof BadRequest) return NextResponse.json({ success: false, code: error.code }, { status: 400 });
  const mapped = layoutErrorResponse(error);
  if (mapped) return mapped;
  console.error('layout-planning route failed', error);
  return NextResponse.json({ success: false, code: 'layout_planning_failed' }, { status: 500 });
}

export function layoutErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof LayoutPlanningError) {
    return NextResponse.json({ success: false, code: error.code, detail: error.detail }, { status: error.status });
  }
  if (error instanceof TruncatedError) return NextResponse.json({ success: false, code: 'too_many_rows' }, { status: 500 });
  return null;
}

// ── Workspace (geometry + current factory state) ─────────────────────────────────────────────
export interface WorkspacePosition extends MachinePosition { machineId: string; cell: string }

export async function loadGeometry(factoryId: string) {
  const { data: geometry, error } = await supabaseAdmin.from('layout_geometries')
    .select('id, source_file, source_sheet, source_hash, note, created_at')
    .eq('factory_id', factoryId).eq('is_active', true).maybeSingle();
  if (error) raise(error);
  if (!geometry) return null;
  const { data, error: posError } = await supabaseAdmin.from('machine_layout_positions')
    .select('machine_id, building, cell, x, y, width, height')
    .eq('factory_id', factoryId).eq('geometry_id', geometry.id).limit(ROW_LIMIT);
  if (posError) raise(posError);
  const positions: WorkspacePosition[] = bounded(data).map(p => ({
    machineId: p.machine_id, building: p.building, cell: p.cell, x: Number(p.x), y: Number(p.y), width: Number(p.width), height: Number(p.height),
  }));
  return { id: geometry.id as string, sourceFile: geometry.source_file as string, sourceSheet: geometry.source_sheet as string | null, sourceHash: geometry.source_hash as string, note: geometry.note as string | null, positions };
}

export async function loadWorkspace(factoryId: string) {
  const [geometry, snapshot, policy, plans] = await Promise.all([
    loadGeometry(factoryId),
    loadForecastCapacitySnapshot(factoryId),
    loadForecastCapacityPolicy(factoryId),
    supabaseAdmin.from('layout_plans')
      .select('id, status, title, target_week, period_start, period_end, revision, created_at, confirmed_at, forecast_file_name')
      .eq('factory_id', factoryId).in('status', ['draft', 'confirmed']).order('created_at', { ascending: false }).limit(20),
  ]);
  if (plans.error) raise(plans.error);
  return { geometry, snapshot, policy, plans: plans.data ?? [] };
}

// ── Model mappings ───────────────────────────────────────────────────────────────────────────
export async function loadMappings(factoryId: string): Promise<Array<ModelMapping & { forecastModelLabel: string; confirmedAt: string }>> {
  const { data, error } = await supabaseAdmin.from('forecast_model_mappings')
    .select('forecast_model_key, forecast_model_label, product_model_id, confirmed_at')
    .eq('factory_id', factoryId).order('forecast_model_key').limit(ROW_LIMIT);
  if (error) raise(error);
  return bounded(data).map(m => ({ forecastModelKey: m.forecast_model_key, forecastModelLabel: m.forecast_model_label, productModelId: m.product_model_id, confirmedAt: m.confirmed_at }));
}

export async function saveMappings(factoryId: string, userId: string, items: Array<{ forecastModel: string; productModelId: string | null }>) {
  const upserts = items.filter(i => i.productModelId).map(i => ({
    factory_id: factoryId, forecast_model_key: normalizeModelName(i.forecastModel), forecast_model_label: i.forecastModel.trim(),
    product_model_id: i.productModelId as string, confirmed_by: userId, confirmed_at: new Date().toISOString(),
  }));
  const removals = items.filter(i => !i.productModelId).map(i => normalizeModelName(i.forecastModel));
  if (upserts.length) {
    const { error } = await supabaseAdmin.from('forecast_model_mappings').upsert(upserts, { onConflict: 'factory_id,forecast_model_key' });
    if (error) raise(error);
  }
  if (removals.length) {
    const { error } = await supabaseAdmin.from('forecast_model_mappings').delete().eq('factory_id', factoryId).in('forecast_model_key', removals);
    if (error) raise(error);
  }
  return loadMappings(factoryId);
}

// ── Plans ────────────────────────────────────────────────────────────────────────────────────
export interface CreatePlanInput {
  title: string; forecastFileName: string; forecastFileHash: string;
  week: { key: string; start: string; end: string };
  demands: WeeklyModelDemand[]; nextWeekDemands: WeeklyModelDemand[];
  lockedMachineIds: string[];
  /** The user saw the unmapped list and chose to plan without those models. */
  acknowledgeUnmapped: boolean;
}

export async function createPlan(factoryId: string, userId: string, input: CreatePlanInput) {
  const [geometry, snapshot, policy, mappings] = await Promise.all([
    loadGeometry(factoryId), loadForecastCapacitySnapshot(factoryId), loadForecastCapacityPolicy(factoryId), loadMappings(factoryId),
  ]);
  if (!geometry) throw new LayoutPlanningError(409, 'no_geometry');
  if (snapshot.status !== 'available') throw new LayoutPlanningError(503, 'snapshot_unavailable');
  if (policy.status !== 'available') throw new LayoutPlanningError(503, 'capacity_policy_unavailable');

  const draft = buildPlanDraft({
    demands: input.demands, nextWeekDemands: input.nextWeekDemands, snapshotModels: snapshot.models, machines: snapshot.machines,
    positions: new Map(geometry.positions.map(p => [p.machineId, p])), mappings, breakMinutes: policy.breakMinutes,
    locked: new Set(input.lockedMachineIds),
  });
  if (draft.unmapped.length && !input.acknowledgeUnmapped) {
    throw new LayoutPlanningError(422, 'unmapped_models', { models: draft.unmapped });
  }

  const { data, error } = await supabaseAdmin.rpc('create_layout_plan', {
    p_factory_id: factoryId,
    p_actor: userId,
    p_plan: {
      title: input.title, forecast_file_name: input.forecastFileName, forecast_file_hash: input.forecastFileHash,
      target_week: input.week.key, period_start: input.week.start, period_end: input.week.end,
      capacity_policy: { source: policy.source, breakMinutes: policy.breakMinutes, shiftAStart: policy.shiftAStart, shiftBStart: policy.shiftBStart, timezone: policy.timezone, unmappedIgnored: draft.unmapped },
    },
    p_requirements: draft.requirements,
    p_assignments: draft.assignments,
  });
  if (error) raise(error);
  return { planId: (data as { plan_id: string }).plan_id, unresolved: draft.unresolved, unmapped: draft.unmapped };
}

export async function loadPlan(factoryId: string, planId: string) {
  const { data: plan, error } = await supabaseAdmin.from('layout_plans').select('*')
    .eq('factory_id', factoryId).eq('id', planId).maybeSingle();
  if (error) raise(error);
  if (!plan) throw new LayoutPlanningError(404, 'plan_not_found');
  const [reqs, assigns, tasks, processes, models] = await Promise.all([
    supabaseAdmin.from('layout_plan_requirements').select('*').eq('factory_id', factoryId).eq('plan_id', planId).limit(ROW_LIMIT),
    supabaseAdmin.from('layout_plan_assignments').select('*').eq('factory_id', factoryId).eq('plan_id', planId).limit(ROW_LIMIT),
    supabaseAdmin.from('machine_setup_tasks').select('*').eq('factory_id', factoryId).eq('plan_id', planId).limit(ROW_LIMIT),
    supabaseAdmin.from('model_processes').select('id, process_name, model_id').eq('factory_id', factoryId).limit(ROW_LIMIT),
    supabaseAdmin.from('product_models').select('id, model_name').eq('factory_id', factoryId).limit(ROW_LIMIT),
  ]);
  for (const r of [reqs, assigns, tasks, processes, models]) if (r.error) raise(r.error);
  const modelNames = new Map(bounded(models.data).map(m => [m.id as string, m.model_name as string]));
  const names = new Map(bounded(processes.data).map(p => [p.id as string, { process: p.process_name as string, model: modelNames.get(p.model_id) ?? p.model_id }]));
  const requirements: PlanRequirement[] = bounded(reqs.data).map(r => ({
    modelId: r.product_model_id, modelName: names.get(r.process_id)?.model ?? r.product_model_id, processId: r.process_id,
    processName: names.get(r.process_id)?.process ?? r.process_id, forecastModel: r.forecast_model_label, peakQuantity: r.peak_quantity,
    dailyCapacityPerMachine: r.daily_capacity_per_machine, requiredMachines: r.required_machines,
  }));
  const assignments = bounded(assigns.data);
  const summary = summarizeCapacity(requirements, assignments.map(a => ({ machineId: a.machine_id, modelId: a.final_model_id, processId: a.final_process_id })));
  return { plan, requirements, assignments, setupTasks: bounded(tasks.data), summary };
}

export async function savePlanDraft(factoryId: string, userId: string, planId: string, expectedRevision: number,
  changes: Array<{ machineId: string; finalModelId: string | null; finalProcessId: string | null; isLocked?: boolean }>) {
  const { data, error } = await supabaseAdmin.rpc('save_layout_plan_draft', {
    p_factory_id: factoryId, p_plan_id: planId, p_expected_revision: expectedRevision, p_actor: userId,
    p_changes: changes.map(c => ({ machine_id: c.machineId, final_model_id: c.finalModelId, final_process_id: c.finalProcessId, is_locked: c.isLocked ?? null })),
  });
  if (error) raise(error);
  return data as { plan_id: string; revision: number };
}

export async function confirmPlan(factoryId: string, userId: string, planId: string, expectedRevision: number) {
  const { data, error } = await supabaseAdmin.rpc('confirm_layout_plan', {
    p_factory_id: factoryId, p_plan_id: planId, p_expected_revision: expectedRevision, p_actor: userId,
  });
  if (error) raise(error);
  return data as { plan_id: string; revision: number; changed_machines: number };
}

export async function discardPlan(factoryId: string, userId: string, planId: string) {
  const { data, error } = await supabaseAdmin.from('layout_plans')
    .update({ status: 'discarded', updated_by: userId })
    .eq('factory_id', factoryId).eq('id', planId).eq('status', 'draft').select('id');
  if (error) raise(error);
  if (!data?.length) throw new LayoutPlanningError(409, 'plan_not_draft');
}

export async function transitionSetupTask(factoryId: string, userId: string, taskId: string, expectedRevision: number, toStatus: string, reason: string | null) {
  const { data, error } = await supabaseAdmin.rpc('transition_machine_setup_task', {
    p_factory_id: factoryId, p_task_id: taskId, p_expected_revision: expectedRevision, p_to_status: toStatus, p_actor: userId, p_reason: reason,
  });
  if (error) raise(error);
  return data as { task_id: string; status: string; revision: number };
}
