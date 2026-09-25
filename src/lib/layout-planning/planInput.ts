import type { ForecastSnapshotMachine, ForecastSnapshotModel } from '@/types/forecast';
import type { WeeklyModelDemand } from '@/lib/forecast/weeklyDemand';
import { matchModels, normalizeModelName, processRefs, type ModelMatch } from '@/lib/forecast/modelAliases';
import { buildRequirements } from '@/lib/forecast/requiredMachines';
import { recommendLayout, type LayoutRecommendation, type MachinePosition } from './recommendLayout';

/** A user-confirmed pairing, one per factory and normalized forecast name (`forecast_model_mappings`). */
export interface ModelMapping { forecastModelKey: string; productModelId: string }
export type MappingSource = 'saved' | 'auto' | 'unmapped';

/**
 * Forecast name → app model. Order (decision 2026-09-25: field abbreviations differ from the forecast,
 * and the user confirms pairings on screen):
 *   1. the user's saved mapping for this factory;
 *   2. an automatic match (same name ignoring spaces/case, or a verified built-in alias) — shown as "auto"
 *      so the user can still override it;
 *   3. otherwise unmapped. Only unmapped models *with demand* block a plan.
 * Inactive models are never targets.
 */
export function resolveModels(demands: WeeklyModelDemand[], snapshotModels: ForecastSnapshotModel[], mappings: ModelMapping[]) {
  const active = new Map(snapshotModels.filter(m => m.isActive).map(m => [m.id, m]));
  const saved = new Map(mappings.map(m => [m.forecastModelKey, m.productModelId]));
  const auto = matchModels(demands.map(d => d.model), snapshotModels);
  const matches = new Map<string, ModelMatch>();
  const sources = new Map<string, MappingSource>();
  const unmapped: string[] = [];
  for (const d of demands) {
    const savedModel = active.get(saved.get(normalizeModelName(d.model)) ?? '');
    if (savedModel) {
      matches.set(d.model, { forecastModel: d.model, dbModel: savedModel, reason: 'matched', processes: processRefs(savedModel) });
      sources.set(d.model, 'saved');
      continue;
    }
    const match = auto.get(d.model);
    if (match?.dbModel) { matches.set(d.model, match); sources.set(d.model, 'auto'); continue; }
    sources.set(d.model, 'unmapped');
    if (d.peakQuantity > 0) unmapped.push(d.model);
  }
  return { matches, sources, unmapped };
}

export interface RequirementPayload {
  product_model_id: string; process_id: string; forecast_model_label: string; peak_quantity: number; peak_date: string | null;
  tact_time_seconds: number | null; daily_capacity_per_machine: number | null; required_machines: number | null;
}
export interface AssignmentPayload {
  machine_id: string; recommended_model_id: string | null; recommended_process_id: string | null;
  recommendation_reason: 'shortage_fill' | 'surplus_release' | 'zero_demand_release' | 'unassigned_fill' | 'locked'; is_locked?: boolean;
}
export interface PlanDraftInput {
  demands: WeeklyModelDemand[];
  nextWeekDemands: WeeklyModelDemand[];
  snapshotModels: ForecastSnapshotModel[];
  machines: ForecastSnapshotMachine[];
  positions: ReadonlyMap<string, MachinePosition>;
  mappings: ModelMapping[];
  breakMinutes: number;
  locked: ReadonlySet<string>;
}

/**
 * Everything `create_layout_plan` needs, computed from the same formulas as the Forecast screen
 * (`buildRequirements`: OEE daily capacity, per-piece T/T, CNC #0 included where the model has it).
 */
export function buildPlanDraft(input: PlanDraftInput) {
  const { matches, sources, unmapped } = resolveModels(input.demands, input.snapshotModels, input.mappings);

  // Two forecast names can point at one app model (two abbreviations for one part). Only each name's peak
  // day survives weeklyModelDemand, so the daily series cannot be re-added; adding the peaks is the
  // conservative choice (≥ the true combined peak) and never under-plans. Labels are joined so it shows.
  const merged = new Map<string, { demand: WeeklyModelDemand; match: ModelMatch }>();
  for (const d of input.demands) {
    const match = matches.get(d.model);
    if (!match?.dbModel) continue;
    const prev = merged.get(match.dbModel.id);
    if (!prev) { merged.set(match.dbModel.id, { demand: { ...d }, match }); continue; }
    prev.demand = {
      ...prev.demand,
      model: `${prev.demand.model} + ${d.model}`,
      peakQuantity: prev.demand.peakQuantity + d.peakQuantity,
      peakDate: prev.demand.peakQuantity >= d.peakQuantity ? prev.demand.peakDate : d.peakDate,
      warnings: [...new Set([...prev.demand.warnings, ...d.warnings])],
    };
  }
  const demands = [...merged.values()].map(v => v.demand);
  const mergedMatches = new Map([...merged.values()].map(v => [v.demand.model, { ...v.match, forecastModel: v.demand.model }]));

  const requirementRows = buildRequirements({
    demands, matches: mergedMatches, models: input.snapshotModels, machines: input.machines, breakMinutes: input.breakMinutes,
  });

  // Next-week protection keys on the same (merged) names the requirement rows carry, resolved by the same rules.
  const nextWeekMatches = resolveModels(input.nextWeekDemands, input.snapshotModels, input.mappings).matches;
  const nextWeekDemands = input.nextWeekDemands.flatMap(d => {
    const id = nextWeekMatches.get(d.model)?.dbModel?.id;
    const label = id ? merged.get(id)?.demand.model : undefined;
    return label ? [{ ...d, model: label }] : [];
  });

  const recommendation: LayoutRecommendation = recommendLayout({
    requirements: requirementRows, machines: input.machines, positions: input.positions, locked: input.locked, nextWeekDemands,
  });

  const requirements: RequirementPayload[] = requirementRows
    .flatMap(r => r.dbModel && r.processId && r.forecastModel !== null ? [{
      product_model_id: r.dbModel.id, process_id: r.processId, forecast_model_label: r.forecastModel,
      peak_quantity: r.peakQuantity, peak_date: r.peakDate, tact_time_seconds: r.tactTimeSeconds,
      daily_capacity_per_machine: r.dailyCapacity, required_machines: r.required,
    }] : [])
    .sort((a, b) => a.product_model_id.localeCompare(b.product_model_id) || a.process_id.localeCompare(b.process_id));

  const byId = new Map(input.machines.map(m => [m.id, m]));
  const assignments: AssignmentPayload[] = [
    ...recommendation.moves.map(mv => ({
      machine_id: mv.machineId, recommended_model_id: mv.to.modelId, recommended_process_id: mv.to.processId, recommendation_reason: mv.reason,
    })),
    ...[...input.locked].flatMap(id => {
      const m = byId.get(id);
      return m && m.isActive ? [{ machine_id: id, recommended_model_id: m.modelId, recommended_process_id: m.processId, recommendation_reason: 'locked' as const, is_locked: true }] : [];
    }),
  ];

  return { requirements, assignments, unresolved: recommendation.unresolved, unmapped, sources };
}
