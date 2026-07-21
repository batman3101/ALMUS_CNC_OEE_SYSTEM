import { calculateOeeMetrics } from '@/app/api/production-records/oeeRules';

export interface ShiftSnapshotInput {
  operatingMinutes: number;
  breakMinutes: number;
  /** null = 비가동 조회 실패/보류. 이때 런타임 계열을 null 로 남긴다(미보고≠완전가동). */
  downtimeMinutes: number | null;
  outputQty: number;
  /** null = 미검사(품질 모름). */
  defectQty: number | null;
  /**
   * 개당 가공시간(초). cavity 로 나누지 않는다(oeeRules.ts 참고).
   * null = 공정 기준 미확인 → ideal/performance/oee 를 null 로 남긴다.
   * (과거 120초 같은 임의 기본값으로 성능을 날조해 저장하던 것을 금지: NULL≠0)
   */
  tactSeconds: number | null;
}

export interface ShiftSnapshot {
  plannedRuntime: number;
  actualRuntime: number | null;
  idealRuntime: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  downtime: number | null;
}

/**
 * 한 교대의 확정 스냅샷 계산. daily 라우트와 close-shift 가 공유한다(DRY).
 * downtime null → 런타임 계열 null(미보고를 완전가동으로 추정하지 않음).
 * defect null → quality/oee null(미검사, NULL≠0%). avail·perf 는 검사와 무관하므로 계산.
 * tact null → ideal/perf/oee null(공정 기준 미확인). avail·quality 는 tact 와 무관하므로 계산.
 */
export function computeShiftSnapshot(input: ShiftSnapshotInput): ShiftSnapshot {
  // resolvePlannedRuntime(plannedRuntime.ts)과 같은 식이지만 일부러 다시 쓴다 — 그 파일은
  // supabaseAdmin 을 import 하므로 여기서 끌어오면 순수 모듈이 깨진다(realtimeProgress.ts 와 동일 선례).
  const plannedRuntime = Math.max(0, input.operatingMinutes - input.breakMinutes);

  // 품질은 tact·비가동과 무관 — 검사 결과만으로 계산한다(oeeRules 와 동일 식).
  const quality: number | null = input.defectQty === null
    ? null
    : (input.outputQty > 0
        ? Math.min(Math.max((input.outputQty - input.defectQty) / input.outputQty, 0), 1)
        : 0);

  if (input.downtimeMinutes === null) {
    const idealRuntime = input.tactSeconds === null
      ? null
      : Math.max(0, input.outputQty * (input.tactSeconds / 60));
    return {
      plannedRuntime, actualRuntime: null, idealRuntime,
      availability: null, performance: null, quality, oee: null, downtime: null,
    };
  }

  const downtime = Math.min(Math.max(input.downtimeMinutes, 0), plannedRuntime);
  const actualRuntime = Math.max(0, plannedRuntime - downtime);

  if (input.tactSeconds === null) {
    const availability = plannedRuntime > 0 ? actualRuntime / plannedRuntime : 0;
    return {
      plannedRuntime, actualRuntime, idealRuntime: null,
      availability, performance: null, quality, oee: null, downtime,
    };
  }

  const m = calculateOeeMetrics({
    plannedRuntime, actualRuntime, outputQty: input.outputQty,
    defectQty: input.defectQty, minutesPerUnit: input.tactSeconds / 60,
  });
  return { ...m, downtime };
}
