import type { TFunction } from 'i18next';

/**
 * machines.location 은 DB 에 한국어 값으로 저장돼 있다 (현재 'A동' 448대 / 'B동' 352대).
 * 값을 DB 에서 바꾸면 필터/정렬/기존 데이터가 함께 깨지므로, 번역은 표시 계층에서만 한다.
 *
 * 관리자는 설비 등록 폼에서 위치를 자유 입력할 수 있어 값 집합이 닫혀 있다는 보장은 없다.
 * 따라서 매핑에 없는 값은 감추지 않고 원문 그대로 보여준다.
 *
 * ⚠️ 이 함수는 "표시용 라벨"만 만든다. 필터 값, 폼 입력값, 정렬 키에는 절대 쓰지 말 것
 *    (그 자리에는 DB 원본 값이 그대로 있어야 한다).
 */
const LOCATION_TRANSLATION_KEYS: Record<string, string> = {
  'A동': 'machines:locations.buildingA',
  'B동': 'machines:locations.buildingB',
};

export function formatMachineLocation(
  location: string | null | undefined,
  t: TFunction
): string {
  if (!location) return '-';
  const key = LOCATION_TRANSLATION_KEYS[location];
  return key ? t(key) : location;
}
