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
import { PATCH } from '../route';

const REC = 'rec-1';
const wire = ({ record = { record_id: REC, machine_id: 'm1', output_qty: 100, defect_qty: null, availability: 0.9, performance: 0.8 } as Record<string, unknown> | null, update = jest.fn().mockResolvedValue({ error: null }) }: { record?: Record<string, unknown> | null; update?: jest.Mock } = {}) => {
  mockFrom.mockImplementation((t: string) => {
    if (t === 'production_records') return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: record, error: null }) }) }),
      update: (patch: unknown) => ({ eq: async () => { update(patch); return { error: null }; } }),
    };
    throw new Error(`unexpected ${t}`);
  });
  return { update };
};
const req = (b: unknown) => ({ json: async () => b }) as never;
const ctx = { params: Promise.resolve({ recordId: REC }) } as never;

describe('PATCH .../[recordId]/defect', () => {
  beforeEach(() => { jest.clearAllMocks(); mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator' }); });

  it('불량을 넣으면 quality·oee 를 파생 확정한다', async () => {
    const { update } = wire();
    const res = await PATCH(req({ defect_qty: 10 }), ctx);
    expect(res.status).toBe(200);
    // quality = (100-10)/100 = .9 ; oee = .9(avail) * .8(perf) * .9 = .648
    const patch = update.mock.calls[0][0] as { defect_qty: number; quality: number; oee: number };
    expect(patch.defect_qty).toBe(10);
    expect(patch.quality).toBeCloseTo(0.9, 5);
    expect(patch.oee).toBeCloseTo(0.648, 3);
  });

  it('불량 > 생산 이면 400', async () => {
    wire();
    const res = await PATCH(req({ defect_qty: 200 }), ctx);
    expect(res.status).toBe(400);
  });

  it('없는 record 는 404', async () => {
    wire({ record: null });
    const res = await PATCH(req({ defect_qty: 1 }), ctx);
    expect(res.status).toBe(404);
  });
});
