import {
  BREAK_WINDOWS_END_OFFSET_MINUTES,
  elapsedBreakMinutes,
  TOTAL_BREAK_MINUTES,
} from './shiftBreaks';

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
  /** null = 계산 불가. 0 은 "0% 경과"라는 주장이고, 0/0 은 계산되지 않는다. */
  elapsedRatio: number | null;
}

const clampRatio = (numerator: number, denominator: number): number | null => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, numerator / denominator));
};

export function calculateRealtimeProgress(input: RealtimeProgressInput): RealtimeProgress {
  const {
    shift,
    shiftStart,
    now,
    operatingMinutes,
    tactTimeSeconds,
    downtimeMinutes,
    shiftOutputQty,
  } = input;

  // 휴식 시간대는 720분 교대를 전제로 한다. 더 짧은 교대에서는 시간대가 교대 밖으로 나가
  // elapsedPlannedMinutes(실제로 지나간 휴식만 뺌)와 plannedRuntimeMinutes(총량 110 을 뺌)가
  // 어긋난다 — 480분이면 400 vs 370 이 되어 진척 바가 108% 를 가리킨다.
  //
  // 여기서 두 식을 억지로 맞추지 않는다. plannedRuntimeMinutes 는 resolvePlannedRuntime
  // (확정 OEE 의 저장 경로)과 같은 정의를 일부러 따르고 있어서, 이쪽만 고치면 실시간 화면과
  // 확정 OEE 가 서로 다른 말을 하게 된다. 내부 일관성을 위해 외부 모순을 사는 거래다.
  //
  // 대신 감당할 수 없는 입력을 거부한다. 호출부는 항상 720 을 넘기며, 그 밖의 값은
  // 상류의 버그다. 조용히 108% 를 그리느니 크게 터지는 편이 낫다.
  if (!Number.isFinite(operatingMinutes) || operatingMinutes < BREAK_WINDOWS_END_OFFSET_MINUTES) {
    throw new Error(
      `calculateRealtimeProgress: operatingMinutes(${operatingMinutes})가 휴식 시간대를 담지 못한다 ` +
      `(최소 ${BREAK_WINDOWS_END_OFFSET_MINUTES}분). 교대 길이를 바꿨다면 shiftBreaks 의 시간대도 함께 고쳐야 한다.`
    );
  }

  // Math.max(0, NaN) 은 0 이 아니라 NaN 이다. clampRatio 가 비율은 막아주지만
  // actualRuntimeMinutes 는 number 로 선언된 채 NaN 이 새어나간다.
  if (!Number.isFinite(downtimeMinutes)) {
    throw new Error(`calculateRealtimeProgress: downtimeMinutes(${downtimeMinutes})가 유효한 수가 아니다`);
  }

  // null 은 정상이다 — 아직 보고가 없다는 뜻. 하지만 NaN 은 호출부의 버그이고,
  // 여기서 통과시키면 progressQty/progressRatio 가 number|null 타입으로 NaN 을 돌려준다.
  // 작업자 입력에서 API 를 거쳐 들어오는 유일한 필드라 무방비로 둘 수 없다.
  if (shiftOutputQty !== null && !Number.isFinite(shiftOutputQty)) {
    throw new Error(`calculateRealtimeProgress: shiftOutputQty(${shiftOutputQty})가 유효한 수가 아니다`);
  }

  // 교대가 끝난 뒤에도 화면이 열려 있을 수 있다. 캡이 없으면 분모가 계속 커져
  // 다 돌린 교대가 시간이 갈수록 나빠 보인다.
  const elapsedTotal = Math.max(0, (now.getTime() - shiftStart.getTime()) / 60_000);
  const cappedElapsed = Math.min(elapsedTotal, operatingMinutes);
  const breaksSoFar = elapsedBreakMinutes(shift, shiftStart, now);
  const elapsedPlannedMinutes = Math.max(0, cappedElapsed - breaksSoFar);

  // resolvePlannedRuntime(src/lib/plannedRuntime.ts)과 같은 식이지만 일부러 다시 쓴다 —
  // 그 파일은 supabaseAdmin 을 import 하므로 여기서 끌어오면 서비스 롤 클라이언트가
  // 클라이언트 번들에 들어가고 이 모듈의 순수성이 깨진다. DRY 하게 합치지 말 것.
  const plannedRuntimeMinutes = Math.max(0, operatingMinutes - TOTAL_BREAK_MINUTES);
  const actualRuntimeMinutes = Math.max(0, elapsedPlannedMinutes - Math.max(0, downtimeMinutes));

  const minutesPerUnit = tactTimeSeconds > 0 ? tactTimeSeconds / 60 : null;

  const idealRuntimeMinutes =
    minutesPerUnit !== null && shiftOutputQty !== null ? shiftOutputQty * minutesPerUnit : null;

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
    progressQty: shiftOutputQty,
    // 진척은 자르지 않는다 — 목표를 넘긴 것은 감춰야 할 사실이 아니다.
    // (성능률은 0..1 로 자른다. 그쪽은 tact 오차가 100% 를 넘는 값을 만들기 때문이다.)
    progressRatio:
      capaQty !== null && capaQty > 0 && shiftOutputQty !== null ? shiftOutputQty / capaQty : null,
    // 0/0 에 "0% 경과"라고 답하지 않는다 — 계산 불가는 null 이다 (clampRatio 와 같은 규율).
    // 위 가드 덕에 지금은 도달할 수 없지만, 타입은 멀리 있는 가드에 기대지 않고 스스로
    // 진실을 말해야 한다. 여기서 자르지 않는 이유도 있다: 두 휴식 모델이 어긋나면
    // 1 을 넘는 값이 그 사실을 드러낸다. 클램프는 그 증상을 감춰버린다.
    elapsedRatio: plannedRuntimeMinutes > 0 ? elapsedPlannedMinutes / plannedRuntimeMinutes : null,
  };
}
