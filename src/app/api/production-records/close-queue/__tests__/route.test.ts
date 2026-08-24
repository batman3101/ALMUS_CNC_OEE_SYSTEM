/**
 * 전사 교대 마감 대기 큐의 계약.
 *
 * 마감대기 = 진척 보고가 있는 교대 ∖ 확정 record 가 있는 교대. 현장 콘솔의 `pending` 과
 * **같은 정의**를 설비 경계 없이 계산한다. 정의가 갈라지면 콘솔과 큐가 서로 다른 건수를
 * 말하게 된다.
 */

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockRequireUser = jest.fn();
const mockAssertMachineAccess = jest.fn();

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  assertMachineAccess: (...args: unknown[]) => mockAssertMachineAccess(...args),
  apiAuthErrorResponse: (error: unknown) =>
    error instanceof Error && error.message === 'forbidden'
      ? { status: 403, json: async () => ({ error: 'forbidden' }) }
      : null,
}));

/**
 * 이 Route 는 공장 인지 계약(`requireFactoryUser`)으로 전환됐다.
 *
 * 새 mock 을 따로 만들지 않고 **같은 함수**에 연결한다. 그래야 아래 단언들이 검증하던
 * 성질이 그대로 유지된다 — 거부가 조회보다 먼저인가, 허용 역할 목록이 무엇인가.
 * 별도 mock 을 두면 두 벌이 되고, 한쪽만 고쳐지는 순간 검사가 헐거워진다.
 */
jest.mock('@/lib/factoryAuth', () => ({
  requireFactoryUser: (...args: unknown[]) => mockRequireUser(...args),
  assertFactoryMachineAccess: (...args: unknown[]) => mockAssertMachineAccess(...args),
}));


interface ProgressRow { machine_id: string; date: string; shift: string; shift_output_qty: number }
interface RecordRow { machine_id: string; date: string; shift: string }

let progressRows: ProgressRow[];
let recordRows: RecordRow[];
let machineRows: Array<{ id: string; name: string }>;

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const data =
        table === 'production_progress_reports' ? progressRows
          : table === 'production_records' ? recordRows
            : machineRows;
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ['select', 'eq', 'gte', 'lte', 'in']) chain[m] = self;
      chain.limit = () => Promise.resolve({ data, error: null });
      // machines 조회는 .in() 에서 끝난다 — thenable 로 만들어 await 를 받는다.
      chain.then = (resolve: (v: unknown) => unknown) => resolve({ data, error: null });
      return chain;
    },
  },
}));

import { GET } from '../route';

const req = (query = '') =>
  ({ url: `http://localhost/api/production-records/close-queue?${query}` }) as never;

const body = async (res: unknown) => (res as {
  json: () => Promise<{
    items: Array<{ machine_id: string; date: string; shift: string; last_qty: number | null; machine_name: string }>;
    pagination: { total: number };
    truncated: boolean;
    error?: string;
  }>;
}).json();

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireUser.mockResolvedValue({ userId: 'a', role: 'admin', assignedMachineIds: [] });
  machineRows = [{ id: 'm1', name: 'CNC-001' }, { id: 'm2', name: 'CNC-002' }];
  progressRows = [
    { machine_id: 'm1', date: '2026-08-10', shift: 'B', shift_output_qty: 40 },
    { machine_id: 'm1', date: '2026-08-10', shift: 'B', shift_output_qty: 56 },
    { machine_id: 'm2', date: '2026-08-10', shift: 'A', shift_output_qty: 12 },
  ];
  recordRows = [];
});

describe('마감 대기 도출', () => {
  it('확정 record 가 없는 교대만 대기로 낸다', async () => {
    recordRows = [{ machine_id: 'm2', date: '2026-08-10', shift: 'A' }];

    const { items, pagination } = await body(await GET(req()));

    expect(pagination.total).toBe(1);
    expect(items[0]).toMatchObject({ machine_id: 'm1', date: '2026-08-10', shift: 'B' });
  });

  it('교대의 마지막(최대) 진척값을 prefill 로 싣는다', async () => {
    const { items } = await body(await GET(req()));

    const m1 = items.find(i => i.machine_id === 'm1');
    expect(m1?.last_qty).toBe(56);
  });

  it('설비명을 함께 실어 표에서 설비를 바꿔 가며 찾지 않아도 되게 한다', async () => {
    const { items } = await body(await GET(req()));

    expect(items.every(i => i.machine_name !== 'Unknown')).toBe(true);
  });

  it('오래된 교대를 먼저 낸다 (안정 전순서)', async () => {
    progressRows = [
      { machine_id: 'm1', date: '2026-08-10', shift: 'B', shift_output_qty: 5 },
      { machine_id: 'm2', date: '2026-08-09', shift: 'A', shift_output_qty: 5 },
    ];

    const { items } = await body(await GET(req()));

    expect(items.map(i => i.date)).toEqual(['2026-08-09', '2026-08-10']);
  });
});

describe('입력 검증', () => {
  it('허용 범위를 넘는 날짜 창은 400 이다 (무한 스캔 방지)', async () => {
    const res = await GET(req('startDate=2020-01-01&endDate=2026-08-11')) as unknown as { status: number };

    expect(res.status).toBe(400);
  });

  it('잘못된 shift 는 400 이다', async () => {
    const res = await GET(req('shift=C')) as unknown as { status: number };

    expect(res.status).toBe(400);
  });

  it('startDate 가 endDate 보다 뒤면 400 이다', async () => {
    const res = await GET(req('startDate=2026-08-10&endDate=2026-08-01')) as unknown as { status: number };

    expect(res.status).toBe(400);
  });
});

describe('권한', () => {
  it('배정되지 않은 설비를 지정하면 거부한다', async () => {
    mockAssertMachineAccess.mockImplementation(() => { throw new Error('forbidden'); });

    const res = await GET(
      req('machine_id=00000000-0000-4000-8000-000000000001')
    ) as unknown as { status: number };

    expect(res.status).toBe(403);
  });

  it('담당 설비가 없는 운영자에게는 빈 큐를 준다 (전사 조회로 새지 않는다)', async () => {
    mockRequireUser.mockResolvedValue({ userId: 'o', role: 'operator', assignedMachineIds: [] });

    const { items, pagination } = await body(await GET(req()));

    expect(items).toHaveLength(0);
    expect(pagination.total).toBe(0);
  });
});
