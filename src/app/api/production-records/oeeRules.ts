/**
 * tact_time_seconds 는 **개당(1 piece) 가공시간**이다. 사이클당 시간이 아니다.
 *
 * JIG 에 2 cavity 가 올라가 한 사이클에 2개가 나오는 설비라면, 그 사실은 이미
 * 개당 t/t 안에 반영되어 있다 (사이클 1,152초 / 2개 = 개당 576초). 따라서
 * cavity_count 로 다시 나누거나 곱하면 이중 반영이 된다.
 *
 * cavity_count 는 **참고용**이다 (사이클 수 환산·JIG 구성 기록). OEE·CAPA 계산에
 * 절대 사용하지 않는다:
 *
 *   minutes_per_unit = tact_time_seconds / 60
 *   ideal_runtime    = output_qty × minutes_per_unit
 *   CAPA             = 계획가동시간 / minutes_per_unit
 */
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
      minutesPerUnit: existing.tact_time_seconds / 60,
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
    minutesPerUnit: safeCurrentTact / 60,
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
