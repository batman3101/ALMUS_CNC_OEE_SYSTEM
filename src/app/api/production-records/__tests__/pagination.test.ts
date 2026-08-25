/**
 * 생산 기록 목록의 페이지네이션 계약.
 *
 * 이 라우트는 두 경로를 가진다.
 *
 *   청크 1개(관리자·엔지니어·설비 지정) → DB 가 그 페이지만 잘라 준다
 *   청크 여럿(운영자 담당 설비 800대)   → 앞에서부터 누적으로 받아 병합 후 잘라낸다
 *
 * 누적 조회는 청크가 여럿일 때 **정확성의 조건**이다 — 어느 청크가 N페이지에 얼마나
 * 기여하는지는 앞에서부터 읽어야만 알 수 있다. 반대로 청크가 하나면 누적은 순수한 낭비이고,
 * `page*limit` 이 PostgREST 의 max-rows(100,000)를 넘는 순간 뒷 페이지가 **조용히 빈다**.
 *
 * 두 경로가 자르기를 **한 번씩만** 적용하는 것이 이 파일이 지키는 계약이다.
 * 잘못 손대면 두 번 잘려서 2페이지부터 빈 배열이 되는데, 그건 오류 없이 조용히 일어난다.
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

/**
 * 이 Route 는 공장 인지 계약(`requireFactoryUser`)으로 전환됐다.
 *
 * 새 mock 을 따로 만들지 않고 **같은 함수**에 연결한다. 그래야 아래 단언들이 검증하던
 * 성질이 그대로 유지된다 — 거부가 조회보다 먼저인가, 허용 역할 목록이 무엇인가.
 * 별도 mock 을 두면 두 벌이 되고, 한쪽만 고쳐지는 순간 검사가 헐거워진다.
 */
jest.mock('@/lib/factoryAuth', () => ({
  requireFactoryUser: (...args: unknown[]) => mockRequireUser(...args),
}));


jest.mock('@/lib/plannedRuntime', () => ({
  getBreakTimeMinutes: jest.fn(async () => 60),
  resolvePlannedRuntime: jest.fn((operating: number, breaks: number) => operating - breaks),
}));

interface Row { record_id: string; machine_id: string; date: string; machines: unknown }

/** 각 청크 요청이 실제로 요구한 범위. */
let requestedRanges: Array<[number, number]>;
/** 청크별로 돌려줄 행. 요청한 range 를 그대로 반영해 DB 처럼 잘라 준다. */
let chunkRows: Row[][];
let chunkIndex: number;

const makeRow = (n: number): Row => ({
  record_id: `r${String(n).padStart(4, '0')}`,
  machine_id: `m${n % 3}`,
  date: `2026-08-${String(1 + (n % 28)).padStart(2, '0')}`,
  machines: { id: `m${n % 3}`, name: `CNC-${n}`, location: 'A' },
});

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => {
      const rows = chunkRows[chunkIndex] ?? [];
      chunkIndex += 1;
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ['select', 'order', 'in', 'eq', 'gte', 'lte']) chain[m] = self;
      chain.range = (from: number, to: number) => {
        requestedRanges.push([from, to]);
        // DB 가 하는 일을 그대로 흉내낸다 — 요청한 구간만 돌려준다.
        return Promise.resolve({ data: rows.slice(from, to + 1), count: rows.length, error: null });
      };
      return chain;
    },
  },
}));

import { GET } from '../route';

const req = (query: string) =>
  ({ url: `http://localhost/api/production-records?${query}` }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  requestedRanges = [];
  chunkIndex = 0;
});

describe('청크가 하나일 때 (관리자·엔지니어)', () => {
  beforeEach(() => {
    mockRequireUser.mockResolvedValue({ userId: 'a', role: 'admin', assignedMachineIds: [] });
    chunkRows = [Array.from({ length: 250 }, (_, i) => makeRow(i))];
  });

  it('요청한 페이지 구간만 DB 에 요구한다', async () => {
    await GET(req('page=3&limit=50'));

    // 0 부터 누적으로 받지 않는다.
    expect(requestedRanges).toEqual([[100, 149]]);
  });

  it('DB 가 이미 잘라 준 결과를 다시 자르지 않는다', async () => {
    const response = await GET(req('page=3&limit=50')) as unknown as {
      json: () => Promise<{ records: Array<{ record_id: string }> }>;
    };
    const body = await response.json();

    expect(body.records).toHaveLength(50);
    // 3페이지의 첫 행 = 전체에서 101번째
    expect(body.records[0].record_id).toBe('r0100');
  });

  it('깊은 페이지에서도 전송량이 페이지 크기에 머문다', async () => {
    await GET(req('page=100&limit=100'));

    const [from, to] = requestedRanges[0];
    expect(to - from + 1).toBe(100);
  });
});

describe('청크가 여럿일 때 (운영자 담당 설비 다수)', () => {
  beforeEach(() => {
    // idFilter 가 실제로 쪼갤 만큼 많은 설비를 준다.
    const assigned = Array.from({ length: 1500 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);
    mockRequireUser.mockResolvedValue({ userId: 'o', role: 'operator', assignedMachineIds: assigned });
    chunkRows = [
      Array.from({ length: 120 }, (_, i) => makeRow(i * 2)),
      Array.from({ length: 120 }, (_, i) => makeRow(i * 2 + 1)),
    ];
  });

  it('병합이 필요하므로 앞에서부터 누적으로 받는다', async () => {
    await GET(req('page=2&limit=50'));

    expect(requestedRanges.length).toBeGreaterThan(1);
    for (const [from, to] of requestedRanges) {
      expect(from).toBe(0);
      expect(to).toBe(99); // page*limit - 1
    }
  });

  it('병합 결과에서 그 페이지만 잘라 돌려준다', async () => {
    const response = await GET(req('page=2&limit=50')) as unknown as {
      json: () => Promise<{ records: unknown[]; pagination: { total: number } }>;
    };
    const body = await response.json();

    expect(body.records).toHaveLength(50);
    // 전체 건수는 청크별 count 의 합 (청크는 machine_id 로 서로소라 중복이 없다)
    expect(body.pagination.total).toBe(240);
  });
});
