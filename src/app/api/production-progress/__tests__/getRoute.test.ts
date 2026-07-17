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

import { GET } from '../route';
import { TOTAL_BREAK_MINUTES } from '@/utils/shiftBreaks';

const MACHINE = '11111111-1111-4111-8111-111111111111';

interface DowntimeMockRow {
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
}

/** 09:00~09:11 에 끝난 비가동. 길이가 기록돼 있다. */
const CLOSED_11_MIN: DowntimeMockRow = {
  start_time: '2026-07-17T09:00:00+07:00',
  end_time: '2026-07-17T09:11:00+07:00',
  duration_minutes: 11,
};

/** 09:00 에 시작해 아직 끝나지 않은 비가동 (end_time IS NULL). */
const OPEN_FROM_0900: DowntimeMockRow = {
  start_time: '2026-07-17T09:00:00+07:00',
  end_time: null,
  duration_minutes: null,
};

const mockTables = ({
  lastReport = { shift_output_qty: 60, reported_at: '2026-07-17T09:30:00+07:00' },
  downtimes = [CLOSED_11_MIN],
  tact = 72,
}: {
  lastReport?: { shift_output_qty: number; reported_at: string } | null;
  downtimes?: DowntimeMockRow[];
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
    if (table === 'downtime_entries') {
      return {
        select: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ data: downtimes, error: null }) }) }) }),
      };
    }
    // tact 는 machines 테이블이 아니라 이 뷰에 있다 (machines 에는 tact 컬럼이 없다).
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
      downtime_minutes: number;
      tact_time_seconds: number | null;
    };
    expect(body.last_report?.shift_output_qty).toBe(60);
    expect(body.downtime_minutes).toBe(11);
    // 클라이언트가 tact 의 출처(뷰)를 알 필요가 없도록 서버가 해결해 실어준다.
    expect(body.tact_time_seconds).toBe(72);
  });

  it('필수 파라미터가 없으면 400', async () => {
    const res = await call('date=2026-07-17&shift=A');
    expect(res.status).toBe(400);
  });

  // tact 를 모르면 성능률을 계산할 수 없다. 0 이나 임의값으로 채우지 않는다.
  it('tact 가 없으면 null 로 돌려준다', async () => {
    mockTables({ lastReport: null, downtimes: [], tact: null });

    const res = await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    const body = await res.json() as { tact_time_seconds: number | null };
    expect(body.tact_time_seconds).toBeNull();
  });

  // 읽기에도 담당 설비 검사를 건다. 같은 파일의 POST 와, 다른 읽기 라우트
  // (machines/[machineId]/oee, machines/[machineId]/production) 의 선례와 같은 기준이다.
  // "호출됐다"로는 부족하다 — 엉뚱한 설비를 물어보면 담당자 검사가 무의미해진다.
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

  // 사용자가 명시적으로 요구한 기능이다: "현재까지 비가동 중입니다".
  // Date.now() 를 라우트가 직접 부르므로 시각을 고정해야 결정론적이다.
  it('아직 끝나지 않은 비가동은 지금까지로 센다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-17T09:25:00+07:00'));
    mockTables({ downtimes: [OPEN_FROM_0900] });

    const res = await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    const body = await res.json() as { downtime_minutes: number };
    expect(body.downtime_minutes).toBe(25);
  });

  it('닫힌 비가동과 열린 비가동이 섞여도 합산한다', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-07-17T09:25:00+07:00'));
    mockTables({ downtimes: [CLOSED_11_MIN, OPEN_FROM_0900] });

    const res = await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    const body = await res.json() as { downtime_minutes: number };
    expect(body.downtime_minutes).toBe(36);
  });

  // duration_minutes 와 end_time 은 서로 독립적으로 nullable 이다. 길이가 기록되지 않았다고
  // 0 분으로 세면 그 비가동이 통째로 사라져 가동률이 실제보다 높아 보인다. 두 타임스탬프가
  // 다 있으므로 추측할 필요 없이 계산된다.
  it('닫혔는데 duration_minutes 가 NULL 이면 타임스탬프로 계산한다', async () => {
    mockTables({
      downtimes: [{ ...CLOSED_11_MIN, duration_minutes: null }],
    });

    const res = await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    const body = await res.json() as { downtime_minutes: number };
    expect(body.downtime_minutes).toBe(11);
  });

  // shiftBreaks 의 휴식 시간대 합계는 코드 상수인데 break_time_minutes 는 관리자가 UI 에서
  // 바꿀 수 있다. 순수 모듈은 설정을 못 읽으므로 어긋남 검출은 여기서만 가능하다.
  // 이 방어선이 없으면 관리자가 휴식 총량을 바꾼 순간부터 실시간 화면과 확정 OEE 가
  // 영구히 다른 말을 하면서도 모든 테스트가 초록으로 남는다.
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
