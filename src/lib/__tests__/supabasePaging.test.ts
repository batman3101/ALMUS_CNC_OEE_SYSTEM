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
    expect(calls.map(c => c[0])).toEqual([0, 1000, 2000]);
  });

  it('서버 상한이 요청한 쪽 크기보다 낮아도 실제로 받은 행 수에서 이어 읽어 빠뜨리지 않는다', async () => {
    const { read, calls } = fakeServer(1001, 400);
    const rows = await readAllRows(read, { pageSize: 1000 });
    expect(rows).toHaveLength(1001);
    expect(new Set(rows).size).toBe(1001);
    expect(calls.map(c => c[0])).toEqual([0, 400, 800]);
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
});
