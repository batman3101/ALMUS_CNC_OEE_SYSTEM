/**
 * 생산 기록 목록의 정렬 규격.
 *
 * ## 왜 별도 모듈인가
 *
 * 이 라우트는 정렬 순서를 **두 곳에서** 실현한다.
 *   1. Postgres 의 `ORDER BY` (`.order()` 체인)
 *   2. Node 의 병합 정렬 — 운영자 스코프가 800대라 조회가 청크로 쪼개질 때
 *
 * 둘이 조금이라도 다르면 페이지 경계에서 행이 **사라지거나 중복된다**. 정렬은 페이지를
 * 자르는 기준이기 때문에, "대충 비슷한 순서" 라는 것이 없다. 그래서 규격을 여기 한 번만
 * 적고 양쪽이 그것을 읽는다.
 *
 * ## 정렬 가능한 컬럼을 제한하는 이유
 *
 * 파라미터로 받은 문자열을 그대로 `.order()` 에 넘기면 PostgREST 문법(`col.desc.nullsfirst`)이
 * 섞여 들어올 수 있고, 존재하지 않는 컬럼은 500 이 된다. 허용 목록에 없으면 400 이다 —
 * 오타를 조용히 기본 정렬로 흘리면 "정렬한 줄 알았는데 아니었다" 가 된다.
 *
 * 설비명(`machines.name`)은 **여기에 없다.** 조인된 테이블의 컬럼으로 부모 행을 정렬하는
 * 것은 PostgREST 로 신뢰성 있게 되지 않아서, 되는 척하느니 빼는 쪽을 골랐다.
 * 설비는 목록 위의 설비 필터로 좁힌다.
 */

/** 정렬을 허용하는 컬럼. 전부 `production_records` 에 실재하는 컬럼이다. */
export const RECORD_SORT_FIELDS = [
  'date',
  'shift',
  'output_qty',
  'defect_qty',
  'oee'
] as const;

export type RecordSortField = (typeof RECORD_SORT_FIELDS)[number];
export type SortDirection = 'asc' | 'desc';

/** 값이 문자열로 비교되는 컬럼(날짜·교대·uuid)과 숫자로 비교되는 컬럼을 나눈다. */
const TEXT_FIELDS = new Set<string>(['date', 'shift', 'record_id']);

export interface SortStep {
  column: RecordSortField | 'record_id';
  ascending: boolean;
  /**
   * 항상 `false`. Postgres 기본값은 방향에 따라 달라지지만(ASC=NULLS LAST, DESC=NULLS FIRST),
   * 화면의 `compareNullableNumber` 와 마찬가지로 **값이 없는 행은 어느 방향이든 맨 뒤**로
   * 보낸다. "OEE 높은 순" 첫 화면이 미보고 행으로 가득 차는 것을 막는다.
   */
  nullsFirst: false;
}

/** 기본 정렬 — 최신 교대 먼저. 정렬 파라미터가 없을 때의 동작이며, 기존 동작과 같다. */
export const DEFAULT_SORT: { field: RecordSortField; direction: SortDirection } = {
  field: 'date',
  direction: 'desc'
};

export class InvalidSortError extends Error {}

/**
 * `?sort=oee&order=desc` 를 검증해 정규화한다.
 * 둘 다 없으면 기본 정렬. 값이 허용 목록 밖이면 `InvalidSortError`.
 */
export function parseRecordSort(
  sortParam: string | null,
  orderParam: string | null
): { field: RecordSortField; direction: SortDirection } {
  if (sortParam === null || sortParam === '') {
    if (orderParam !== null && orderParam !== '') {
      throw new InvalidSortError('order requires sort');
    }
    return DEFAULT_SORT;
  }
  if (!(RECORD_SORT_FIELDS as readonly string[]).includes(sortParam)) {
    throw new InvalidSortError(
      `sort must be one of: ${RECORD_SORT_FIELDS.join(', ')}`
    );
  }
  if (orderParam !== null && orderParam !== '' && orderParam !== 'asc' && orderParam !== 'desc') {
    throw new InvalidSortError("order must be 'asc' or 'desc'");
  }
  return {
    field: sortParam as RecordSortField,
    direction: (orderParam as SortDirection) || 'desc'
  };
}

/**
 * 정렬 단계 목록. **마지막은 언제나 `record_id`** 다.
 *
 * `(machine_id, date, shift)` 가 유니크하므로 `date` 하나로는 동점이 생기고, 동점 행의
 * 순서는 Postgres 가 보장하지 않는다. 순서가 요청마다 달라지면 2페이지에 1페이지의 행이
 * 다시 나타난다. `record_id` 는 기본키라 이걸 붙이면 **전순서**가 된다.
 */
export function buildSortSteps(
  field: RecordSortField,
  direction: SortDirection
): SortStep[] {
  const ascending = direction === 'asc';
  const steps: SortStep[] = [{ column: field, ascending, nullsFirst: false }];
  if (field !== 'date') {
    // 같은 값 안에서는 최신 교대가 먼저 — 목록의 성격(최근 기록 확인)에 맞는다.
    steps.push({ column: 'date', ascending: false, nullsFirst: false });
  }
  steps.push({ column: 'record_id', ascending: false, nullsFirst: false });
  return steps;
}

type SortableRow = Record<string, unknown>;

/** 한 단계 비교. Postgres 의 해당 `ORDER BY` 절과 같은 말이어야 한다. */
function compareStep(left: SortableRow, right: SortableRow, step: SortStep): number {
  const a = left[step.column];
  const b = right[step.column];

  const aNull = a === null || a === undefined;
  const bNull = b === null || b === undefined;
  /**
   * `nullsFirst: false` — 방향과 무관하게 NULL 이 뒤다. 그래서 방향을 **곱하지 않고**
   * 바로 돌려준다.
   *
   * ⚠️ 화면 쪽 `compareNullableNumber`(src/utils/tableSorters.ts)는 여기와 부호가 반대다.
   * 같은 규칙인데 구현이 다른 이유는 antd 가 내림차순에서 비교 결과를 통째로 뒤집기
   * 때문이다 — 거기서는 미리 반대 부호를 줘야 하고, 여기 `Array.sort` 는 결과를 그대로
   * 쓰므로 "뒤로" 가 그냥 +1 이다. 처음 작성 때 이 둘을 같게 써서 내림차순만 틀렸다.
   */
  if (aNull && bNull) return 0;
  if (aNull) return 1;
  if (bNull) return -1;

  let cmp: number;
  if (TEXT_FIELDS.has(step.column)) {
    // `localeCompare` 가 아니라 코드포인트 비교다. Postgres 는 uuid 를 바이트 순으로,
    // date/shift 를 사실상 사전순으로 정렬한다. ICU 의 `localeCompare` 는 uuid 의
    // 하이픈을 무시 가능한 문자로 다루는 등 규칙이 달라, 같은 순서를 보장하지 않는다.
    const as = String(a);
    const bs = String(b);
    cmp = as < bs ? -1 : as > bs ? 1 : 0;
  } else {
    cmp = Number(a) - Number(b);
  }
  return step.ascending ? cmp : -cmp;
}

/** 청크 병합용 비교 함수. `buildSortSteps` 가 만든 단계를 순서대로 적용한다. */
export function compareBySortSteps(
  left: SortableRow,
  right: SortableRow,
  steps: readonly SortStep[]
): number {
  for (const step of steps) {
    const cmp = compareStep(left, right, step);
    if (cmp !== 0) return cmp;
  }
  return 0;
}
