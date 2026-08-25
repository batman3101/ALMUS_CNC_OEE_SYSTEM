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

/**
 * 이 Route 는 공장 인지 계약(`requireFactoryUser`)으로 전환됐다.
 *
 * 새 mock 을 따로 만들지 않고 **같은 함수**에 연결한다. 그래야 아래 단언들이 검증하던
 * 성질이 그대로 유지된다 — 거부가 조회보다 먼저인가, 허용 역할 목록이 무엇인가.
 */
jest.mock('@/lib/factoryAuth', () => ({
  requireFactoryUser: (...a: unknown[]) => mockRequireUser(...a),
  assertFactoryMachineAccess: (...a: unknown[]) => mockAssert(...a),
}));

/**
 * 이제 이 라우트는 andon RPC 앞에서 **공장 소유 확인**을 한다(`assertMachineInFactory`).
 * 그 확인은 `machines` 를 읽으므로 mock 에 `from` 이 필요하다 — 없으면 라우트가
 * "from is not a function" 으로 죽고, 이 파일이 검증하려는 비가동 계산에 닿지도 못한다.
 *
 * `ownedRow` 를 null 로 두면 "이 공장 설비가 아니다"를 흉내낼 수 있다.
 */
// MACHINE 상수는 아래에서 선언되므로 여기서 참조하면 TDZ 다. 값은 존재 여부만 쓰인다.
const ownedRow: { id: string } | null = { id: 'owned' };

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    rpc: (...a: unknown[]) => mockRpc(...a),
    from: () => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.eq = () => q;
      q.maybeSingle = async () => ({ data: ownedRow, error: null });
      return q;
    },
  },
}));
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
const mockGetBusinessDayWindow = jest.fn();
const mockGetBreakMinutes = jest.fn();
jest.mock('@/lib/shiftDowntime', () => ({
  loadDowntimeDetailRows: (...a: unknown[]) => mockLoadDetail(...a),
  getShiftWindow: (...a: unknown[]) => mockGetShiftWindow(...a),
  getBusinessDayWindow: (...a: unknown[]) => mockGetBusinessDayWindow(...a),
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
  // 업무일 창(A교대 시작 ~ 다음날 A교대 시작 직전)과 그 안의 day(A)/night(B) 소계 창.
  // buildBusinessRange 와 buildShiftWindows 가 실제로 만들어낼 값과 같은 경계를 쓴다.
  const DAY_WINDOW = {
    start: Date.parse('2026-07-28T01:00:00.000Z'),
    end: Date.parse('2026-07-28T13:00:00.000Z'),
  };
  const NIGHT_WINDOW = {
    start: Date.parse('2026-07-28T13:00:00.000Z'),
    end: Date.parse('2026-07-29T01:00:00.000Z'),
  };
  const BUSINESS_WINDOW = { start: DAY_WINDOW.start, end: NIGHT_WINDOW.end };

  const getReq = (qs: string) =>
    ({ url: `http://localhost/api/machines/${MACHINE}/downtime?${qs}` }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssert.mockReturnValue(undefined);
    mockGetBusinessDayWindow.mockResolvedValue(BUSINESS_WINDOW);
    mockGetShiftWindow.mockImplementation((_date: string, shift: 'A' | 'B') =>
      Promise.resolve(shift === 'A' ? DAY_WINDOW : NIGHT_WINDOW));
    mockGetBreakMinutes.mockResolvedValue(60);
    mockLoadDetail.mockResolvedValue([]);
  });

  it('date 가 없으면 400 (조회하지 않음)', async () => {
    const res = await GET(getReq(''), ctx);
    expect(res.status).toBe(400);
    expect(mockLoadDetail).not.toHaveBeenCalled();
  });

  it('잘못된 date 형식은 400', async () => {
    const res = await GET(getReq('date=07-28-2026'), ctx);
    expect(res.status).toBe(400);
  });

  // 모양만 보면 통과하지만 달력에 없는 날짜다. dayjs 는 이를 조용히 보정하므로
  // (2026-02-31 → 2026-03-03) 막지 않으면 **다른 날의 비가동**이 200 으로 돌아온다.
  it.each(['2026-02-31', '2026-13-01', '2026-00-10', '2025-02-29'])(
    '달력에 없는 날짜(%s)는 400 — 조회하지 않는다',
    async (badDate) => {
      const res = await GET(getReq(`date=${badDate}`), ctx);
      expect(res.status).toBe(400);
      expect(mockLoadDetail).not.toHaveBeenCalled();
    }
  );

  it('윤년의 2월 29일은 유효하다', async () => {
    const res = await GET(getReq('date=2028-02-29'), ctx);
    expect(res.status).toBe(200);
  });

  it('담당 설비가 아니면 403 (assertMachineAccess 가 던진다)', async () => {
    mockAssert.mockImplementation(() => { throw new Error('forbidden'); });
    await expect(GET(getReq('date=2026-07-28'), ctx)).rejects.toThrow();
  });

  it('shift 파라미터 없이 date 만으로 200', async () => {
    const res = await GET(getReq('date=2026-07-28'), ctx);
    expect(res.status).toBe(200);
  });

  it('업무일 창과 시간대별 소계·건별 목록을 함께 돌려준다', async () => {
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
    const res = await GET(getReq('date=2026-07-28'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.business_date).toBe('2026-07-28');
    expect(body.window_start).toBe('2026-07-28T01:00:00.000Z');
    expect(body.window_end).toBe('2026-07-29T01:00:00.000Z');
    expect(body.total_minutes).toBe(30);
    expect(body.shift_totals).toEqual({
      day: { minutes: 30, start: '2026-07-28T01:00:00.000Z', end: '2026-07-28T13:00:00.000Z' },
      night: { minutes: 0, start: '2026-07-28T13:00:00.000Z', end: '2026-07-29T01:00:00.000Z' },
    });
    expect(body.ongoing_since).toBeNull();
    // andon 이중 기록은 1행으로 접힌다
    expect(body.intervals).toHaveLength(1);
    expect(body.intervals[0]).toMatchObject({ id: 'de-1', reason: 'INSPECTION', minutes: 30 });
  });

  it('진행 중 비가동의 ongoing_since 는 업무일 시작으로 클립되지 않은 원본 시각이다', async () => {
    // 이전 업무일(00:30)에 시작해 아직 진행 중. 목록의 start 는 업무일 시작(01:00)으로
    // 클립되지만 경과 시간은 실제 시작부터 재야 하므로 ongoing_since 는 원본을 준다.
    mockLoadDetail.mockResolvedValue([
      {
        id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
        start_time: '2026-07-28T00:30:00.000Z', end_time: null, is_planned: false,
      },
    ]);
    const res = await GET(getReq('date=2026-07-28'), ctx);
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
    const res = await GET(getReq('date=2026-07-28'), ctx);
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
    const res = await GET(getReq('date=2026-07-28'), ctx);
    const body = await res.json();
    expect(body.total_minutes).toBeNull();
    expect(body.intervals).toHaveLength(1);
  });

  it('비가동이 없으면 total_minutes 는 0 이고 목록은 빈 배열', async () => {
    const res = await GET(getReq('date=2026-07-28'), ctx);
    const body = await res.json();
    expect(body.total_minutes).toBe(0);
    expect(body.shift_totals.day.minutes).toBe(0);
    expect(body.shift_totals.night.minutes).toBe(0);
    expect(body.intervals).toEqual([]);
  });

  it('업무일 창이 유효하지 않으면 500', async () => {
    mockGetBusinessDayWindow.mockResolvedValue(null);
    const res = await GET(getReq('date=2026-07-28'), ctx);
    expect(res.status).toBe(500);
  });

  it('교대(day/night) 창이 유효하지 않으면 500', async () => {
    mockGetShiftWindow.mockResolvedValue(null);
    const res = await GET(getReq('date=2026-07-28'), ctx);
    expect(res.status).toBe(500);
  });

  it('day/night 경계를 넘는 비가동은 양쪽 소계에 나뉘어 기여하지만 목록엔 한 줄로 남는다', async () => {
    // 12:50~13:30, 경계(13:00)를 넘는다: day 에 10분, night 에 30분, 업무일 총합 40분.
    mockLoadDetail.mockResolvedValue([
      {
        id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
        start_time: '2026-07-28T12:50:00.000Z', end_time: '2026-07-28T13:30:00.000Z',
        is_planned: false,
      },
    ]);
    const res = await GET(getReq('date=2026-07-28'), ctx);
    const body = await res.json();
    expect(body.total_minutes).toBe(40);
    expect(body.shift_totals.day.minutes).toBe(10);
    expect(body.shift_totals.night.minutes).toBe(30);
    // 목록은 경계에서 쪼개지 않는다 — 실제 시각을 가진 한 줄.
    expect(body.intervals).toHaveLength(1);
    expect(body.intervals[0]).toMatchObject({
      id: 'de-1',
      start: '2026-07-28T12:50:00.000Z',
      end: '2026-07-28T13:30:00.000Z',
      minutes: 40,
    });
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

  // 20260729010000 이 추가한 응답. 상태는 비정상인데 고칠 열린 로그·항목이 전무한
  // 경우로, "이미 가동 중"(409)과는 다른 상황이라 같은 코드로 뭉뚱그리면 안 된다.
  it('고칠 대상이 없으면 409 가 아니라 400 이다', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, reason: 'no_open_downtime' }, error: null });
    const res = await PATCH(req({ reason: 'INSPECTION' }), ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('no_open_downtime');
  });

  it('RPC 오류는 500', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const res = await PATCH(req({ reason: 'INSPECTION' }), ctx);
    expect(res.status).toBe(500);
  });
});
