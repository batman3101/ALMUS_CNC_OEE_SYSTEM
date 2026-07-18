jest.mock('next/server', () => ({
  NextResponse: { json: (b: unknown, i?: { status?: number }) => ({ status: i?.status ?? 200, json: async () => b }) },
}));
const mockRequireUser = jest.fn();
const mockAssert = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: (...a: unknown[]) => mockAssert(...a),
  apiAuthErrorResponse: () => null,
}));
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
// 라우트가 업무일자 계산에 쓰는 의존성(RPC 인자 p_date). 라우트 로직만 검증하므로 고정 mock.
jest.mock('@/lib/shiftConfig', () => ({ getBusinessTimeConfig: async () => ({ timezone: 'Asia/Ho_Chi_Minh', shiftAStart: '08:00', shiftBStart: '20:00' }) }));
jest.mock('@/utils/downtimeIntervals', () => ({ getBusinessDateAt: () => '2026-07-18' }));
import { POST } from '../route';
const MACHINE = '11111111-1111-4111-8111-111111111111';
const req = (b: unknown) => ({ json: async () => b }) as never;
const ctx = { params: Promise.resolve({ machineId: MACHINE }) } as never;

describe('POST .../[machineId]/downtime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssert.mockReturnValue(undefined);
    mockRpc.mockResolvedValue({ data: { ok: true, state: 'INSPECTION' }, error: null });
  });

  it('start + reason 을 RPC 로 전달 (p_date 포함)', async () => {
    const res = await POST(req({ action: 'start', reason: 'INSPECTION' }), ctx);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('toggle_machine_downtime', expect.objectContaining({
      p_machine_id: MACHINE, p_action: 'start', p_reason: 'INSPECTION', p_date: '2026-07-18', p_operator_id: 'op-1',
    }));
  });

  it('resume 를 RPC 로 전달', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, state: 'NORMAL_OPERATION' }, error: null });
    const res = await POST(req({ action: 'resume' }), ctx);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('toggle_machine_downtime', expect.objectContaining({ p_action: 'resume' }));
  });

  it('잘못된 action 은 400 (RPC 호출 안 함)', async () => {
    const res = await POST(req({ action: 'bogus' }), ctx);
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('start 인데 유효하지 않은 사유는 400 (enum 캐스트 실패 방지)', async () => {
    const res = await POST(req({ action: 'start', reason: 'NOT_A_STATE' }), ctx);
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('담당이 아닌 설비는 거부', async () => {
    mockAssert.mockImplementation(() => { throw new Error('forbidden'); });
    await expect(POST(req({ action: 'resume' }), ctx)).rejects.toThrow();
  });
});
