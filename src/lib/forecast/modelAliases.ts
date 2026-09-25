import type { ForecastProcess, ForecastSnapshotModel } from '@/types/forecast';

export const normalizeModelName = (name: string): string => name.replace(/\s+/g, '').toUpperCase();

/**
 * Forecast spelling → DB spelling, both normalized. Verified against the live DB on 2026-09-25:
 * these are the only machine-bearing models whose names differ beyond spacing/case.
 * Adding an entry here is a mapping decision; confirm with the factory before extending.
 */
export const FORECAST_MODEL_ALIASES: Readonly<Record<string, string>> = { H8MAIN: 'H8M', DIAMOND3: 'DM3' };

const KNOWN_PROCESSES: readonly ForecastProcess[] = ['CNC0', 'CNC1', 'CNC2'];

/** CNC0/CNC1/CNC2 are capacity processes (CNC0 included 2026-09-25); `CNC #2-1` stays out of scope. */
export function normalizeProcessName(name: string): ForecastProcess | null {
  const compact = name.replace(/[\s#]/g, '').toUpperCase();
  return KNOWN_PROCESSES.find(p => p === compact) ?? null;
}

export interface ProcessRef { id: string; tactTimeSeconds: number | null }
export interface ModelMatch {
  forecastModel: string;
  dbModel: ForecastSnapshotModel | null;
  reason: 'matched' | 'alias' | 'unmapped' | 'ambiguous';
  processes: Record<ForecastProcess, ProcessRef | null>;
}

/** CNC0/CNC1/CNC2 process ids of a DB model; lowest process_order wins if a name repeats. */
export function processRefs(model: ForecastSnapshotModel | null): Record<ForecastProcess, ProcessRef | null> {
  const refs: Record<ForecastProcess, ProcessRef | null> = { CNC0: null, CNC1: null, CNC2: null };
  if (!model) return refs;
  for (const process of [...model.processes].sort((a, b) => a.order - b.order)) {
    const key = normalizeProcessName(process.name);
    if (key && !refs[key]) refs[key] = { id: process.id, tactTimeSeconds: process.tactTimeSeconds };
  }
  return refs;
}

export function matchModels(forecastModels: string[], snapshotModels: ForecastSnapshotModel[]): Map<string, ModelMatch> {
  const index = new Map<string, ForecastSnapshotModel[]>();
  for (const model of snapshotModels) {
    if (!model.isActive) continue;
    const key = normalizeModelName(model.name);
    index.set(key, [...(index.get(key) ?? []), model]);
  }
  const result = new Map<string, ModelMatch>();
  for (const forecastModel of forecastModels) {
    const normalized = normalizeModelName(forecastModel);
    const alias = FORECAST_MODEL_ALIASES[normalized];
    const candidates = index.get(alias ?? normalized) ?? [];
    const dbModel = candidates.length === 1 ? candidates[0] : null;
    const reason: ModelMatch['reason'] = candidates.length > 1 ? 'ambiguous' : !dbModel ? 'unmapped' : alias ? 'alias' : 'matched';
    result.set(forecastModel, { forecastModel, dbModel, reason, processes: processRefs(dbModel) });
  }
  return result;
}
