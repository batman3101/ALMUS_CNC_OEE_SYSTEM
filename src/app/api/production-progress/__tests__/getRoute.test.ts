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
const mockFrom = jest.fn();
const mockGetBreakTimeMinutes = jest.fn();
const mockGetShiftWindow = jest.fn();
const mockLoadRows = jest.fn();

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: (...a: unknown[]) => mockAssertMachineAccess(...a),
  apiAuthErrorResponse: () => null,
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a) },
}));
jest.mock('@/lib/plannedRuntime', () => ({
  getBreakTimeMinutes: () => mockGetBreakTimeMinutes(),
}));
// 비가동 계산은 확정 OEE(daily/route)와 같은 함수(calculateVerifiedDowntimeMinutesForWindow)를
// 그대로 쓴다 — 그 함수는 REAL 로 두어 클립·유니온을 실제로 검증한다. 창(window)과 원천 행
// 로딩만 모킹한다.
jest.mock('@/lib/shiftDowntime', () => ({
  getShiftWindow: (...a: unknown[]) => mockGetShiftWindow(...a),
  loadDowntimeSourceRows: (...a: unknown[]) => mockLoadRows(...a),
}));

import { GET } from '../route';
import { TOTAL_BREAK_MINUTES } from '@/utils/shiftBreaks';

const MACHINE = '11111111-1111-4111-8111-111111111111';

// 2026-07-17 A교대 시간창 (08:00~20:00 +07).
const WINDOW = {
  start: new Date('2026-07-17T08:00:00+07:00').getTime(),
  end: new Date('2026-07-17T20:00:00+07:00').getTime(),
};

interface SourceRow {
  start_time: string;
  end_time: string | null;
  is_planned: boolean;
}

/** 09:00~09:11 에 끝난 비가동. */
const CLOSED_11_MIN: SourceRow = {
  start_time: '2026-07-17T09:00:00+07:00',
  end_time: '2026-07-17T09:11:00+07:00',
  is_planned: false,
};

/** 09:00 에 시작해 아직 끝나지 않은 비가동. */
const OPEN_FROM_0900: SourceRow = {
  start_time: '2026-07-17T09:00:00+07:00',
  end_time: null,
  is_planned: false,
};

const mockTables = ({
  lastReport = { shift_output_qty: 60, reported_at: '2026-07-17T09:30:00+07:00' },
  tact = 72,
}: {
  lastReport?: { shift_output_qty: number; reported_at: string } | null;
  tact?: number | null;
} = {}) => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'production_progress_reports') {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
          order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: lastReport, error: null }) }) }),
        }) }) }) }),
      };
    }
    if (table === 'machines_with_production_info') {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: tact === null ? null : { current_tact_time: tact }, error: null,
        }) }) }),
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
};

