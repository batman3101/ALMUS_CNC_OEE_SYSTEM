import { IncompleteReadError, readAllRows, type PageResult } from '../supabasePaging';

/** 서버를 흉내 낸다: 전체 rows 에서 요청한 범위를 주되, 한 번에 cap 개까지만 준다(PostgREST max-rows). */
function fakeServer(total: number, cap: number, count: (call: number) => number | null = () => total) {
  const calls: Array<[number, number]> = [];
  const read = async (from: number, to: number): Promise<PageResult<number>> => {
    calls.push([from, to]);
    const end = Math.min(to + 1, from + cap, total);
    return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null, count: count(calls.length) };
  };
  return { read, calls };
}

interface Row { id: number; order: number }
const sortRows = (rows: Row[]) => [...rows].sort((a, b) => a.order - b.order || a.id - b.id);

/** 요청 사이에 데이터가 바뀔 수 있는 서버. hook(호출 번호, 현재 행)이 그 요청에 답하기 전에 행을 바꾼다. 개수는 그때의 행 수다. */
function mutableServer<T>(initial: T[], hook: (call: number, rows: T[]) => T[]) {
  let rows = [...initial];
  let call = 0;
  const read = async (from: number, to: number): Promise<PageResult<T>> => {
    call += 1;
    rows = hook(call, rows);
    return { data: rows.slice(from, Math.min(to + 1, rows.length)), error: null, count: rows.length };
  };
  return { read, calls: () => call };
}

