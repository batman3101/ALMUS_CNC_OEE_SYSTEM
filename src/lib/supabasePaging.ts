/**
 * 한 조회를 서버 반환 상한과 무관하게 끝까지 읽고, 끝까지 읽었는지 **스스로 증명**한다.
 *
 * PostgREST 는 상한(max-rows)을 넘는 조회를 200 으로 조용히 자른다(CLAUDE.md '보이지 않는 상한은 정확성 버그').
 * `limit(N)` 을 크게 잡고 '받은 행이 N 이하면 완전하다'고 믿는 방식은 서버 상한이 N 보다 낮으면 그대로 뚫린다.
 * 그래서 매 쪽마다 `count: 'exact'` 의 전체 개수를 받아, 모은 행 수가 그 개수와 같을 때만 완전하다고 본다.
 *
 * - 다음 쪽은 **실제로 받은 행 수**에서 시작한다(서버 상한이 pageSize 보다 낮아도 빠뜨리지 않는다).
 * - 읽는 사이 행이 바뀌어 개수가 달라지면 처음부터 다시 읽는다(최대 attempts 번). 끝내 안정되지 않으면 실패한다.
 * - 개수를 못 받았거나(확인 불가) 개수는 더 있다는데 빈 쪽이 오면 실패한다 - 잘린 결과를 정상으로 돌려주지 않는다.
 * - 호출자는 안정된 정렬(유일한 열 포함)을 걸어야 한다. 정렬이 흔들리면 쪽 경계에서 중복·누락이 생긴다.
 */
export interface PageResult<T> { data: T[] | null; error: unknown; count: number | null }

export class IncompleteReadError extends Error {
  constructor(readonly reason: 'count_missing' | 'short_page' | 'changed', readonly collected: number, readonly total: number | null) {
    super('incomplete_read:' + reason);
    this.name = 'IncompleteReadError';
  }
}

export async function readAllRows<T>(
  readPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; attempts?: number } = {},
): Promise<T[]> {
  const { pageSize = 1000, attempts = 3 } = options;
  let lastChange: IncompleteReadError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const rows: T[] = [];
    let total: number | null = null;
    let changed = false;

    for (;;) {
      const page = await readPage(rows.length, rows.length + pageSize - 1);
      if (page.error) throw page.error;
      if (page.count === null || page.count === undefined) throw new IncompleteReadError('count_missing', rows.length, null);
      if (total === null) total = page.count;
      else if (page.count !== total) { changed = true; break; }

      const received = page.data ?? [];
      rows.push(...received);
      if (rows.length >= total) break;
      if (received.length === 0) throw new IncompleteReadError('short_page', rows.length, total);
    }

    if (!changed && rows.length === total) return rows;
    lastChange = new IncompleteReadError('changed', rows.length, total);
  }
  throw lastChange as IncompleteReadError;
}
