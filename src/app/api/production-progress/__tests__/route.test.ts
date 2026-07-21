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
const mockRpc = jest.fn();

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: (...a: unknown[]) => mockAssertMachineAccess(...a),
  apiAuthErrorResponse: () => null,
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { rpc: (...a: unknown[]) => mockRpc(...a) },
}));

import { POST } from '../route';

const MACHINE = '11111111-1111-4111-8111-111111111111';

const request = (body: unknown) => ({
  url: 'http://localhost/api/production-progress',
  json: async () => body,
}) as never;

const okBody = { machine_id: MACHINE, date: '2026-07-17', shift: 'A', shift_output_qty: 150 };

describe('POST /api/production-progress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssertMachineAccess.mockReturnValue(undefined);
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
  });

  // 저장·검사·감소·비가동은 이제 하나의 원자 RPC(report_shift_progress) 안에서 처리된다.
  // 이 테스트는 API 가 그 RPC 를 올바른 인자로 부르고, 결과를 올바른 HTTP 로 매핑하는지 본다.
  it('원자 RPC 를 올바른 인자로 부르고 저장하면 201', async () => {
    const res = await POST(request(okBody));

    expect(res.status).toBe(201);
    expect(mockRpc).toHaveBeenCalledWith('report_shift_progress', expect.objectContaining({
      p_machine_id: MACHINE, p_date: '2026-07-17', p_shift: 'A',
      p_qty: 150, p_operator_id: 'op-1',
    }));
    // 인가는 "호출됨"으로 부족하다 — 요청 본문 설비와 인증 사용자로 물었는지 인자까지 고정한다.
    expect(mockAssertMachineAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'op-1' }),
      MACHINE,
    );
  });

  // 값의 의미가 "교대 누적"이므로 감소는 불가능하다. RPC 가 현재 최댓값과 함께 거부하면,
  // API 는 last_reported_qty 를 실어 409 로 되묻는다 (모달이 일반 실패가 아닌 감소 안내를 띄우게).
  it('RPC 가 감소를 거부하면 409 + last_reported_qty', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, reason: 'decreased', last_reported_qty: 150 }, error: null });

    const res = await POST(request({ ...okBody, shift_output_qty: 60 }));

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; last_reported_qty: number };
    expect(body.error).toBe('shift_output_qty decreased');
    expect(body.last_reported_qty).toBe(150);
  });

  // 비가동 판단은 machine_logs + downtime_entries 두 소스를 RPC 안에서 원자적으로 본다.
  it('RPC 가 비가동으로 거부하면 409 machine_in_downtime', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, reason: 'machine_in_downtime', state: 'BREAKDOWN_REPAIR' }, error: null });

    const res = await POST(request(okBody));

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string; state: string };
    expect(body.error).toBe('machine_in_downtime');
    expect(body.state).toBe('BREAKDOWN_REPAIR');
  });

  it('같은 값 재보고 등 RPC 가 ok 면 201', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    const res = await POST(request({ ...okBody, shift_output_qty: 150 }));
    expect(res.status).toBe(201);
  });

  it('담당이 아닌 설비는 RPC 이전에 거부한다', async () => {
    mockAssertMachineAccess.mockImplementation(() => { throw new Error('forbidden'); });

    await expect(POST(request(okBody))).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('음수는 400 으로 거부한다 (RPC 호출 안 함)', async () => {
    const res = await POST(request({ ...okBody, shift_output_qty: -1 }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('RPC 오류는 500', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const res = await POST(request(okBody));
    expect(res.status).toBe(500);
  });
});
