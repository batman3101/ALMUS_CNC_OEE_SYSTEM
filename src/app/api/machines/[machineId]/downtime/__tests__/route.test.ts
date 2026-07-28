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
// getBusinessDateAt 만 POST 테스트용으로 고정하고, 나머지 실제 구간 유틸(clipInterval 등)은
// 그대로 둔다 — GET 이 부르는 calculateVerifiedDowntimeMinutesForWindow·buildDowntimeBreakdown
// 은 실제 구현으로 검증해야 하는데, 전체 모듈을 대체하면 그 함수들이 undefined 가 된다.
jest.mock('@/utils/downtimeIntervals', () => ({
  ...jest.requireActual('@/utils/downtimeIntervals'),
  getBusinessDateAt: () => '2026-07-18',
}));
const mockLoadDetail = jest.fn();
const mockGetShiftWindow = jest.fn();
const mockGetBreakMinutes = jest.fn();
jest.mock('@/lib/shiftDowntime', () => ({
  loadDowntimeDetailRows: (...a: unknown[]) => mockLoadDetail(...a),
  getShiftWindow: (...a: unknown[]) => mockGetShiftWindow(...a),
}));
jest.mock('@/lib/plannedRuntime', () => ({
  getBreakTimeMinutes: (...a: unknown[]) => mockGetBreakMinutes(...a),
}));
import { GET, PATCH, POST } from '../route';
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

describe('GET .../[machineId]/downtime', () => {
  const WINDOW = {
    start: Date.parse('2026-07-28T01:00:00.000Z'),
    end: Date.parse('2026-07-28T13:00:00.000Z'),
  };
  const getReq = (qs: string) =>
    ({ url: `http://localhost/api/machines/${MACHINE}/downtime?${qs}` }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssert.mockReturnValue(undefined);
    mockGetShiftWindow.mockResolvedValue(WINDOW);
    mockGetBreakMinutes.mockResolvedValue(60);
    mockLoadDetail.mockResolvedValue([]);
  });

  it('date·shift 가 없으면 400 (조회하지 않음)', async () => {
    const res = await GET(getReq('date=2026-07-28'), ctx);
    expect(res.status).toBe(400);
    expect(mockLoadDetail).not.toHaveBeenCalled();
  });

  it('잘못된 date 형식은 400', async () => {
    const res = await GET(getReq('date=07-28-2026&shift=A'), ctx);
    expect(res.status).toBe(400);
  });

  it('담당 설비가 아니면 403 (assertMachineAccess 가 던진다)', async () => {
    mockAssert.mockImplementation(() => { throw new Error('forbidden'); });
    await expect(GET(getReq('date=2026-07-28&shift=A'), ctx)).rejects.toThrow();
  });

  it('교대 창과 누적·건별 목록을 함께 돌려준다', async () => {
    mockLoadDetail.mockResolvedValue([
      {
        id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
        start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:30:00.000Z',
        is_planned: false,
      },
      {
        id: 'ml-1', source: 'machine_log', reason: 'INSPECTION',
        start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:30:00.000Z',
        is_planned: false,
      },
    ]);
    const res = await GET(getReq('date=2026-07-28&shift=A'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shift_start).toBe('2026-07-28T01:00:00.000Z');
    expect(body.shift_end).toBe('2026-07-28T13:00:00.000Z');
    expect(body.total_minutes).toBe(30);
    expect(body.ongoing_since).toBeNull();
    // andon 이중 기록은 1행으로 접힌다
    expect(body.intervals).toHaveLength(1);
    expect(body.intervals[0]).toMatchObject({ id: 'de-1', reason: 'INSPECTION', minutes: 30 });
  });

  it('진행 중 비가동의 ongoing_since 는 교대 시작으로 클립되지 않은 원본 시각이다', async () => {
    // 이전 교대(00:30)에 시작해 아직 진행 중. 목록의 start 는 교대 시작(01:00)으로 클립되지만
    // 경과 시간은 실제 시작부터 재야 하므로 ongoing_since 는 원본을 준다.
    mockLoadDetail.mockResolvedValue([
      {
        id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
        start_time: '2026-07-28T00:30:00.000Z', end_time: null, is_planned: false,
      },
    ]);
    const res = await GET(getReq('date=2026-07-28&shift=A'), ctx);
    const body = await res.json();
    expect(body.ongoing_since).toBe('2026-07-28T00:30:00.000Z');
    expect(body.intervals[0].start).toBe('2026-07-28T01:00:00.000Z');
    expect(body.intervals[0].clipped_start).toBe(true);
  });

  it('열린 행이 둘이면(andon 이중 기록) 가장 이른 시작을 쓴다', async () => {
    mockLoadDetail.mockResolvedValue([
      {
        id: 'ml-1', source: 'machine_log', reason: 'INSPECTION',
        start_time: '2026-07-28T06:00:05.000Z', end_time: null, is_planned: false,
      },
      {
        id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
        start_time: '2026-07-28T06:00:00.000Z', end_time: null, is_planned: false,
      },
    ]);
    const res = await GET(getReq('date=2026-07-28&shift=A'), ctx);
    const body = await res.json();
    expect(body.ongoing_since).toBe('2026-07-28T06:00:00.000Z');
  });

  it('계획정지가 휴식과 겹치면 total_minutes 는 null 이지만 목록은 그대로 준다', async () => {
    mockLoadDetail.mockResolvedValue([
      {
        id: 'de-1', source: 'downtime_entry', reason: 'PLANNED_STOP',
        start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:30:00.000Z',
        is_planned: true,
      },
    ]);
    const res = await GET(getReq('date=2026-07-28&shift=A'), ctx);
    const body = await res.json();
    expect(body.total_minutes).toBeNull();
    expect(body.intervals).toHaveLength(1);
  });

  it('비가동이 없으면 total_minutes 는 0 이고 목록은 빈 배열', async () => {
    const res = await GET(getReq('date=2026-07-28&shift=A'), ctx);
    const body = await res.json();
    expect(body.total_minutes).toBe(0);
    expect(body.intervals).toEqual([]);
  });

  it('교대 설정이 유효하지 않으면 500', async () => {
    mockGetShiftWindow.mockResolvedValue(null);
    const res = await GET(getReq('date=2026-07-28&shift=A'), ctx);
    expect(res.status).toBe(500);
  });
});

describe('PATCH .../[machineId]/downtime (사유 정정)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssert.mockReturnValue(undefined);
    mockRpc.mockResolvedValue({ data: { ok: true, state: 'BREAKDOWN_REPAIR' }, error: null });
  });

  it('사유를 정정 RPC 로 전달한다', async () => {
    const res = await PATCH(req({ reason: 'BREAKDOWN_REPAIR' }), ctx);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('correct_open_downtime_reason', {
      p_machine_id: MACHINE, p_reason: 'BREAKDOWN_REPAIR', p_operator_id: 'op-1',
    });
  });

  it('유효하지 않은 사유는 400 (RPC 호출 안 함)', async () => {
    const res = await PATCH(req({ reason: 'NOT_A_STATE' }), ctx);
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('NORMAL_OPERATION 은 정정 사유가 될 수 없다', async () => {
    const res = await PATCH(req({ reason: 'NORMAL_OPERATION' }), ctx);
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('가동 중이면 409 로 되묻는다', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, reason: 'not_in_downtime' }, error: null });
    const res = await PATCH(req({ reason: 'INSPECTION' }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('not_in_downtime');
  });

  it('RPC 오류는 500', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const res = await PATCH(req({ reason: 'INSPECTION' }), ctx);
    expect(res.status).toBe(500);
  });
});
