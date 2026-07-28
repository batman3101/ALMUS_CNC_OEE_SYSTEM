/**
 * 비가동 사유 코드를 사람이 읽는 라벨로 바꾼다.
 *
 * 사유 어휘가 **두 벌 동시에 현역**이며 두 사전의 교집합이 없다(2026-07-28 실측):
 *   - andon 콘솔     → UPPER_SNAKE (`INSPECTION`)      → `machines:states.*`
 *   - 교대 입력 폼   → camelCase   (`equipmentFailure`) → `dataInput:downtime.reasons.*`
 *
 * 어휘 통합은 범위 밖이다(설계 결정). 따라서 두 사전을 차례로 조회한다.
 */

type TranslateFn = (key: string, options?: { defaultValue?: string }) => string;

// 사전에 키가 없음을 감지하기 위한 감시값. 실제 번역문과 절대 겹치지 않는 문자열.
const MISSING = '\u0000__missing__';

export function resolveDowntimeReasonLabel(reason: string, t: TranslateFn): string {
  const fromMachineStates = t(`machines:states.${reason}`, { defaultValue: MISSING });
  if (fromMachineStates !== MISSING) return fromMachineStates;

  const fromFormReasons = t(`dataInput:downtime.reasons.${reason}`, { defaultValue: MISSING });
  if (fromFormReasons !== MISSING) return fromFormReasons;

  // TODO(사용자 작성): 두 사전 어디에도 없는 코드의 폴백.
  // 아래 return 을 지우고 원하는 동작을 구현하세요.
  return reason;
}