describe('GET /api/production-progress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssertMachineAccess.mockReturnValue(undefined);
    mockGetBreakTimeMinutes.mockResolvedValue(TOTAL_BREAK_MINUTES);
    mockGetShiftWindow.mockResolvedValue(WINDOW);
    mockLoadRows.mockResolvedValue([CLOSED_11_MIN]);
    mockTables();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const call = (qs: string) => GET({ url: `http://localhost/api/production-progress?${qs}` } as never);

  it('마지막 보고·비가동 합계·tact 를 함께 돌려준다', async () => {
    const res = await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    expect(res.status).toBe(200);

    const body = await res.json() as {
      last_report: { shift_output_qty: number } | null;
      downtime_minutes: number | null;
      tact_time_seconds: number | null;
    };
    expect(body.last_report?.shift_output_qty).toBe(60);
    expect(body.downtime_minutes).toBe(11);
    expect(body.tact_time_seconds).toBe(72);
  });

  it('확정 OEE 와 같은 창·같은 사용자로 비가동 원천을 로드한다', async () => {
    await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    expect(mockGetShiftWindow).toHaveBeenCalledWith('2026-07-17', 'A');
    expect(mockLoadRows).toHaveBeenCalledWith(
      MACHINE,
      new Date(WINDOW.start).toISOString(),
      new Date(WINDOW.end).toISOString(),
    );
  });

  it('필수 파라미터가 없으면 400', async () => {
    const res = await call('date=2026-07-17&shift=A');
    expect(res.status).toBe(400);
  });

  it('교대 시간창 설정이 유효하지 않으면 500', async () => {
    mockGetShiftWindow.mockResolvedValue(null);
    const res = await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    expect(res.status).toBe(500);
  });

  it('tact 가 없으면 null 로 돌려준다', async () => {
    mockLoadRows.mockResolvedValue([]);
    mockTables({ lastReport: null, tact: null });

    const res = await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    const body = await res.json() as { tact_time_seconds: number | null };
    expect(body.tact_time_seconds).toBeNull();
  });

  it('요청한 설비와 인증된 사용자로 담당 여부를 검사한다', async () => {
    await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    expect(mockAssertMachineAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'op-1' }),
      MACHINE,
    );
  });

  it('담당이 아닌 설비는 조회도 거부한다', async () => {
    mockAssertMachineAccess.mockImplementation(() => { throw new Error('forbidden'); });
    await expect(call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`)).rejects.toThrow();
  });

  it('아직 끝나지 않은 비가동은 지금까지로 센다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-17T09:25:00+07:00'));
    mockLoadRows.mockResolvedValue([OPEN_FROM_0900]);

    const res = await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    const body = await res.json() as { downtime_minutes: number | null };
    expect(body.downtime_minutes).toBe(25);
  });

  // 확정 OEE 계약의 핵심: 겹친 비가동은 유니온으로 한 번만 센다. 예전 실시간 경로는
  // 행을 손으로 더해 11 + 25 = 36 으로 이중 계산했다. 이제 [09:00~09:11]∪[09:00~09:25]=25.
  it('겹친 닫힌/열린 비가동은 유니온으로 한 번만 센다 (이중계산 금지)', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-17T09:25:00+07:00'));
    mockLoadRows.mockResolvedValue([CLOSED_11_MIN, OPEN_FROM_0900]);

    const res = await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    const body = await res.json() as { downtime_minutes: number | null };
    expect(body.downtime_minutes).toBe(25);
  });

  // 계획정지가 휴식과 겹쳐 이중 차감이 우려되면 확정 함수가 null(계산 보류)을 돌려준다.
  // 그 null 을 0 으로 뭉개지 않고 그대로 전달해야 한다 (NULL ≠ 0%).
  it('계획정지·휴식 겹침으로 계산 보류면 downtime_minutes 를 null 로 전달한다', async () => {
    mockLoadRows.mockResolvedValue([{
      start_time: '2026-07-17T12:00:00+07:00',
      end_time: '2026-07-17T12:30:00+07:00',
      is_planned: true,
    }]);
    // 휴식 총량 > 0 이어야 계획정지 null 규칙이 발동한다.
    mockGetBreakTimeMinutes.mockResolvedValue(TOTAL_BREAK_MINUTES);

    const res = await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    const body = await res.json() as { downtime_minutes: number | null };
    expect(body.downtime_minutes).toBeNull();
  });

  it('설정된 휴식 총량이 코드 상수와 같으면 정상으로 알린다', async () => {
    const res = await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    const body = await res.json() as { break_config_matches: boolean };
    expect(body.break_config_matches).toBe(true);
  });

  it('관리자가 휴식 총량을 바꿔 코드 상수와 어긋나면 계산 불가로 알린다', async () => {
    mockGetBreakTimeMinutes.mockResolvedValue(TOTAL_BREAK_MINUTES + 20);

    const res = await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    const body = await res.json() as {
      break_config_matches: boolean;
      configured_break_minutes: number;
    };
    expect(body.break_config_matches).toBe(false);
    expect(body.configured_break_minutes).toBe(TOTAL_BREAK_MINUTES + 20);
  });
});
