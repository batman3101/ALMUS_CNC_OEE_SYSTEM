import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';
import { getBusinessTimeConfig } from '@/lib/shiftConfig';
import { getBusinessDateAt } from '@/utils/downtimeIntervals';
import { getBusinessDayWindow, getShiftWindow, loadDowntimeDetailRows } from '@/lib/shiftDowntime';
import { getBreakTimeMinutes } from '@/lib/plannedRuntime';
import { calculateVerifiedDowntimeMinutesForWindow } from '@/app/api/production-records/daily/downtimeCalculation';
import { buildDowntimeBreakdown } from '@/utils/downtimeBreakdown';

export const dynamic = 'force-dynamic';

// machines.current_state ENUM machine_status 의 비정상 값(NORMAL 제외). andon 사유 = 이 8개.
const DOWNTIME_REASONS = new Set([
  'INSPECTION', 'BREAKDOWN_REPAIR', 'PM_MAINTENANCE', 'MODEL_CHANGE',
  'PLANNED_STOP', 'PROGRAM_CHANGE', 'TOOL_CHANGE', 'TEMPORARY_STOP',
]);

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** POST /api/machines/[machineId]/downtime — andon 한 동작(start+reason / resume). */
export async function POST(request: NextRequest, ctx: { params: Promise<{ machineId: string }> }) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { machineId } = await ctx.params;
    const body = await request.json() as { action?: unknown; reason?: unknown };
    const action = body.action === 'start' || body.action === 'resume' ? body.action : null;
    const reason = typeof body.reason === 'string' ? body.reason : '';
    if (action === null) return NextResponse.json({ error: "action must be 'start' or 'resume'" }, { status: 400 });
    // reason 은 machine_status enum 값이어야 한다(RPC 의 ::machine_status 캐스트 실패 방지).
    if (action === 'start' && !DOWNTIME_REASONS.has(reason))
      return NextResponse.json({ error: 'reason must be a valid non-normal machine_status' }, { status: 400 });

    assertMachineAccess(user, machineId);

    // downtime_entries.date = 업무일자(시작 시각의 shift 귀속). RPC 로 넘긴다.
    const cfg = await getBusinessTimeConfig();
    const businessDate = getBusinessDateAt(new Date(), cfg.timezone, cfg.shiftAStart);

    const { data, error } = await supabaseAdmin.rpc('toggle_machine_downtime', {
      p_machine_id: machineId, p_action: action, p_reason: reason,
      p_date: businessDate, p_operator_id: user.userId,
    });
    if (error) {
      console.error('andon 오류:', error);
      return NextResponse.json({ error: 'Failed to toggle downtime' }, { status: 500 });
    }
    const r = data as { ok: boolean; state?: string; reason?: string };
    if (!r.ok) return NextResponse.json({ error: r.reason ?? 'failed' }, { status: 400 });
    return NextResponse.json({ success: true, state: r.state }, { status: 200 });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}

