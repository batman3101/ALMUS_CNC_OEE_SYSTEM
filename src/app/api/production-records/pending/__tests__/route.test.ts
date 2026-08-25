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

/**
 * 이 Route 는 공장 인지 계약(`requireFactoryUser`)으로 전환됐다.
 *
 * 새 mock 을 따로 만들지 않고 **같은 함수**에 연결한다. 그래야 아래 단언들이 검증하던
 * 성질이 그대로 유지된다 — 거부가 조회보다 먼저인가, 허용 역할 목록이 무엇인가.
 */
jest.mock('@/lib/factoryAuth', () => ({
  requireFactoryUser: (...a: unknown[]) => mockRequireUser(...a),
  assertFactoryMachineAccess: () => undefined,
}));

jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a) } }));
import { GET } from '../route';
const MACHINE = '11111111-1111-4111-8111-111111111111';
const call = (qs: string) => GET({ url: `http://x/api/production-records/pending?${qs}` } as never);

// 마감대기 = 진척 있고 record 없는 교대. production_shift_states(WORKING 수천 행)로 도출하면
// 과거 전체가 뜨므로 쓰지 않는다(리뷰에서 진척 기반으로 재설계).
const gteCalls: Array<[string, unknown]> = [];
const eqCalls: Array<[string, unknown]> = [];
const wire = ({ progressed = [
                  { date: '2026-07-17', shift: 'A', shift_output_qty: 40 },
                  { date: '2026-07-17', shift: 'A', shift_output_qty: 90 },
                  { date: '2026-07-17', shift: 'B', shift_output_qty: 30 },
                  { date: '2026-07-17', shift: 'B', shift_output_qty: 75 },
                ],
                records = [{ date: '2026-07-17', shift: 'A', record_id: 'rA', defect_qty: null }] } = {}) => {
  gteCalls.length = 0;
  eqCalls.length = 0;
  mockFrom.mockImplementation((t: string) => {
    if (t !== 'production_progress_reports' && t !== 'production_records') {
      throw new Error(`unexpected ${t}`);
    }
    const rows = t === 'production_progress_reports' ? progressed : records;
    // 두 소스 모두 machine_id + 날짜 하한(gte)으로 바운드된다(F5 — 비바운드 스캔 방지).
    //
    // 필터 메서드는 **자신을 돌려준다.** 예전 mock 은 `select→eq→gte` 깊이를 그대로 박아
    // 놔서, 공장 조건이 하나 붙자 검사 내용과 무관한 이유로 전부 깨졌다. 실제 PostgREST
    // 빌더는 필터를 몇 개 붙여도 같은 객체를 돌려주고 await 로 종단되므로 그 형태를 쓴다.
    const q: Record<string, unknown> = {};
    q.select = () => q;
    q.eq = (col: string, val: unknown) => { eqCalls.push([col, val]); return q; };
    q.gte = (col: string, val: unknown) => { gteCalls.push([col, val]); return q; };
    q.then = (resolve: (v: unknown) => unknown) => resolve({ data: rows, error: null });
    return q;
  });
};

describe('GET /api/production-records/pending', () => {
  beforeEach(() => { jest.clearAllMocks(); mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] }); });

  it('진척 있고 record 없는 교대 = 마감대기(중복 제거), defect NULL = 불량대기', async () => {
    wire();
    const res = await call(`machine_id=${MACHINE}`);
    const body = await res.json() as { close_pending: unknown[]; defect_pending: unknown[] };
    // A 는 record 있음 → 마감대기 아님. B 는 진척 있고 record 없음 → 마감대기. A 는 defect null → 불량대기.
    // last_qty = 그 교대 진척의 최댓값(단조증가라 마지막값) — 마감 prefill 용(Codex 감사 #5).
    expect(body.close_pending).toEqual([{ date: '2026-07-17', shift: 'B', last_qty: 75 }]);
    expect(body.defect_pending).toEqual([{ date: '2026-07-17', shift: 'A', record_id: 'rA' }]);
  });

  it('두 쿼리 모두 공장으로 좁힌다', async () => {
    // 설비 담당 검사(assertFactoryMachineAccess)만으로는 부족하다 — admin/engineer 에게는
    // 담당 설비 제한이 없으므로, 공장 조건이 없으면 남의 공장 설비 id 로 조회가 통한다.
    wire();
    await call(`machine_id=${MACHINE}`);
    const factoryFilters = eqCalls.filter(([col]) => col === 'factory_id');
    expect(factoryFilters.length).toBe(2);
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
