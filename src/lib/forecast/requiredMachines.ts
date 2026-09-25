import { DEFAULT_OPERATING_MINUTES } from '@/lib/shiftDefaults';
import { calculateDailyCapacity } from '@/utils/productionCapacity';
import type { ForecastProcess, ForecastSnapshotMachine, ForecastSnapshotModel } from '@/types/forecast';
import { processRefs, type ModelMatch } from './modelAliases';
import type { DemandWarning, WeeklyModelDemand } from './weeklyDemand';

export type RequirementStatus = 'ok' | 'shortage' | 'surplus' | 'zero_demand' | 'unmapped' | 'no_tact' | 'not_in_forecast';
export interface ModelProcessRequirement {
  key: string;
  forecastModel: string | null;
  dbModel: { id: string; name: string } | null;
  process: ForecastProcess;
  processId: string | null;
  tactTimeSeconds: number | null;
  dailyCapacity: number | null;
  peakQuantity: number;
  peakDate: string | null;
  /** null = not computable (unmapped model, no tact time, or not in the forecast). Never 0. */
  required: number | null;
  current: number;
  gap: number | null;
  status: RequirementStatus;
  warnings: DemandWarning[];
}
export interface RequirementInput {
  demands: WeeklyModelDemand[];
  matches: Map<string, ModelMatch>;
  models: ForecastSnapshotModel[];
  machines: ForecastSnapshotMachine[];
  breakMinutes: number;
}

const PROCESSES: ForecastProcess[] = ['CNC1', 'CNC2'];

/** Same formula as the OEE input form: floor per 720-minute shift after one break deduction, then sum. No cavity factor. */
export function dailyCapacityPerMachine(tactTimeSeconds: number | null, breakMinutes: number): number | null {
  if (tactTimeSeconds === null || !Number.isFinite(tactTimeSeconds) || tactTimeSeconds <= 0) return null;
  const shift = { operatingMinutes: DEFAULT_OPERATING_MINUTES, breakMinutes };
  return calculateDailyCapacity(tactTimeSeconds, [shift, shift]);
}

export function countActiveMachines(machines: ForecastSnapshotMachine[], modelId: string, processId: string): number {
  return machines.filter(m => m.isActive && m.modelId === modelId && m.processId === processId).length;
}

export function buildRequirements({ demands, matches, models, machines, breakMinutes }: RequirementInput): ModelProcessRequirement[] {
  const rows: ModelProcessRequirement[] = [];
  for (const demand of demands) {
    const match = matches.get(demand.model);
    for (const process of PROCESSES) {
      const ref = match?.processes[process] ?? null;
      const dbModel = match?.dbModel ? { id: match.dbModel.id, name: match.dbModel.name } : null;
      const processId = ref?.id ?? null;
      const current = dbModel && processId ? countActiveMachines(machines, dbModel.id, processId) : 0;
      const base = { key: `${demand.model}:${process}`, forecastModel: demand.model, dbModel, process, processId, tactTimeSeconds: ref?.tactTimeSeconds ?? null, peakQuantity: demand.peakQuantity, peakDate: demand.peakDate, current, warnings: demand.warnings };
      if (!dbModel) { rows.push({ ...base, dailyCapacity: null, required: null, gap: null, status: 'unmapped' }); continue; }
      const dailyCapacity = dailyCapacityPerMachine(ref?.tactTimeSeconds ?? null, breakMinutes);
      if (!processId || dailyCapacity === null) { rows.push({ ...base, dailyCapacity: null, required: null, gap: null, status: 'no_tact' }); continue; }
      const required = demand.peakQuantity > 0 ? Math.ceil(demand.peakQuantity / dailyCapacity) : 0;
      const gap = required - current;
      const status: RequirementStatus = required === 0 ? 'zero_demand' : gap > 0 ? 'shortage' : gap < 0 ? 'surplus' : 'ok';
      rows.push({ ...base, dailyCapacity, required, gap, status });
    }
  }
  // Machines on a model the forecast never lists: demand unknown, shown for review but never pooled.
  const forecastModelIds = new Set([...matches.values()].flatMap(m => m.dbModel ? [m.dbModel.id] : []));
  for (const model of models) {
    if (!model.isActive || forecastModelIds.has(model.id)) continue;
    const refs = processRefs(model);
    for (const process of PROCESSES) {
      const ref = refs[process];
      if (!ref) continue;
      const current = countActiveMachines(machines, model.id, ref.id);
      if (!current) continue;
      rows.push({ key: `db:${model.id}:${process}`, forecastModel: null, dbModel: { id: model.id, name: model.name }, process, processId: ref.id, tactTimeSeconds: ref.tactTimeSeconds, dailyCapacity: dailyCapacityPerMachine(ref.tactTimeSeconds, breakMinutes), peakQuantity: 0, peakDate: null, required: null, current, gap: null, status: 'not_in_forecast', warnings: [] });
    }
  }
  return rows;
}