/**
 * GET /api/machines/[machineId]/downtime?date= — 이 업무일(A+B 교대 전체)의 비가동 누적 +
 * 시간대별(day/night) 소계 + 건별 내역.
 *
 * `total_minutes` 와 두 소계는 모두 확정 OEE 와 **같은 함수**(calculateVerifiedDowntimeMinutesForWindow)
 * 로 계산한다 — 창만 업무일 전체/각 교대로 다르게 넣는다. 새 합계 로직을 만들면 화면마다
 * 다른 숫자가 나온다.
 *
 * 건별 목록은 buildDowntimeBreakdown 이 겹침을 배분해 만든다. andon 은 downtime_entries 와
 * machine_logs 양쪽에 같은 시간대를 쓰므로, 배분 없이 나열하면 모든 andon 비가동이 두 줄이
 * 된다. 목록은 업무일 창에만 클립되고 day/night 경계에서 나뉘지 않는다 — 경계를 넘는 비가동은
 * 두 소계에 각각 기여하지만(같은 함수를 각 창에 적용한 결과이므로 day+night 는 업무일
 * 총합과 일치한다), 목록에서는 실제 시각을 가진 한 줄로 남는다. 목록과 소계를 행 단위로
 * 대조하려 하지 말 것 — 대응 관계는 day+night = 업무일 총합, 그뿐이다.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ machineId: string }> }) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { machineId } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') ?? '';

    if (!DATE.test(date)) {
      return NextResponse.json(
        { error: 'date must be YYYY-MM-DD' },
        { status: 400 }
      );
    }

    // 읽기에도 담당 설비 검사를 건다 — 같은 파일의 POST 및 production-progress GET 과 동일.
    assertMachineAccess(user, machineId);

    // 업무일 창(A교대 시작 ~ 다음날 A교대 시작 직전)과 그 안의 두 교대 창. 셋 다 같은
    // 설정(timezone·shiftAStart/BStart)에서 나오므로 경계가 어긋나지 않는다.
    const [businessWindow, dayWindow, nightWindow] = await Promise.all([
      getBusinessDayWindow(date),
      getShiftWindow(date, 'A'),
      getShiftWindow(date, 'B'),
    ]);
    if (!businessWindow || !dayWindow || !nightWindow) {
      return NextResponse.json({ error: 'Shift time configuration is invalid' }, { status: 500 });
    }

    const windowStartIso = new Date(businessWindow.start).toISOString();
    const windowEndIso = new Date(businessWindow.end).toISOString();

    // 업무일 창 전체에 대해 한 번만 로드하고, 총합·소계·목록 모두 이걸 재사용한다.
    const rows = await loadDowntimeDetailRows(machineId, windowStartIso, windowEndIso);
    const breakMinutes = await getBreakTimeMinutes();
    const nowMs = Date.now();
    const sourceRows = rows.map(({ start_time, end_time, is_planned }) => ({ start_time, end_time, is_planned }));

    // null = 계획정지·휴식 겹침으로 계산 보류. 0 으로 뭉개지 않고 그대로 전달한다.
    const totalMinutes = calculateVerifiedDowntimeMinutesForWindow(sourceRows, businessWindow, breakMinutes, nowMs);
    const dayMinutes = calculateVerifiedDowntimeMinutesForWindow(sourceRows, dayWindow, breakMinutes, nowMs);
    const nightMinutes = calculateVerifiedDowntimeMinutesForWindow(sourceRows, nightWindow, breakMinutes, nowMs);

    // 진행 중 비가동의 **클립되지 않은** 시작 시각. 목록의 start 는 업무일 창에 클립되므로
    // 이전 업무일에서 이어진 비가동의 경과 시간을 그걸로 재면 실제보다 짧게 나온다.
    // andon 은 두 소스에 함께 기록하므로 열린 행이 둘일 수 있다 — 가장 이른 시작을 쓴다.
    const openStarts = rows
      .filter(row => row.end_time === null)
      .map(row => Date.parse(row.start_time))
      .filter(value => Number.isFinite(value));
    const ongoingSince = openStarts.length > 0
      ? new Date(Math.min(...openStarts)).toISOString()
      : null;

    return NextResponse.json({
      business_date: date,
      window_start: windowStartIso,
      window_end: windowEndIso,
      total_minutes: totalMinutes,
      // 라벨은 화면에서 '주간'/'야간'으로 표시한다(A/B 글자를 쓰지 않는다). start/end 를
      // 함께 실어 화면이 시각을 하드코딩하지 않게 한다 — 교대 시각은 설정값이다.
      shift_totals: {
        day: {
          minutes: dayMinutes,
          start: new Date(dayWindow.start).toISOString(),
          end: new Date(dayWindow.end).toISOString(),
        },
        night: {
          minutes: nightMinutes,
          start: new Date(nightWindow.start).toISOString(),
          end: new Date(nightWindow.end).toISOString(),
        },
      },
      ongoing_since: ongoingSince,
      intervals: buildDowntimeBreakdown(rows, businessWindow, nowMs),
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}

/**
 * PATCH /api/machines/[machineId]/downtime — 진행 중인 비가동의 사유 정정.
 *
 * 정정은 **덮어쓰기**다. 시작 시각을 유지한 채 사유만 바꾼다. 사유를 바꾸며 구간을
 * 나누고 싶다면 그건 정정이 아니라 전환이고, POST(action='start')가 이미 그렇게 동작한다.
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ machineId: string }> }) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { machineId } = await ctx.params;
    const body = await request.json() as { reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason : '';

    // NORMAL_OPERATION 은 DOWNTIME_REASONS 에 없다 — 정정으로 가동 재개를 흉내낼 수 없다.
    // 가동 재개는 POST(action='resume') 의 책임이고, 그쪽만 구간을 닫는다.
    if (!DOWNTIME_REASONS.has(reason)) {
      return NextResponse.json(
        { error: 'reason must be a valid non-normal machine_status' },
        { status: 400 }
      );
    }

    assertMachineAccess(user, machineId);

    const { data, error } = await supabaseAdmin.rpc('correct_open_downtime_reason', {
      p_machine_id: machineId,
      p_reason: reason,
      p_operator_id: user.userId,
    });

    if (error) {
      console.error('비가동 사유 정정 오류:', error);
      return NextResponse.json({ error: 'Failed to correct downtime reason' }, { status: 500 });
    }

    const result = data as { ok: boolean; state?: string; reason?: string };
    if (!result.ok) {
      // 가동 중이라 정정 대상이 없다 — 클라이언트가 목록을 새로고침하고 안내해야 한다.
      if (result.reason === 'not_in_downtime') {
        return NextResponse.json({ error: 'not_in_downtime' }, { status: 409 });
      }
      return NextResponse.json({ error: result.reason ?? 'failed' }, { status: 400 });
    }

    return NextResponse.json({ success: true, state: result.state }, { status: 200 });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
