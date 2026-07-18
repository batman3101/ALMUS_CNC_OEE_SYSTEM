jest.mock('next/server', () => ({
  NextResponse: { json: (b: unknown, i?: { status?: number }) => ({ status: i?.status ?? 200, json: async () => b }) },
}));
const mockRequireUser = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: () => undefined,
  apiAuthErrorResponse: () => null,
}));
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a) } }));
import { GET } from '../route';
const MACHINE = '11111111-1111-4111-8111-111111111111';
const call = (qs: string) => GET({ url: `http://x/api/production-records/pending?${qs}` } as never);

// 마감대기 = 진척 있고 record 없는 교대. production_shift_states(WORKING 수천 행)로 도출하면
// 과거 전체가 뜨므로 쓰지 않는다(리뷰에서 진척 기반으로 재설계).
const gteCalls: Array<[string, unknown]> = [];
const wire = ({ progressed = [{ date: '2026-07-17', shift: 'A' }, { date: '2026-07-17', shift: 'A' }, { date: '2026-07-17', shift: 'B' }],
                records = [{ date: '2026-07-17', shift: 'A', record_id: 'rA', defect_qty: null }] } = {}) => {
  gteCalls.length = 0;
  mockFrom.mockImplementation((t: string) => {
    // 두 소스 모두 machine_id + 날짜 하한(gte)으로 바운드된다(F5 — 비바운드 스캔 방지).
    const gte = (col: string, val: unknown) => { gteCalls.push([col, val]); return Promise.resolve({ data: t === 'production_progress_reports' ? progressed : records, error: null }); };
    if (t === 'production_progress_reports') return { select: () => ({ eq: () => ({ gte }) }) };
    if (t === 'production_records') return { select: () => ({ eq: () => ({ gte }) }) };
    throw new Error(`unexpected ${t}`);
  });
};

describe('GET /api/production-records/pending', () => {
  beforeEach(() => { jest.clearAllMocks(); mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] }); });

  it('진척 있고 record 없는 교대 = 마감대기(중복 제거), defect NULL = 불량대기', async () => {
    wire();
    const res = await call(`machine_id=${MACHINE}`);
    const body = await res.json() as { close_pending: unknown[]; defect_pending: unknown[] };
    // A 는 record 있음 → 마감대기 아님. B 는 진척 있고 record 없음 → 마감대기. A 는 defect null → 불량대기.
    expect(body.close_pending).toEqual([{ date: '2026-07-17', shift: 'B' }]);
    expect(body.defect_pending).toEqual([{ date: '2026-07-17', shift: 'A', record_id: 'rA' }]);
  });

  it('machine_id 없으면 400', async () => {
    const res = await call('');
    expect(res.status).toBe(400);
  });

  // F5(감사): 두 소스 모두 날짜 하한으로 바운드해 비바운드 스캔(PostgREST 10만행 무음 절단)을 막는다.
  it('두 쿼리를 date 하한(gte)으로 바운드한다', async () => {
    wire();
    await call(`machine_id=${MACHINE}`);
    expect(gteCalls.length).toBe(2);
    for (const [col, val] of gteCalls) {
      expect(col).toBe('date');
      expect(val).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
