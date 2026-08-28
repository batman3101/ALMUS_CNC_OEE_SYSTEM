/**
 * Ant Design `<Table>` 컬럼의 `sorter` 로 넘길 비교 함수 모음.
 *
 * 표마다 비교 함수를 따로 쓰면 규칙이 갈라진다. 특히 **값이 없는 행을 어디에 둘지**가
 * 표마다 다르면 같은 화면인데 정렬 결과의 성격이 달라 보인다. 그래서 여기 한 곳에서만
 * 정한다.
 *
 * ## 왜 `sortOrder` 를 받는가
 *
 * antd 는 내림차순일 때 비교 결과를 **그대로 뒤집는다**(`descend ? -sorter(a,b) : sorter(a,b)`).
 * 그래서 "null 을 뒤로" 를 방향과 무관하게 지키려면 비교 함수가 방향을 알아야 한다.
 * antd 는 `sorter(a, b, sortOrder)` 로 세 번째 인자에 방향을 넘겨준다.
 */

export type SortOrder = 'ascend' | 'descend' | null | undefined;

/** 값이 없는 것으로 취급할 것들. `NaN` 도 포함된다 — 계산 실패의 결과이지 0 이 아니다. */
const isBlank = (value: number | null | undefined): boolean =>
  value === null || value === undefined || Number.isNaN(value);

/**
 * 값이 없는 행을 정렬 방향과 무관하게 **항상 맨 뒤**로 보낸다.
 *
 * `NULL` 은 "0%" 가 아니라 "계산할 수 없음" 이다. 0 으로 취급하면 데이터가 없을 뿐인
 * 정상 설비가 최하위로 보인다(CLAUDE.md 의 "A NULL metric is not 0%" 참고).
 * 그렇다고 내림차순에서 맨 앞에 두면, "OEE 높은 순" 을 눌렀을 때 화면 첫 줄이 전부
 * 빈 칸이 된다. 어느 방향으로 정렬하든 **본 데이터가 먼저**가 유일하게 쓸모 있는 배치다.
 */
const blankLast = (sortOrder: SortOrder): number =>
  sortOrder === 'descend' ? -1 : 1;

/** 숫자 컬럼. `null`/`undefined`/`NaN` 은 항상 맨 뒤. */
export const compareNullableNumber = (
  left: number | null | undefined,
  right: number | null | undefined,
  sortOrder?: SortOrder
): number => {
  const leftBlank = isBlank(left);
  const rightBlank = isBlank(right);
  if (leftBlank && rightBlank) return 0;
  if (leftBlank) return blankLast(sortOrder);
  if (rightBlank) return -blankLast(sortOrder);
  return (left as number) - (right as number);
};

/**
 * 문자열 컬럼. 한국어·베트남어를 쓰므로 `localeCompare` 로 비교한다
 * (`'가' < '힣'` 같은 코드포인트 비교는 언어에 따라 틀린 순서를 낸다).
 * 빈 문자열과 `null` 은 값이 없는 것으로 보고 맨 뒤로 보낸다.
 */
export const compareText = (
  left: string | null | undefined,
  right: string | null | undefined,
  sortOrder?: SortOrder
): number => {
  const leftBlank = !left;
  const rightBlank = !right;
  if (leftBlank && rightBlank) return 0;
  if (leftBlank) return blankLast(sortOrder);
  if (rightBlank) return -blankLast(sortOrder);
  return (left as string).localeCompare(right as string);
};

/**
 * 날짜 컬럼. ISO 문자열·`Date`·epoch 밀리초를 모두 받는다.
 * 파싱에 실패한 값은 `NaN` 이 되어 "값 없음" 과 같은 취급을 받는다 —
 * 1970-01-01 로 떨어져서 목록 맨 끝에 조용히 섞이는 것보다 낫다.
 */
export const compareDate = (
  left: string | number | Date | null | undefined,
  right: string | number | Date | null | undefined,
  sortOrder?: SortOrder
): number => compareNullableNumber(toTime(left), toTime(right), sortOrder);

const toTime = (value: string | number | Date | null | undefined): number | null => {
  if (value === null || value === undefined || value === '') return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(time) ? null : time;
};

/**
 * 범주형 컬럼(상태, 교대, 등급처럼 값의 가짓수가 정해진 것).
 *
 * 가나다순은 이런 컬럼에서 의미가 없다 — "정상/오류/정지" 를 이름순으로 늘어놓으면
 * 심각도 순서가 사라진다. `order` 에 준 순서가 곧 정렬 순서다.
 * 목록에 없는 값은 맨 뒤로 간다.
 */
export const compareByRank = <T extends string>(order: readonly T[]) => {
  const rank = new Map<string, number>(order.map((value, index) => [value, index]));
  return (
    left: string | null | undefined,
    right: string | null | undefined,
    sortOrder?: SortOrder
  ): number =>
    compareNullableNumber(
      left == null ? null : rank.get(left) ?? null,
      right == null ? null : rank.get(right) ?? null,
      sortOrder
    );
};
