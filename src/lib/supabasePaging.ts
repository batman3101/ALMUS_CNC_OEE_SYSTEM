/**
 * 한 조회를 서버 반환 상한과 무관하게 끝까지 읽고, 읽은 결과가 온전한지 **스스로 검증**한다.
 *
 * PostgREST 는 상한(max-rows)을 넘는 조회를 200 으로 조용히 자른다(CLAUDE.md '보이지 않는 상한은 정확성 버그').
 * 그래서 매 쪽마다 `count: 'exact'` 의 전체 개수를 받아, 모은 행 수가 그 개수와 같을 때만 완전하다고 본다.
 *
 * ## 한 번의 요청과 여러 번의 요청은 보장이 다르다 (재감사 PAGE-01, 2026-09-29)
 *
 * - **한 요청으로 끝나면** 서버가 그 한 문장(한 스냅샷)으로 행과 개수를 함께 주므로 그대로 믿는다. 추가 요청은 없다.
 * - **여러 요청이면** 요청 사이에 다른 사용자가 행을 지우고 다른 행을 더하면 개수는 그대로인데 오프셋이 밀려 어떤 행은 빠지고
 *   어떤 행은 겹친다(예: [1,2,3,4] 를 2개씩 읽는 중 1 삭제·5 추가 → [1,2,4,5]). PostgREST 는 요청 사이의 동일 시점(스냅샷)을
 *   제공하지 않으므로 이 어긋남을 개수로는 알 수 없다. 그래서 **같은 전체 읽기를 한 번 더 해서 두 결과가 완전히 같을 때만** 돌려주고,
 *   다르면 처음부터 다시 읽는다(최대 attempts 번). 끝내 안정되지 않으면 명시적으로 실패한다.
 *   이것은 이론적 보증이 아니라 실용적 검출이다(두 번 다 똑같이 찢어질 확률은 무시할 만하다). 컬렉션이 서버 상한을 넘어 자주
 *   바뀌는 규모가 되면, 한 SQL 문장으로 결과를 모아 주는 RPC(단일 jsonb)로 옮기는 것이 정답이다 - 지금 규모(수백 행)에서는
 *   여러 쪽 읽기 자체가 일어나지 않는다.
 *
 * 그 밖에
 * - 다음 쪽은 **실제로 받은 행 수**에서 시작한다(서버 상한이 pageSize 보다 낮아도 빠뜨리지 않는다).
 * - 개수를 못 받았거나(확인 불가) 개수는 더 있다는데 빈 쪽이 오면 실패한다 - 잘린 결과를 정상으로 돌려주지 않는다.
 * - `keyOf` 를 주면 한 번 읽은 결과 안에 같은 키가 둘 이상 있는지도 검사한다(쪽 경계 중복).
 * - 호출자는 안정된 정렬(유일한 열 포함)을 걸어야 한다. 정렬이 흔들리면 쪽 경계에서 중복·누락이 생긴다.
 */
export interface PageResult<T> { data: T[] | null; error: unknown; count: number | null }

export class IncompleteReadError extends Error {
  constructor(readonly reason: 'count_missing' | 'short_page' | 'changed', readonly collected: number, readonly total: number | null) {
    super('incomplete_read:' + reason);
    this.name = 'IncompleteReadError';
  }
}

type Pass<T> = { ok: true; rows: T[]; pages: number } | { ok: false; collected: number; total: number | null };

/** 처음부터 끝까지 한 번 읽는다. 읽는 중 개수가 바뀌었거나 모은 수가 개수와 다르면 ok:false. */
async function collectPass<T>(readPage: (from: number, to: number) => PromiseLike<PageResult<T>>, pageSize: number): Promise<Pass<T>> {
  const rows: T[] = [];
  let total: number | null = null;
  let pages = 0;
  for (;;) {
    const page = await readPage(rows.length, rows.length + pageSize - 1);
    pages += 1;
    if (page.error) throw page.error;
    if (page.count === null || page.count === undefined) throw new IncompleteReadError('count_missing', rows.length, null);
    if (total === null) total = page.count;
    else if (page.count !== total) return { ok: false, collected: rows.length, total };

    const received = page.data ?? [];
    rows.push(...received);
    if (rows.length >= total) break;
    if (received.length === 0) throw new IncompleteReadError('short_page', rows.length, total);
  }
  return rows.length === total ? { ok: true, rows, pages } : { ok: false, collected: rows.length, total };
}

const sameRows = <T,>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((row, i) => JSON.stringify(row) === JSON.stringify(b[i]));
const hasUniqueKeys = <T,>(rows: readonly T[], keyOf?: (row: T) => string) => !keyOf || new Set(rows.map(keyOf)).size === rows.length;

export async function readAllRows<T>(
  readPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
  options: { pageSize?: number; attempts?: number; keyOf?: (row: T) => string } = {},
): Promise<T[]> {
  const { pageSize = 1000, attempts = 3, keyOf } = options;
  let lastChange: IncompleteReadError | null = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const first = await collectPass(readPage, pageSize);
    if (!first.ok) { lastChange = new IncompleteReadError('changed', first.collected, first.total); continue; }
    if (!hasUniqueKeys(first.rows, keyOf)) { lastChange = new IncompleteReadError('changed', first.rows.length, first.rows.length); continue; }
    // 한 번의 요청으로 끝났다: 서버가 한 스냅샷으로 준 것이므로 그대로 믿는다.
    if (first.pages === 1) return first.rows;

    // 여러 요청: 요청 사이의 변경은 개수로 알 수 없다. 같은 읽기를 한 번 더 해서 완전히 같을 때만 믿는다.
    const second = await collectPass(readPage, pageSize);
    if (second.ok && sameRows(first.rows, second.rows)) return first.rows;
    lastChange = new IncompleteReadError('changed', first.rows.length, second.ok ? second.rows.length : second.total);
  }
  throw lastChange as IncompleteReadError;
}
