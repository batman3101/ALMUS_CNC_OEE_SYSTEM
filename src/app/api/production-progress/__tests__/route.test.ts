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
const mockGetShiftReportingWindow = jest.fn();

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: (...a: unknown[]) => mockAssertMachineAccess(...a),
  apiAuthErrorResponse: () => null,
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { rpc: (...a: unknown[]) => mockRpc(...a) },
}));

// 창 조회(설정 읽기)만 모킹한다. 판정 규칙(classifyReportingWindow)은 REAL 로 두어
// 경계 판단이 실제로 걸리는지 본다 — 규칙까지 모킹하면 가드가 있는지조차 확인 못 한다.
jest.mock('@/lib/shiftDowntime', () => ({
  getShiftReportingWindow: (...a: unknown[]) => mockGetShiftReportingWindow(...a),
  getShiftWindow: jest.fn(),
  loadDowntimeSourceRows: jest.fn(),
}));

import { POST } from '../route';

const MACHINE = '11111111-1111-4111-8111-111111111111';
const MINUTE = 60_000;

const request = (body: unknown) => ({
  url: 'http://localhost/api/production-progress',
  json: async () => body,
}) as never;

const okBody = { machine_id: MACHINE, date: '2026-07-17', shift: 'A', shift_output_qty: 150 };

/** 지금 진행 중인 교대 창. 기본 상태는 "열려 있음" 이어야 기존 케이스가 그대로 성립한다. */
const openWindow = () => ({
  window: { start: Date.now() - 60 * MINUTE, end: Date.now() + 60 * MINUTE },
  bufferMinutes: 10,
});

describe('POST /api/production-progress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssertMachineAccess.mockReturnValue(undefined);
    mockRpc.mockResolvedValue({ data: { ok: true }, error: null });
    mockGetShiftReportingWindow.mockResolvedValue(openWindow());
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

  // Codex 감사 2026-07-29 #5 — 인자의 (date, shift)를 서버 시각과 대조하지 않아, 담당 설비를
  // 가진 운영자가 임의 과거·미래 교대에 진척을 넣을 수 있었다. 그 값은 마감이 output_qty 로
  // 승격시키므로 과거 실적과 backlog 가 오염된다.
  describe('교대 시간창 가드', () => {
    it('이미 끝난 과거 교대는 400 으로 거부하고 RPC 를 부르지 않는다', async () => {
      mockGetShiftReportingWindow.mockResolvedValue({
        window: { start: Date.now() - 40 * 24 * 60 * MINUTE, end: Date.now() - 39 * 24 * 60 * MINUTE },
        bufferMinutes: 10,
      });

      const res = await POST(request(okBody));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(
        expect.objectContaining({ reason: 'closed' }),
      );
      // 거부는 저장 이전에 일어나야 의미가 있다.
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('아직 시작하지 않은 미래 교대는 400 으로 거부한다', async () => {
      mockGetShiftReportingWindow.mockResolvedValue({
        window: { start: Date.now() + 24 * 60 * MINUTE, end: Date.now() + 36 * 60 * MINUTE },
        bufferMinutes: 10,
      });

      const res = await POST(request(okBody));

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual(
        expect.objectContaining({ reason: 'not_started' }),
      );
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('교대 종료 직후 유예 안이면 여전히 저장한다 (늦은 마지막 보고를 막지 않는다)', async () => {
      mockGetShiftReportingWindow.mockResolvedValue({
        window: { start: Date.now() - 12 * 60 * MINUTE, end: Date.now() - 5 * MINUTE },
        bufferMinutes: 10,
      });

      const res = await POST(request(okBody));

      expect(res.status).toBe(201);
      expect(mockRpc).toHaveBeenCalled();
    });

    it('교대 설정이 유효하지 않으면 500 이고 저장하지 않는다', async () => {
      mockGetShiftReportingWindow.mockResolvedValue(null);

      const res = await POST(request(okBody));

      expect(res.status).toBe(500);
      expect(mockRpc).not.toHaveBeenCalled();
    });
  });

  // 설비 활성 여부는 관리자의 비활성화와 경쟁하므로 라우트가 아니라 RPC 안 잠금 아래에서
  // 판정한다. 라우트는 그 판정을 HTTP 로 옮기기만 한다.
  describe('비활성 설비', () => {
    it('RPC 가 machine_inactive 로 거부하면 409', async () => {
      mockRpc.mockResolvedValue({ data: { ok: false, reason: 'machine_inactive' }, error: null });

      const res = await POST(request(okBody));

      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'machine_inactive' });
    });

    it('RPC 가 machine_not_found 로 거부하면 404', async () => {
      mockRpc.mockResolvedValue({ data: { ok: false, reason: 'machine_not_found' }, error: null });

      const res = await POST(request(okBody));

      expect(res.status).toBe(404);
    });
  });
});
