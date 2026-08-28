/**
 * 마감 대기 큐의 정렬 규격.
 *
 * 이 라우트는 두 테이블의 차집합을 Node 에서 만든 뒤 **전체를 정렬하고 잘라낸다**. 그래서
 * 정렬은 화면이 받은 한 페이지가 아니라 대기 목록 전체에 대해 이뤄진다 — 클라이언트
 * 정렬이었다면 "20건 중 20건" 안에서만 정렬됐을 것이다.
 */

export const QUEUE_SORT_FIELDS = ['machine_name', 'date', 'shift', 'last_qty'] as const;
export type QueueSortField = (typeof QUEUE_SORT_FIELDS)[number];
export type SortDirection = 'asc' | 'desc';

export interface QueueItemLike {
  machine_id: string;
  machine_name: string;
  date: string;
  shift: 'A' | 'B';
  last_qty: number | null;
}

/**
 * 기본 정렬 — 오래된 교대 먼저.
 *
 * 마감은 밀린 것부터 처리하는 일이라 오래된 것이 위에 와야 한다. 정렬 파라미터가 없을
 * 때의 동작이며 기존과 같다.
 */
export const DEFAULT_QUEUE_SORT: { field: QueueSortField; direction: SortDirection } = {
  field: 'date',
  direction: 'asc'
};

export class InvalidQueueSortError extends Error {}

export function parseQueueSort(
  sortParam: string | null,
  orderParam: string | null
): { field: QueueSortField; direction: SortDirection } {
  if (sortParam === null || sortParam === '') {
    if (orderParam !== null && orderParam !== '') {
      throw new InvalidQueueSortError('order requires sort');
    }
    return DEFAULT_QUEUE_SORT;
  }
  if (!(QUEUE_SORT_FIELDS as readonly string[]).includes(sortParam)) {
    throw new InvalidQueueSortError(`sort must be one of: ${QUEUE_SORT_FIELDS.join(', ')}`);
  }
  if (orderParam !== null && orderParam !== '' && orderParam !== 'asc' && orderParam !== 'desc') {
    throw new InvalidQueueSortError("order must be 'asc' or 'desc'");
  }
  return {
    field: sortParam as QueueSortField,
    direction: (orderParam as SortDirection) || 'asc'
  };
}

const shiftRank = (s: string) => (s === 'A' ? 0 : 1);

/** 진척 미기록(`last_qty === null`)은 방향과 무관하게 맨 뒤. */
const compareLastQty = (a: number | null, b: number | null, ascending: boolean): number => {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return ascending ? a - b : b - a;
};

/**
 * 정렬 비교 함수를 만든다.
 *
 * 어떤 컬럼으로 정렬하든 마지막 기준은 `(date, shift, machine_id)` 다 — 이 셋이 대기
 * 항목의 안정 키다. 동점이 남으면 폴링이 돌 때마다 순서가 바뀌어 사용자가 입력하던 행이
 * 다른 페이지로 튄다.
 */
export function buildQueueComparator(
  field: QueueSortField,
  direction: SortDirection
): (a: QueueItemLike, b: QueueItemLike) => number {
  const ascending = direction === 'asc';
  const sign = ascending ? 1 : -1;

  const primary = (a: QueueItemLike, b: QueueItemLike): number => {
    switch (field) {
      case 'machine_name':
        return sign * a.machine_name.localeCompare(b.machine_name);
      case 'date':
        return sign * a.date.localeCompare(b.date);
      case 'shift':
        return sign * (shiftRank(a.shift) - shiftRank(b.shift));
      case 'last_qty':
        return compareLastQty(a.last_qty, b.last_qty, ascending);
    }
  };

  return (a, b) =>
    primary(a, b)
    || a.date.localeCompare(b.date)
    || shiftRank(a.shift) - shiftRank(b.shift)
    || a.machine_id.localeCompare(b.machine_id);
}
