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

  // 두 사전 어디에도 없으면 **원문 코드를 그대로 노출한다** (2026-07-28 사용자 결정).
  //
  // 이 자리에 도달하는 경우는 사실상 하나뿐이다 — **번역 누락**. machine_status ENUM 이나
  // 입력 폼 사유에 항목이 추가됐는데 locales 에 키를 안 넣었을 때다.
  // (2026-07-28 실측: 실제 데이터 13종이 전부 둘 중 한 사전에 있어 폴백 도달 0건.)
  //
  // "기타" 로 뭉개지 않는 이유: `other` 가 **이미 실제 사유 코드**로 91건 존재한다.
  // 미번역 코드를 "기타" 로 접으면 진짜 기타와 섞여 분석에서 구분이 불가능해지고,
  // "기타가 왜 늘었지?" 에서 원인을 되짚을 수 없다. 못생긴 코드가 화면에 뜨는 편이
  // 원인을 1분 안에 특정하게 해 준다 — 이 저장소의 "틀린 값보다 없는 값이 낫다" 와 같은 규율.
  return reason;
}
