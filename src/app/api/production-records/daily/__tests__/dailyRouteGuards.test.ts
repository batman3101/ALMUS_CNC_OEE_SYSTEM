/**
 * 일일 생산 저장 라우트의 경계 (감사 2026-11-14 F-02·F-03).
 *
 * F-02: 이 라우트는 '휴무' 체크로 확정 기록을 지운다. 삭제는 admin/engineer 만의 권한이므로
 *       라우트 자체가 그 역할로 닫혀야 한다(유일한 화면 /data-input 도 MANAGERS).
 *       또 화면이 읽은 뒤 다른 사람이 같은 교대를 고쳤으면 덮어쓰지 않고 409 로 돌려보낸다 —
 *       판단은 save_daily_production_v2 가 잠금 아래에서 한다. 라우트는 화면이 본 지문과
 *       비가동 원천 지문(digest)을 빠짐없이 넘겨야 한다.
 * F-03: operating_minutes 는 0 이상의 정수이고 설정된 교대 창 길이를 넘을 수 없다.
 */
const mockRequireFactoryUser = jest.fn();
const mockAssertMachineAccess = jest.fn();
const mockRpc = jest.fn();
const mockBusinessTime = jest.fn();
const mockLoadDowntimeSourceRows = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({ body, status: init?.status ?? 200 }),
  },
}));

jest.mock('@/lib/factoryAuth', () => ({
  requireFactoryUser: (...args: unknown[]) => mockRequireFactoryUser(...args),
}));

jest.mock('@/lib/apiAuth', () => ({
  assertMachineAccess: (...args: unknown[]) => mockAssertMachineAccess(...args),
  apiAuthErrorResponse: () => null,
}));

jest.mock('@/lib/plannedRuntime', () => ({ getBreakTimeMinutes: jest.fn(async () => 60) }));
jest.mock('@/lib/shiftConfig', () => ({ getBusinessTimeConfig: (...a: unknown[]) => mockBusinessTime(...a) }));
jest.mock('@/lib/shiftDowntime', () => ({
  loadDowntimeSourceRows: (...a: unknown[]) => mockLoadDowntimeSourceRows(...a),
}));
jest.mock('@/lib/redactSecrets', () => ({ redactSecrets: (value: unknown) => value }));

const MACHINE = '11111111-1111-4111-8111-111111111111';
const FACTORY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function query<T>(result: { data: T; error: unknown }) {
  const q: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'in']) q[method] = jest.fn(() => q);
  q.single = jest.fn(async () => result);
  q.maybeSingle = jest.fn(async () => result);
  q.then = (resolvePromise: (value: typeof result) => unknown) => Promise.resolve(result).then(resolvePromise);
  return q;
}

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn((table: string) => {
      if (table === 'machines') return query({ data: { id: MACHINE, name: 'M-1', is_active: true }, error: null });
      if (table === 'machines_with_production_info') {
        return query({ data: { current_tact_time: 120, current_cavity_count: 1 }, error: null });
      }
      if (table === 'production_records') return query({ data: [], error: null });
      throw new Error(`unexpected table ${table}`);
    }),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { POST } from '@/app/api/production-records/daily/route';

type RouteResponse = { status: number; body: Record<string, unknown> };
const post = async (body: Record<string, unknown>) =>
  (await POST({ json: jest.fn(async () => body) } as never)) as unknown as RouteResponse;

const STALE_SNAPSHOT = {
  record_id: 'record-a',
  output_qty: 100,
  defect_qty: 1,
  planned_runtime: 660,
  actual_runtime: 660,
  ideal_runtime: 200,
  downtime_minutes: 0,
  tact_time_seconds: 120,
  availability: 1,
  performance: 0.303,
  quality: 0.99,
  oee: 0.3,
};

const base = (overrides: Record<string, unknown> = {}) => ({
  machine_id: MACHINE,
  date: '2026-07-14',
  day_shift_off: false,
  night_shift_off: false,
  day_shift: { actual_production: 100, defect_quantity: 1, operating_minutes: 720 },
  expected_records: { A: null },
  ...overrides,
});

const saveCalls = () => mockRpc.mock.calls.filter(([name]) => String(name).startsWith('save_daily_production'));

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireFactoryUser.mockResolvedValue({
    userId: 'engineer-1', role: 'engineer', factoryId: FACTORY, assignedMachineIds: [],
  });
  mockBusinessTime.mockResolvedValue({
    timezone: 'Asia/Ho_Chi_Minh', shiftAStart: '08:00', shiftBStart: '20:00', shiftChangeBufferMinutes: 10,
  });
  mockLoadDowntimeSourceRows.mockResolvedValue([]);
  mockRpc.mockImplementation(async (name: string) => {
    if (name === 'downtime_window_digest') return { data: 'digest-1', error: null };
    return { data: { ok: true, saved_records: [{ record_id: 'record-a' }], deleted_shifts: [] }, error: null };
  });
});

describe('F-02 권한: 일일 저장은 삭제 권한과 같은 역할만', () => {
  it('admin·engineer 만 허용한다 (operator 는 현장 콘솔 마감을 쓴다)', async () => {
    await post(base());
    expect(mockRequireFactoryUser).toHaveBeenCalledWith(expect.anything(), ['admin', 'engineer']);
  });
});

