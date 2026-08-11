/**
 * 목록 API 의 "미검사(NULL) ≠ 불량 0건" 계약.
 *
 * 교대 마감은 생산량만 확정하고 `defect_qty` 를 NULL 로 둔다 — 검사 결과는 다음날 나온다.
 * 이 라우트가 그 NULL 을 0 으로 바꿔 내보내면 브라우저는 두 상태를 **영영 구분할 수 없다**.
 *
 * 그리고 그건 표시만의 문제가 아니었다. 목록의 수정 모달이 받은 값을 그대로 prefill 하므로,
 * 미검사 행에서 생산량만 고쳐 저장해도 `defect_qty: 0` 이 함께 전송되고 서버는 그것을 명시적
 * 0 확정으로 해석해 quality/OEE 까지 계산했다 — 검사하지 않은 교대가 "불량 0건, 품질 100%"로
 * 조용히 확정되는 경로였다(2026-08-11 감사 P0-1).
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

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  assertMachineAccess: jest.fn(),
  apiAuthErrorResponse: () => null,
}));

jest.mock('@/lib/plannedRuntime', () => ({
  getBreakTimeMinutes: jest.fn(async () => 60),
  resolvePlannedRuntime: jest.fn((operating: number, breaks: number) => operating - breaks),
}));

interface Row {
  record_id: string;
  machine_id: string;
  date: string;
  shift: string;
  output_qty: number;
  defect_qty: number | null;
  quality: number | null;
  machines: unknown;
}

let rows: Row[];
/** 이 요청에서 실제로 걸린 NULL 필터. `.eq()` 로는 NULL 을 비교할 수 없다. */
let isFilters: Array<[string, unknown]>;
let notFilters: Array<[string, string, unknown]>;

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ['select', 'order', 'in', 'eq', 'gte', 'lte']) chain[m] = self;
      chain.is = (col: string, val: unknown) => { isFilters.push([col, val]); return chain; };
      chain.not = (col: string, op: string, val: unknown) => {
        notFilters.push([col, op, val]); return chain;
      };
      chain.range = () => Promise.resolve({ data: rows, count: rows.length, error: null });
      return chain;
    },
  },
}));

import { GET } from '../route';

const req = (query: string) =>
  ({ url: `http://localhost/api/production-records?${query}` }) as never;

const body = async (res: unknown) =>
  (res as { json: () => Promise<{ records: Row[]; error?: string }> }).json();

beforeEach(() => {
  jest.clearAllMocks();
  isFilters = [];
  notFilters = [];
  mockRequireUser.mockResolvedValue({ userId: 'a', role: 'admin', assignedMachineIds: [] });
  rows = [
    {
      record_id: 'r-uninspected', machine_id: 'm1', date: '2026-08-10', shift: 'B',
      output_qty: 56, defect_qty: null, quality: null, machines: { id: 'm1', name: 'CNC-683' },
    },
    {
      record_id: 'r-zero', machine_id: 'm1', date: '2026-08-09', shift: 'A',
      output_qty: 40, defect_qty: 0, quality: 1, machines: { id: 'm1', name: 'CNC-683' },
    },
  ];
});

describe('defect_qty NULL 직렬화', () => {
  it('미검사(NULL)를 0 으로 접지 않는다', async () => {
    const { records } = await body(await GET(req('page=1&limit=20')));

    const uninspected = records.find(r => r.record_id === 'r-uninspected');
    expect(uninspected?.defect_qty).toBeNull();
  });

  it('실제 0 건 확정은 0 으로 유지한다 (두 상태가 구분된다)', async () => {
    const { records } = await body(await GET(req('page=1&limit=20')));

    const confirmedZero = records.find(r => r.record_id === 'r-zero');
    expect(confirmedZero?.defect_qty).toBe(0);

    // 같은 응답 안에서 두 상태가 서로 다른 값이어야 한다 — 이게 계약의 핵심이다.
    const uninspected = records.find(r => r.record_id === 'r-uninspected');
    expect(uninspected?.defect_qty).not.toBe(confirmedZero?.defect_qty);
  });
});

describe('defect_status 필터', () => {
  it('pending 은 defect_qty IS NULL 로 건다', async () => {
    await GET(req('defect_status=pending'));

    expect(isFilters).toContainEqual(['defect_qty', null]);
    expect(notFilters).toHaveLength(0);
  });

  it('confirmed 는 defect_qty IS NOT NULL 로 건다', async () => {
    await GET(req('defect_status=confirmed'));

    expect(notFilters).toContainEqual(['defect_qty', 'is', null]);
    expect(isFilters).toHaveLength(0);
  });

  it('필터가 없으면 NULL 조건을 걸지 않는다', async () => {
    await GET(req('page=1'));

    expect(isFilters).toHaveLength(0);
    expect(notFilters).toHaveLength(0);
  });

  it('허용값이 아니면 400 이다 — 오타를 조용히 무시하면 전체가 조회된다', async () => {
    const res = await GET(req('defect_status=whatever')) as unknown as { status: number };

    expect(res.status).toBe(400);
  });

  it('다른 필터·페이지네이션과 함께 동작한다', async () => {
    await GET(req('defect_status=pending&shift=B&page=2&limit=50'));

    expect(isFilters).toContainEqual(['defect_qty', null]);
  });
});
