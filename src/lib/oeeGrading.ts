/**
 * OEE 등급 판정의 **유일한 정의**.
 *
 * 이전에는 화면마다 사다리를 따로 적어 두어서, 같은 OEE 가 어느 화면에서 보느냐에 따라
 * 다른 등급으로 보였다 (게이지·운영자·관리자는 0.85/0.65, 엔지니어는 0.85/0.75/0.65).
 * 그리고 관리자가 설정 화면에서 목표·임계값을 저장해도 **어느 화면도 그 값을 읽지 않았다.**
 *
 * 그래서 규칙을 React 도 Supabase 도 모르는 순수 모듈 하나에 모은다. 어디서든 import 할 수
 * 있고, 화면 없이 검사할 수 있다.
 *
 * 내부 값은 언제나 비율(`0..1`)이다. 퍼센트 변환은 표시하는 쪽의 일이다.
 */

/** 사다리의 네 칸. 좋은 쪽에서 나쁜 쪽 순서다. */
export type OEEGrade = 'excellent' | 'good' | 'warning' | 'critical';

/** 좋은 쪽 → 나쁜 쪽. 검사와 UI 열거에서 순서를 못 박는 데 쓴다. */
export const OEE_GRADE_LADDER: readonly OEEGrade[] = ['excellent', 'good', 'warning', 'critical'];

/**
 * 설정이 없거나 비율로 해석할 수 없을 때 쓰는 값.
 * `useSystemSettings` 의 `getOEETargets()`/`getOEEThresholds()` 기본값과 같은 숫자다 —
 * 기본값이 두 벌 있으면 그것도 화면 간 불일치가 된다.
 */
export const DEFAULT_OEE_GRADING_THRESHOLDS = {
  target: 0.85,
  low: 0.6,
  critical: 0.4,
} as const;

/**
 * 등급별 색.
 *
 * 새 색을 만들지 않았다 — `useOEEThresholds.getStatusColor` 가 이미 쓰던 팔레트이고,
 * 네 값 모두 이 저장소의 기존 테마 색이다(#1890ff 는 게이지·대시보드에서 이미 쓴다).
 */
export const OEE_GRADE_COLORS: Readonly<Record<OEEGrade, string>> = {
  excellent: '#52c41a',
  good: '#1890ff',
  warning: '#faad14',
  critical: '#ff4d4f',
};

/** 등급을 매길 수 없을 때의 색. 오늘 화면들이 `—` 를 그릴 때 쓰는 회색 그대로다. */
export const OEE_NO_DATA_COLOR = '#8c8c8c';

/** 저장된 설정값. 아직 안 왔거나(`undefined`) 비어 있을(`null`) 수 있다. */
export interface OEEGradingThresholdInput {
  target?: number | null;
  low?: number | null;
  critical?: number | null;
}

export interface OEEGradingThresholds {
  /** 이 값 이상이면 `excellent` (`oee.target_oee`) */
  readonly target: number;
  /** 이 값 이상이면 `good` (`oee.low_oee_threshold`) */
  readonly low: number;
  /** 이 값 이상이면 `warning`, 미만이면 `critical` (`oee.critical_oee_threshold`) */
  readonly critical: number;
  /** 비율로 해석할 수 없어 기본값으로 대체한 항목이 있었는가 */
  readonly usedDefaults: boolean;
  /** 저장값의 순서가 뒤집혀 있어 사다리를 보정했는가 */
  readonly repaired: boolean;
}

/**
 * 등급 판정 결과.
 *
 * 성공/실패를 한 타입에 담아 **등급을 꺼내려면 반드시 실패 여부를 먼저 보게** 만든다.
 * `NULL` 은 "0%" 가 아니라 "계산 불가"다 — 이 저장소는 `oee || 0` 한 줄로 멀쩡한 설비
 * 396행을 빨간 0.0% 로 그린 적이 있다. 색은 두 갈래 모두에 들어 있으므로, 색만 필요한
 * 호출자는 분기 없이 쓰면서도 0% 로 강등되지 않는다.
 */
