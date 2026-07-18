const mockFrom = jest.fn();

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a) },
}));

import { loadDowntimeSourceRows, getShiftWindow } from '../shiftDowntime';

const MACHINE = '11111111-1111-4111-8111-111111111111';
const START = '2026-07-17T01:00:00.000Z';
const END = '2026-07-17T13:00:00.000Z';

/** downtime_entries / machine_logs 의 체이닝 쿼리를 흉내낸다. 마지막 .range 가 결과를 준다. */
const makeQuery = (data: unknown[]) => {
  const q: Record<string, unknown> = {};
  ['select', 'eq', 'neq', 'lt', 'or', 'order'].forEach(m => { q[m] = () => q; });
  q.range = async () => ({ data, error: null });
  return q;
};

/** system_settings 조회(getBusinessTimeConfig): select→in→eq 가 결과를 준다. */
const settingsQuery = (rows: unknown[]) => {
  const q: Record<string, unknown> = {};
  q.select = () => q;
  q.in = () => q;
  q.eq = async () => ({ data: rows, error: null });
  return q;
};

describe('loadDowntimeSourceRows', () => {
  beforeEach(() => jest.clearAllMocks());

  it('downtime_entries 와 machine_logs 를 합쳐 반환한다', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'downtime_entries') {
        return makeQuery([
          { start_time: '2026-07-17T09:00:00+07:00', end_time: null, reason: 'PLANNED_STOP' },
        ]);
      }
      if (table === 'machine_logs') {
        return makeQuery([
          { start_time: '2026-07-17T10:00:00+07:00', end_time: '2026-07-17T10:30:00+07:00', state: 'BREAKDOWN_REPAIR' },
        ]);
      }
      throw new Error(`unexpected table ${table}`);
    });

    const rows = await loadDowntimeSourceRows(MACHINE, START, END);

    expect(rows).toHaveLength(2);
    // downtime_entries 의 계획정지 reason → is_planned true
    expect(rows).toContainEqual({
      start_time: '2026-07-17T09:00:00+07:00', end_time: null, is_planned: true,
    });
    // machine_logs 의 비정상 상태(BREAKDOWN_REPAIR) → is_planned false
    expect(rows).toContainEqual({
      start_time: '2026-07-17T10:00:00+07:00', end_time: '2026-07-17T10:30:00+07:00', is_planned: false,
    });
  });

  it('machine_logs 의 PLANNED_STOP 상태는 is_planned 로 표시한다', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'downtime_entries') return makeQuery([]);
      if (table === 'machine_logs') {
        return makeQuery([
          { start_time: '2026-07-17T11:00:00+07:00', end_time: null, state: 'PLANNED_STOP' },
        ]);
      }
      throw new Error(`unexpected table ${table}`);
    });

    const rows = await loadDowntimeSourceRows(MACHINE, START, END);
    expect(rows).toEqual([
      { start_time: '2026-07-17T11:00:00+07:00', end_time: null, is_planned: true },
    ]);
  });

  it('원천 조회가 실패하면 throw 한다 (호출부가 null 로 처리)', async () => {
    mockFrom.mockImplementation(() => ({
      select: () => ({ eq: () => ({ lt: () => ({ or: () => ({ order: () => ({
        range: async () => ({ data: null, error: { message: 'boom' } }),
      }) }) }) }) }),
    }));

    await expect(loadDowntimeSourceRows(MACHINE, START, END)).rejects.toBeTruthy();
  });
});

describe('getShiftWindow', () => {
  beforeEach(() => jest.clearAllMocks());

  it('A교대의 시간창을 만든다 (설정 기본값 08:00~20:00)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'system_settings') return settingsQuery([]); // 빈 설정 → 기본값
      throw new Error(`unexpected table ${table}`);
    });

    const window = await getShiftWindow('2026-07-17', 'A');
    expect(window).not.toBeNull();
    // 12시간 = 720분
    expect(Math.round((window!.end - window!.start) / 60000)).toBe(720);
  });

  it('B교대의 시간창은 자정을 넘는다 (20:00~다음날 08:00)', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'system_settings') return settingsQuery([]);
      throw new Error(`unexpected table ${table}`);
    });

    const window = await getShiftWindow('2026-07-17', 'B');
    expect(window).not.toBeNull();
    expect(Math.round((window!.end - window!.start) / 60000)).toBe(720);
    // B교대 시작은 A교대 시작보다 뒤(같은 날 20:00)
    const aWindow = await getShiftWindow('2026-07-17', 'A');
    expect(window!.start).toBeGreaterThan(aWindow!.start);
  });
});
