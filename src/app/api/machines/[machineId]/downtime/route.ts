import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';
import { getBusinessTimeConfig } from '@/lib/shiftConfig';
import { getBusinessDateAt } from '@/utils/downtimeIntervals';
import { getShiftWindow, loadDowntimeDetailRows } from '@/lib/shiftDowntime';
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
 * GET /api/machines/[machineId]/downtime?date=&shift= — 이 교대의 비가동 누적 + 건별 내역.
 *
 * `total_minutes` 는 확정 OEE 와 **같은 함수**(calculateVerifiedDowntimeMinutesForWindow)로
 * 계산한다. 새 합계 로직을 만들면 화면마다 다른 숫자가 나온다.
 *
 * 건별 목록은 buildDowntimeBreakdown 이 겹침을 배분해 만든다. andon 은 downtime_entries 와
 * machine_logs 양쪽에 같은 시간대를 쓰므로, 배분 없이 나열하면 모든 andon 비가동이 두 줄이
 * 된다.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ machineId: string }> }) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { machineId } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') ?? '';
    const shift = searchParams.get('shift');

    if (!DATE.test(date) || (shift !== 'A' && shift !== 'B')) {
      return NextResponse.json(
        { error: 'date must be YYYY-MM-DD and shift must be A or B' },
        { status: 400 }
      );
    }

    // 읽기에도 담당 설비 검사를 건다 — 같은 파일의 POST 및 production-progress GET 과 동일.
    assertMachineAccess(user, machineId);

    // 확정 OEE 와 같은 buildShiftWindows 산출물. 프런트가 창을 따로 계산하지 않게 서버가 준다.
    const window = await getShiftWindow(date, shift);
    if (!window) {
      return NextResponse.json({ error: 'Shift time configuration is invalid' }, { status: 500 });
    }

    const shiftStartIso = new Date(window.start).toISOString();
    const shiftEndIso = new Date(window.end).toISOString();

    const rows = await loadDowntimeDetailRows(machineId, shiftStartIso, shiftEndIso);
    const breakMinutes = await getBreakTimeMinutes();
    const nowMs = Date.now();

    // null = 계획정지·휴식 겹침으로 계산 보류. 0 으로 뭉개지 않고 그대로 전달한다.
    const totalMinutes = calculateVerifiedDowntimeMinutesForWindow(
      rows.map(({ start_time, end_time, is_planned }) => ({ start_time, end_time, is_planned })),
      window,
      breakMinutes,
      nowMs
    );

    // 진행 중 비가동의 **클립되지 않은** 시작 시각. 목록의 start 는 교대 창에 클립되므로
    // 이전 교대에서 이어진 비가동의 경과 시간을 그걸로 재면 실제보다 짧게 나온다.
    // andon 은 두 소스에 함께 기록하므로 열린 행이 둘일 수 있다 — 가장 이른 시작을 쓴다.
    const openStarts = rows
      .filter(row => row.end_time === null)
      .map(row => Date.parse(row.start_time))
      .filter(value => Number.isFinite(value));
    const ongoingSince = openStarts.length > 0
      ? new Date(Math.min(...openStarts)).toISOString()
      : null;

    return NextResponse.json({
      shift_start: shiftStartIso,
      shift_end: shiftEndIso,
      total_minutes: totalMinutes,
      ongoing_since: ongoingSince,
      intervals: buildDowntimeBreakdown(rows, window, nowMs),
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
