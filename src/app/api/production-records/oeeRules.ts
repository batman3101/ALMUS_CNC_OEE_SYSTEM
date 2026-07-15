export const DEFAULT_TACT_SECONDS = 120;
export const DEFAULT_CAVITY = 1;

export interface HistoricalProductionSnapshot {
  output_qty: number;
  ideal_runtime: number | null;
  tact_time_seconds: number | null;
  cavity_count: number | null;
}

export interface ProductionParameters {
  tactSeconds: number;
  cavity: number;
  minutesPerUnit: number;
}

export function calculateOeeMetrics(params: {
  plannedRuntime: number;
  actualRuntime: number;
  outputQty: number;
  defectQty: number;
  minutesPerUnit: number;
}) {
  const plannedRuntime = Math.max(0, params.plannedRuntime);
  const actualRuntime = Math.min(Math.max(params.actualRuntime, 0), plannedRuntime);
  const idealRuntime = Math.max(0, params.outputQty * params.minutesPerUnit);
  const availability = plannedRuntime > 0 ? actualRuntime / plannedRuntime : 0;
  const performance = actualRuntime > 0 ? Math.min(Math.max(idealRuntime / actualRuntime, 0), 1) : 0;
  const quality = params.outputQty > 0
    ? Math.min(Math.max((params.outputQty - params.defectQty) / params.outputQty, 0), 1)
    : 0;
  return {
    plannedRuntime,
    actualRuntime,
    idealRuntime,
    availability,
    performance,
    quality,
    oee: availability * performance * quality,
  };
}

/**
 * 과거 기록은 저장 당시 snapshot을 우선 사용한다. snapshot이 없는 레거시는
 * ideal_runtime/output_qty 비율을 보존하고, 둘 다 없을 때만 현재 공정값을 쓴다.
 */
export function resolveHistoricalProductionParameters(
  existing: HistoricalProductionSnapshot | null | undefined,
  currentTactSeconds: number,
  currentCavity: number
): ProductionParameters {
  const safeCurrentTact = currentTactSeconds > 0 ? currentTactSeconds : DEFAULT_TACT_SECONDS;
  const safeCurrentCavity = currentCavity > 0 ? currentCavity : DEFAULT_CAVITY;

  if (existing?.tact_time_seconds && existing.tact_time_seconds > 0) {
    const cavity = existing.cavity_count && existing.cavity_count > 0
      ? existing.cavity_count
      : DEFAULT_CAVITY;
    return {
      tactSeconds: existing.tact_time_seconds,
      cavity,
      minutesPerUnit: existing.tact_time_seconds / 60 / cavity,
    };
  }

  if (existing && existing.output_qty > 0 && (existing.ideal_runtime ?? 0) > 0) {
    const minutesPerUnit = (existing.ideal_runtime as number) / existing.output_qty;
    return {
      // RPC가 기존 snapshot을 보존하므로 레거시 행에는 값을 새로 만들지 않는다.
      tactSeconds: 0,
      cavity: 0,
      minutesPerUnit,
    };
  }

  return {
    tactSeconds: safeCurrentTact,
    cavity: safeCurrentCavity,
    minutesPerUnit: safeCurrentTact / 60 / safeCurrentCavity,
  };
}

/** 런타임 미보고는 완전 가동으로 추정하지 않고 NULL로 유지한다. */
export function resolveActualRuntime(actualRuntime: unknown, plannedRuntime: number): number | null {
  if (actualRuntime === undefined || actualRuntime === null) return null;
  const parsed = typeof actualRuntime === 'number' ? actualRuntime : Number.NaN;
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), plannedRuntime);
}

/** runtime 직접 수정은 downtime = planned - actual 불변조건을 함께 저장한다. */
export function synchronizeDowntime(
  plannedRuntime: number,
  actualRuntime: number,
  runtimeWasEdited: boolean,
  existingDowntime: number | null
): number | null {
  if (!runtimeWasEdited) return existingDowntime;
  return Math.max(0, Math.round(plannedRuntime - actualRuntime));
}