export type OEEGradeResult =
  | { readonly graded: true; readonly grade: OEEGrade; readonly color: string }
  | { readonly graded: false; readonly grade: null; readonly color: string };

const UNGRADED: OEEGradeResult = { graded: false, grade: null, color: OEE_NO_DATA_COLOR };

/** 비율로 읽을 수 있는 값인가. 퍼센트(85)나 NaN 은 비율이 아니다. */
const isRatio = (value: number | null | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * 저장된 설정을 판정 가능한 사다리로 바꾼다.
 *
 * ■ 비율이 아닌 값은 그 항목만 기본값으로 대체한다
 *   `null`(미설정), `NaN`, 음수, 1 초과(퍼센트를 그대로 저장한 경우)가 여기 해당한다.
 *
 * ■ 순서가 깨진 설정은 **조용히 비교 순서에 맡기지 않고** 명시적으로 보정한다
 *   설정 화면은 `critical < low < target` 을 검증하지만 API 와 DB 는 강제하지 않고,
 *   그 검증이 없던 시절의 행이 남아 있다. 보정 없이 두면 `low = 0.9 > target = 0.85`
 *   같은 설정에서 0.87 이 "목표 미달인데 excellent" 가 된다 — 판정 순서가 우연히
 *   정책을 정하는 상태다.
 *
 *   보정 방향은 **위에서 아래로 눌러 담는다**: `low = min(low, target)`,
 *   `critical = min(critical, low)`. 관리자가 이름으로 분명히 밝힌 목표(`target`)를
 *   기준으로 삼고, 모순된 하위 경계는 칸을 비우는 쪽으로 접는다. 전체를 기본값으로
 *   되돌리면 멀쩡한 목표까지 버려지고, 세 값을 정렬해 버리면 "어느 칸에 넣으려 했는지"를
 *   대신 추측하게 된다.
 */
export function resolveOEEGradingThresholds(
  input?: OEEGradingThresholdInput | null
): OEEGradingThresholds {
  const rawTarget = input?.target;
  const rawLow = input?.low;
  const rawCritical = input?.critical;

  const target = isRatio(rawTarget) ? rawTarget : DEFAULT_OEE_GRADING_THRESHOLDS.target;
  const low = isRatio(rawLow) ? rawLow : DEFAULT_OEE_GRADING_THRESHOLDS.low;
  const critical = isRatio(rawCritical) ? rawCritical : DEFAULT_OEE_GRADING_THRESHOLDS.critical;

  const orderedLow = Math.min(low, target);
  const orderedCritical = Math.min(critical, orderedLow);

  return {
    target,
    low: orderedLow,
    critical: orderedCritical,
    usedDefaults: !isRatio(rawTarget) || !isRatio(rawLow) || !isRatio(rawCritical),
    repaired: orderedLow !== low || orderedCritical !== critical,
  };
}

/**
 * OEE 비율(`0..1`)에 등급과 색을 매긴다.
 *
 * `null`/`undefined`/`NaN` 은 등급을 매기지 않는다 — 계산할 수 없었다는 사실이 결과에
 * 그대로 남아야 한다. 경계는 모두 **이상(`>=`)** 이다: 정확히 목표값이면 `excellent` 다.
 */
export function resolveOEEGrade(
  value: number | null | undefined,
  thresholds: OEEGradingThresholds
): OEEGradeResult {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return UNGRADED;
  }

  const grade: OEEGrade =
    value >= thresholds.target ? 'excellent'
    : value >= thresholds.low ? 'good'
    : value >= thresholds.critical ? 'warning'
    : 'critical';

  return { graded: true, grade, color: OEE_GRADE_COLORS[grade] };
}

/**
 * 색만 필요한 자리(표 셀, Progress, Statistic)를 위한 축약.
 * 등급이 없으면 회색을 돌려주므로 `—` 표시와 색이 항상 같이 움직인다.
 */
export function oeeGradeColor(
  value: number | null | undefined,
  thresholds: OEEGradingThresholds
): string {
  return resolveOEEGrade(value, thresholds).color;
}
