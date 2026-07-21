jest.mock('next/server', () => ({
  NextResponse: { json: (b: unknown, i?: { status?: number }) => ({ status: i?.status ?? 200, json: async () => b }) },
}));
const mockRequireUser = jest.fn();
const mockAssert = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: (...a: unknown[]) => mockAssert(...a),
  apiAuthErrorResponse: () => null,
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a), rpc: (...a: unknown[]) => mockRpc(...a) },
}));
import { PATCH } from '../route';

const REC = 'rec-1';
// 검증·quality/oee 파생은 confirm_shift_defect RPC(advisory lock, 재마감과 동일 키)가 한다.
// 라우트는 담당설비 검사(선행 읽기) + RPC 위임 + 사유→HTTP 매핑만 담당한다.
const wire = ({ record = { record_id: REC, machine_id: 'm1' } as Record<string, unknown> | null,
                rpc = { data: { ok: true, quality: 0.9, oee: 0.648 }, error: null } as { data: unknown; error: unknown } } = {}) => {
  mockFrom.mockImplementation((t: string) => {
    if (t === 'production_records') return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: record, error: null }) }) }),
    };
    throw new Error(`unexpected ${t}`);
  });
  mockRpc.mockResolvedValue(rpc);
};
const req = (b: unknown) => ({ json: async () => b }) as never;
const ctx = { params: Promise.resolve({ recordId: REC }) } as never;

describe('PATCH .../[recordId]/defect', () => {
  beforeEach(() => { jest.clearAllMocks(); mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator' }); mockAssert.mockReturnValue(undefined); });

  it('불량을 RPC(confirm_shift_defect)로 위임해 확정한다', async () => {
    wire();
    const res = await PATCH(req({ defect_qty: 10 }), ctx);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('confirm_shift_defect', { p_record_id: REC, p_defect: 10 });
  });

  it('RPC 가 exceeds_output 을 돌려주면 400', async () => {
    wire({ rpc: { data: { ok: false, reason: 'exceeds_output', output_qty: 100 }, error: null } });
    const res = await PATCH(req({ defect_qty: 200 }), ctx);
    expect(res.status).toBe(400);
  });

  it('없는 record 는 404 (선행 읽기)', async () => {
    wire({ record: null });
    const res = await PATCH(req({ defect_qty: 1 }), ctx);
    expect(res.status).toBe(404);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('RPC 가 not_found 를 돌려줘도 404 (경쟁 삭제 방어)', async () => {
    wire({ rpc: { data: { ok: false, reason: 'not_found' }, error: null } });
    const res = await PATCH(req({ defect_qty: 1 }), ctx);
    expect(res.status).toBe(404);
  });

  // F1(감사): record_id 만으로 남의 설비 실적을 조작하지 못하게 담당 설비 검사를 건다(IDOR 방지).
  it('record 의 machine_id 로 담당 설비 검사를 호출한다', async () => {
    wire();
    await PATCH(req({ defect_qty: 5 }), ctx);
    expect(mockAssert).toHaveBeenCalledWith(expect.objectContaining({ userId: 'op-1' }), 'm1');
  });

  it('담당이 아닌 설비의 record 는 RPC 호출 없이 거부한다', async () => {
    wire();
    mockAssert.mockImplementation(() => { throw new Error('forbidden'); });
    await expect(PATCH(req({ defect_qty: 5 }), ctx)).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
