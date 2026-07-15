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

export interface DowntimeSaveEntry {
  start_time: string;
  end_time: string;
  reason: string;
  description?: string;
  operator_id?: string;
}

export interface TimeWindow {
  start: number;
  end: number;
}

/**
 * 비가동 입력은 해당 영업일/교대의 실제 시간창 안에 완전히 포함되어야 한다.
 * 범위 밖 시간을 생산 OEE에는 더하고 분석 API에서는 잘라내는 불일치를 막는다.
 */
export function validateDowntimeEntriesForWindow(
  shiftName: string,
  value: unknown,
  window: TimeWindow
): { entries?: DowntimeSaveEntry[]; totalMinutes?: number; error?: string } {
  if (value === undefined) return {};
  if (!Array.isArray(value)) return { error: `${shiftName} 비가동 목록은 배열이어야 합니다` };

  const entries: DowntimeSaveEntry[] = [];
  const intervals: TimeWindow[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') return { error: `${shiftName} 비가동 입력 형식이 잘못되었습니다` };
    const candidate = raw as Record<string, unknown>;
    const start = typeof candidate.start_time === 'string' ? Date.parse(candidate.start_time) : NaN;
    const end = typeof candidate.end_time === 'string' ? Date.parse(candidate.end_time) : NaN;
    const reason = typeof candidate.reason === 'string' ? candidate.reason.trim() : '';
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return { error: `${shiftName} 비가동 종료 시각은 시작 시각보다 늦어야 합니다` };
    }
    if (start < window.start || end > window.end) {
      return { error: `${shiftName} 비가동 시간은 해당 날짜와 교대 범위 안에 있어야 합니다` };
    }
    if (!reason) return { error: `${shiftName} 비가동 원인은 필수입니다` };

    intervals.push({ start, end });
    entries.push({
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      reason,
      ...(typeof candidate.description === 'string' && candidate.description.trim()
        ? { description: candidate.description.trim() }
        : {}),
      ...(typeof candidate.operator_id === 'string' && candidate.operator_id.trim()
        ? { operator_id: candidate.operator_id.trim() }
        : {}),
    });
  }

  const sorted = intervals.sort((left, right) => left.start - right.start || left.end - right.end);
  let claimedEnd = sorted[0]?.end ?? 0;
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index].start < claimedEnd) {
      return { error: `${shiftName} 비가동 시간이 서로 겹칩니다` };
    }
    claimedEnd = Math.max(claimedEnd, sorted[index].end);
  }

  const totalMinutes = Math.round(
    sorted.reduce((sum, interval) => sum + interval.end - interval.start, 0) / 60000
  );
  return { entries, totalMinutes };
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

/** 런타임을 생략한 단건 입력은 계획 가동시간 전체를 가동한 것으로 명시적으로 처리한다. */
export function resolveActualRuntime(actualRuntime: unknown, plannedRuntime: number): number {
  if (actualRuntime === undefined || actualRuntime === null) return plannedRuntime;
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
