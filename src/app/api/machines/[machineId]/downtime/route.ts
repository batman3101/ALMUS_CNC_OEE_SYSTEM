import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';
import { getBusinessTimeConfig } from '@/lib/shiftConfig';
import { getBusinessDateAt } from '@/utils/downtimeIntervals';

export const dynamic = 'force-dynamic';

// machines.current_state ENUM machine_status 의 비정상 값(NORMAL 제외). andon 사유 = 이 8개.
const DOWNTIME_REASONS = new Set([
  'INSPECTION', 'BREAKDOWN_REPAIR', 'PM_MAINTENANCE', 'MODEL_CHANGE',
  'PLANNED_STOP', 'PROGRAM_CHANGE', 'TOOL_CHANGE', 'TEMPORARY_STOP',
]);

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