describe('readAllRows - 서버 상한과 무관하게 끝까지 읽고 완전성을 증명한다', () => {
  it('한 쪽에 다 들어오면 한 번만 읽는다', async () => {
    const { read, calls } = fakeServer(3, 1000);
    await expect(readAllRows(read)).resolves.toEqual([0, 1, 2]);
    expect(calls).toEqual([[0, 999]]);
  });

  it('빈 결과(전체 0)는 정상이다 - 빈 쪽을 잘림으로 오해하지 않는다', async () => {
    const { read, calls } = fakeServer(0, 1000);
    await expect(readAllRows(read)).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it('서버가 쪽 크기만큼 줄 때 여러 쪽을 이어 붙인다', async () => {
    const { read, calls } = fakeServer(2500, 1000);
    const rows = await readAllRows(read, { pageSize: 1000 });
    expect(rows).toHaveLength(2500);
    expect(rows[0]).toBe(0);
    expect(rows[2499]).toBe(2499);
    // 안정된 데이터: 같은 읽기를 한 번 더 해서 확인한다(재감사 PAGE-01).
    expect(calls.map(c => c[0])).toEqual([0, 1000, 2000, 0, 1000, 2000]);
  });

  it('서버 상한이 요청한 쪽 크기보다 낮아도 실제로 받은 행 수에서 이어 읽어 빠뜨리지 않는다', async () => {
    const { read, calls } = fakeServer(1001, 400);
    const rows = await readAllRows(read, { pageSize: 1000 });
    expect(rows).toHaveLength(1001);
    expect(new Set(rows).size).toBe(1001);
    expect(calls.map(c => c[0])).toEqual([0, 400, 800, 0, 400, 800]);
  });

  it('전체 개수를 받지 못하면 확인할 수 없으므로 실패한다', async () => {
    const { read } = fakeServer(5, 1000, () => null);
    await expect(readAllRows(read)).rejects.toMatchObject({ name: 'IncompleteReadError', reason: 'count_missing' });
  });

  it('개수는 더 있다는데 빈 쪽이 오면 조용히 넘기지 않고 실패한다', async () => {
    const read = async (): Promise<PageResult<number>> => ({ data: [], error: null, count: 5 });
    await expect(readAllRows(read)).rejects.toMatchObject({ reason: 'short_page', collected: 0, total: 5 });
  });

  it('조회 오류는 감싸지 않고 그대로 던진다', async () => {
    const failure = { code: 'PGRST301', message: 'JWT expired' };
    await expect(readAllRows(async () => ({ data: null, error: failure, count: null }))).rejects.toBe(failure);
  });

  it('읽는 사이 개수가 바뀌면 처음부터 다시 읽어 안정된 결과를 돌려준다', async () => {
    // 첫 시도의 2쪽에서 전체가 1001 → 1002 로 바뀐다. 두 번째 시도부터는 1002 로 안정된다.
    let total = 1001;
    const calls: number[] = [];
    const read = async (from: number, to: number): Promise<PageResult<number>> => {
      calls.push(from);
      if (calls.length === 2) total = 1002;
      const end = Math.min(to + 1, from + 1000, total);
      return { data: Array.from({ length: Math.max(0, end - from) }, (_, i) => from + i), error: null, count: total };
    };
    const rows = await readAllRows(read, { pageSize: 1000 });
    expect(rows).toHaveLength(1002);
    expect(calls.length).toBeGreaterThan(2);
  });

  it('끝내 안정되지 않으면 attempts 번 뒤에 changed 로 실패한다', async () => {
    let n = 0;
    const read = async (from: number): Promise<PageResult<number>> => {
      n += 1;
      // 쪽마다 개수가 달라진다.
      return { data: [from], error: null, count: 10 + n };
    };
    await expect(readAllRows(read, { pageSize: 1, attempts: 2 })).rejects.toMatchObject({ reason: 'changed' });
    expect(n).toBeLessThanOrEqual(4);
  });

  it('모은 행이 전체 개수보다 많아지면(쪽 경계 중복) 다시 읽고, 계속 그러면 실패한다', async () => {
    const read = async (): Promise<PageResult<number>> => ({ data: [1, 2, 3], error: null, count: 2 });
    await expect(readAllRows(read, { attempts: 2 })).rejects.toBeInstanceOf(IncompleteReadError);
  });

  // ── 재감사 PAGE-01 (2026-09-29): 여러 쪽을 읽는 사이의 동시 변경 ─────────────────────────────────────
  it('PAGE-01: 쪽 사이에 행 하나를 지우고 다른 행을 더해 총개수가 그대로여도, 빠진 행 없는 일관된 결과를 돌려준다 (감사 재현)', async () => {
    // [1,2,3,4] 를 2개씩 읽는 중 두 번째 요청 전에 1 삭제·5 추가. 예전에는 [1,2,4,5] 를 완전하다며 반환했다(3 은 전후 모두 존재).
    const { read } = mutableServer([1, 2, 3, 4], (call, rows) => (call === 2 ? [2, 3, 4, 5] : rows));
    await expect(readAllRows(read, { pageSize: 2 })).resolves.toEqual([2, 3, 4, 5]);
  });

  it.each([
    ['키 검사 없이(두 번째 읽기와의 비교로)', undefined],
    ['키 검사와 함께(중복 id 로)', (row: Row) => String(row.id)],
  ])('PAGE-01: 정렬 키가 바뀌어 행이 쪽 경계를 넘어 이동해도(중복·누락) 일관된 결과를 돌려준다 - %s', async (_label, keyOf) => {
    const initial: Row[] = [1, 2, 3, 4].map(id => ({ id, order: id }));
    // 두 번째 요청 전에 1 의 정렬 값이 9 로 바뀌어 [2,3,4,1] 이 된다: 1 은 처음 쪽에서 읽혔고 다음 쪽에서 또 읽히며 3 은 빠진다.
    const { read } = mutableServer(initial, (call, rows) => (call === 2 ? sortRows(rows.map(r => (r.id === 1 ? { ...r, order: 9 } : r))) : rows));
    const rows = await readAllRows(read, { pageSize: 2, keyOf });
    expect(rows.map(r => r.id)).toEqual([2, 3, 4, 1]);
  });

  it('PAGE-01: 읽는 내내 계속 바뀌어 안정되지 않으면 attempts 번 뒤에 명시적으로 실패한다(틀린 결과를 돌려주지 않는다)', async () => {
    // 호출마다 창이 한 칸씩 밀린다: 두 번 읽어도 결코 같지 않다(개수는 늘 4).
    const { read } = mutableServer([1, 2, 3, 4], call => [call, call + 1, call + 2, call + 3]);
    await expect(readAllRows(read, { pageSize: 2, attempts: 2 })).rejects.toMatchObject({ name: 'IncompleteReadError', reason: 'changed' });
  });

  it('PAGE-01: 확인용 두 번째 읽기 도중 변경이 드러나면(개수가 달라짐) 첫 결과를 믿지 않고 처음부터 다시 읽는다', async () => {
    // 첫 읽기는 [1,2,3,4] 로 깨끗하다. 두 번째 읽기의 둘째 요청(호출 4)에서 5 가 추가돼 개수가 4 → 5 로 바뀐다.
    // 첫 결과를 그대로 돌려주면 5 가 빠진 낡은 결과가 된다.
    const { read } = mutableServer([1, 2, 3, 4], (call, rows) => (call === 4 ? [1, 2, 3, 4, 5] : rows));
    await expect(readAllRows(read, { pageSize: 2 })).resolves.toEqual([1, 2, 3, 4, 5]);
  });

  it('PAGE-01: 한 번의 요청으로 끝나는 읽기는 서버가 한 스냅샷으로 준 것이므로 두 번째 읽기를 하지 않는다', async () => {
    const { read, calls } = mutableServer([1, 2, 3], (_call, rows) => rows);
    await expect(readAllRows(read, { pageSize: 10 })).resolves.toEqual([1, 2, 3]);
    expect(calls()).toBe(1);
  });

  it('PAGE-01: 여러 쪽 읽기는 같은 결과를 두 번 읽어 확인한다 (안정된 데이터: 요청 수 = 쪽 수 × 2)', async () => {
    const { read, calls } = mutableServer([1, 2, 3, 4, 5], (_call, rows) => rows);
    await expect(readAllRows(read, { pageSize: 2 })).resolves.toEqual([1, 2, 3, 4, 5]);
    expect(calls()).toBe(6);
  });

  it('PAGE-01: keyOf 를 주면 한 번 읽은 결과 안의 같은 키(쪽 경계 중복)를 실패로 본다', async () => {
    const read = async (): Promise<PageResult<number>> => ({ data: [1, 1], error: null, count: 2 });
    await expect(readAllRows(read, { attempts: 2, keyOf: String })).rejects.toMatchObject({ reason: 'changed' });
  });
});