describe('F-02 동시성: 화면이 본 기록과 비가동 원천을 잠금 아래에서 대조한다', () => {
  it('기존 RPC 가 아니라 대조하는 save_daily_production_v2 를 부른다', async () => {
    const res = await post(base());
    expect(res.status).toBe(200);
    expect(saveCalls().map(([name]) => name)).toEqual(['save_daily_production_v2']);
  });

  it('화면이 본 지문(또는 "기록 없음" null)을 그대로 넘긴다', async () => {
    await post(base({
      night_shift: { actual_production: 50, defect_quantity: 0, operating_minutes: 600 },
      expected_records: { A: STALE_SNAPSHOT, B: null },
    }));
    const params = saveCalls()[0][1] as Record<string, unknown>;
    expect(params.p_expected).toEqual({ A: STALE_SNAPSHOT, B: null });
  });

  it('저장하는 교대마다 비가동 원천 지문을 행보다 먼저 읽어 창과 함께 넘긴다', async () => {
    const order: string[] = [];
    mockRpc.mockImplementation(async (name: string) => {
      order.push(name);
      if (name === 'downtime_window_digest') return { data: 'digest-1', error: null };
      return { data: { ok: true, saved_records: [], deleted_shifts: [] }, error: null };
    });
    mockLoadDowntimeSourceRows.mockImplementation(async () => { order.push('rows'); return []; });

    await post(base());

    expect(order.indexOf('downtime_window_digest')).toBeLessThan(order.indexOf('rows'));
    const params = saveCalls()[0][1] as { p_sources: Record<string, { start: string; end: string; digest: string }> };
    // 2026-07-14 08:00 ~ 20:00 (Asia/Ho_Chi_Minh, UTC+7)
    expect(params.p_sources.A).toEqual({
      start: '2026-07-14T01:00:00.000Z', end: '2026-07-14T13:00:00.000Z', digest: 'digest-1',
    });
    expect(params.p_sources).not.toHaveProperty('B');
  });

  it('저장하거나 휴무로 바꾸는 교대의 expected_records 가 빠지면 400 (낡은 화면을 알 수 없다)', async () => {
    const res = await post(base({ expected_records: undefined }));
    expect(res.status).toBe(400);
    expect(saveCalls()).toHaveLength(0);

    const offWithout = await post(base({ day_shift: undefined, day_shift_off: true, expected_records: {} }));
    expect(offWithout.status).toBe(400);
    expect(saveCalls()).toHaveLength(0);
  });

  it('지문의 record_id 가 문자열이 아니면 400', async () => {
    const res = await post(base({ expected_records: { A: { ...STALE_SNAPSHOT, record_id: 7 } } }));
    expect(res.status).toBe(400);
    expect(saveCalls()).toHaveLength(0);
  });

  it('RPC 가 record_changed 를 돌려주면 409 로 다시 불러오게 한다', async () => {
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'downtime_window_digest') return { data: 'digest-1', error: null };
      return { data: { ok: false, reason: 'record_changed', shift: 'A' }, error: null };
    });
    const res = await post(base({ expected_records: { A: STALE_SNAPSHOT } }));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, error: 'record_changed', shift: 'A' });
  });

  it('RPC 가 source_changed 를 돌려주면 409', async () => {
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'downtime_window_digest') return { data: 'digest-1', error: null };
      return { data: { ok: false, reason: 'source_changed', shift: 'A' }, error: null };
    });
    const res = await post(base());
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ success: false, error: 'source_changed' });
  });

  it('비가동 지문을 읽지 못하면 저장하지 않는다 (500)', async () => {
    mockRpc.mockImplementation(async (name: string) => {
      if (name === 'downtime_window_digest') return { data: null, error: { message: 'boom' } };
      return { data: { ok: true }, error: null };
    });
    const res = await post(base());
    expect(res.status).toBe(500);
    expect(saveCalls()).toHaveLength(0);
  });
});

describe('F-03 가동시간: 0 이상 정수, 설정된 교대 창 길이 이하', () => {
  it.each([
    ['교대 길이 초과(999999)', 999_999],
    ['교대 길이+1', 721],
    ['음수', -1],
    ['소수', 600.5],
    ['문자열', '600'],
    ['NaN 대신 null', null],
  ])('%s 는 400', async (_label, minutes) => {
    const res = await post(base({ day_shift: { actual_production: 100, defect_quantity: 0, operating_minutes: minutes } }));
    expect(res.status).toBe(400);
    expect(saveCalls()).toHaveLength(0);
  });

  it.each([0, 720])('%s 분은 허용', async minutes => {
    const res = await post(base({ day_shift: { actual_production: 100, defect_quantity: 0, operating_minutes: minutes } }));
    expect(res.status).toBe(200);
  });

  it('상한은 720 고정이 아니라 설정의 교대 창이다 (A 07:00~19:30 = 750분, 자정을 넘는 B = 690분)', async () => {
    mockBusinessTime.mockResolvedValue({
      timezone: 'Asia/Ho_Chi_Minh', shiftAStart: '07:00', shiftBStart: '19:30', shiftChangeBufferMinutes: 10,
    });
    const okBoth = await post(base({
      day_shift: { actual_production: 1, defect_quantity: 0, operating_minutes: 750 },
      night_shift: { actual_production: 1, defect_quantity: 0, operating_minutes: 690 },
      expected_records: { A: null, B: null },
    }));
    expect(okBoth.status).toBe(200);

    const nightOver = await post(base({
      day_shift: undefined,
      night_shift: { actual_production: 1, defect_quantity: 0, operating_minutes: 691 },
      expected_records: { B: null },
    }));
    expect(nightOver.status).toBe(400);
  });

  it('휴무 교대의 가동시간은 검사하지 않는다 (저장하지 않으므로)', async () => {
    const res = await post(base({
      day_shift_off: true,
      day_shift: { actual_production: 0, defect_quantity: 0, operating_minutes: 999_999 },
      expected_records: { A: null },
    }));
    expect(res.status).toBe(200);
  });
});
