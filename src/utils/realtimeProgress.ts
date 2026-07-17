import { elapsedBreakMinutes, TOTAL_BREAK_MINUTES } from './shiftBreaks';

/**
 * 교대 중 실시간 진행 계산.
 *
 * OEE 는 만들지 않는다. 불량은 다음날 검사하므로 교대 중 품질은 "모른다". 품질을 100% 로
 * 가정해 OEE 를 띄우면 미보고를 0% 로 단정하던 버그(2026-07-17 PR #18)를 방향만 바꿔
 * 재생산하는 것이고, 게다가 항상 낙관적으로 틀린다.
 *
 * 대신 가동×성능은 검사와 무관한 확정값이다. 현장이 실시간으로 알고 싶은 것도 이것이다 —
 * 설비가 지금 잘 돌고 있나.
 */
export interface RealtimeProgressInput {
  shift: 'A' | 'B';
  shiftStart: Date;
  /** 현재 시각. 인자로 받아 결정론적으로 테스트한다. */
  now: Date;
  /** 교대 가동시간(분). 기본 720. */
  operatingMinutes: number;
  /** 개당 가공시간(초). cavity 로 나누지 않는다 — 개당 t/t 에 이미 반영돼 있다. */
  tactTimeSeconds: number;
  /** 지금까지의 비가동(분). */
  downtimeMinutes: number;
  /** 마지막 진행 보고의 "이 교대 누적 생산 수량". 보고가 없으면 null. */
  shiftOutputQty: number | null;
}

export interface RealtimeProgress {
  elapsedPlannedMinutes: number;
  actualRuntimeMinutes: number;
  idealRuntimeMinutes: number | null;
  /** null = 계산 불가. 0 과 구분해야 한다 — 0 은 "완전히 멈춰 있었다"는 측정값이다. */
  availability: number | null;
  performance: number | null;
  availabilityTimesPerformance: number | null;
  plannedRuntimeMinutes: number;
  capaQty: number | null;
  progressQty: number | null;
  progressRatio: number | null;
  elapsedRatio: number;
}

const clampRatio = (numerator: number, denominator: number): number | null => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, numerator / denominator));
};

export function calculateRealtimeProgress(input: RealtimeProgressInput): RealtimeProgress {
  const { shift, shiftStart, now, operatingMinutes, tactTimeSeconds, downtimeMinutes } = input;

  // 교대가 끝난 뒤에도 화면이 열려 있을 수 있다. 캡이 없으면 분모가 계속 커져
  // 다 돌린 교대가 시간이 갈수록 나빠 보인다.
  const elapsedTotal = Math.max(0, (now.getTime() - shiftStart.getTime()) / 60_000);
  const cappedElapsed = Math.min(elapsedTotal, operatingMinutes);
  const breaksSoFar = elapsedBreakMinutes(shift, shiftStart, now);
  const elapsedPlannedMinutes = Math.max(0, cappedElapsed - breaksSoFar);

  const plannedRuntimeMinutes = Math.max(0, operatingMinutes - TOTAL_BREAK_MINUTES);
  const actualRuntimeMinutes = Math.max(0, elapsedPlannedMinutes - Math.max(0, downtimeMinutes));

  const minutesPerUnit = tactTimeSeconds > 0 ? tactTimeSeconds / 60 : null;

  const idealRuntimeMinutes =
    minutesPerUnit !== null && input.shiftOutputQty !== null
      ? input.shiftOutputQty * minutesPerUnit
      : null;

  const availability = clampRatio(actualRuntimeMinutes, elapsedPlannedMinutes);
  const performance =
    idealRuntimeMinutes === null ? null : clampRatio(idealRuntimeMinutes, actualRuntimeMinutes);

  const availabilityTimesPerformance =
    availability !== null && performance !== null ? availability * performance : null;

  const capaQty = minutesPerUnit !== null ? Math.floor(plannedRuntimeMinutes / minutesPerUnit) : null;

  return {
    elapsedPlannedMinutes,
    actualRuntimeMinutes,
    idealRuntimeMinutes,
    availability,
    performance,
    availabilityTimesPerformance,
    plannedRuntimeMinutes,
    capaQty,
    progressQty: input.shiftOutputQty,
    progressRatio:
      capaQty !== null && capaQty > 0 && input.shiftOutputQty !== null
        ? input.shiftOutputQty / capaQty
        : null,
    elapsedRatio: plannedRuntimeMinutes > 0 ? elapsedPlannedMinutes / plannedRuntimeMinutes : 0,
  };
}
