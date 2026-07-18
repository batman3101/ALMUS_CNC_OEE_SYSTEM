import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';
import { getBreakTimeMinutes } from '@/lib/plannedRuntime';
import { getShiftWindow, loadDowntimeSourceRows } from '@/lib/shiftDowntime';
import { calculateVerifiedDowntimeMinutesForWindow } from '@/app/api/production-records/daily/downtimeCalculation';
import { computeShiftSnapshot } from '@/lib/shiftMetrics';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/production-records/close-shift — 교대 마감.
 * output = final_qty(있으면) 또는 그 교대 마지막 진척값. defect = NULL(미검사, 다음날 입력).
 * 늦게 불러도 귀속은 인자의 date/shift (입력 시각 무관). avail×perf 는 지금 확정, 품질/OEE 는 보류.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const body = await request.json() as { machine_id?: unknown; date?: unknown; shift?: unknown; final_qty?: unknown };
    const machineId = typeof body.machine_id === 'string' ? body.machine_id : '';
    const date = typeof body.date === 'string' ? body.date : '';
    const shift = body.shift === 'A' || body.shift === 'B' ? body.shift : null;
    const finalQty = typeof body.final_qty === 'number' ? body.final_qty : null;

    if (!UUID.test(machineId)) return NextResponse.json({ error: 'machine_id must be a UUID' }, { status: 400 });
    if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    if (shift === null) return NextResponse.json({ error: "shift must be 'A' or 'B'" }, { status: 400 });
    if (finalQty !== null && (!Number.isInteger(finalQty) || finalQty < 0))
      return NextResponse.json({ error: 'final_qty must be a non-negative integer' }, { status: 400 });

    assertMachineAccess(user, machineId);

    // output 결정: final_qty 우선, 없으면 마지막 진척값.
    let outputQty = finalQty;
    if (outputQty === null) {
      const { data: last } = await supabaseAdmin
        .from('production_progress_reports')
        .select('shift_output_qty')
        .eq('machine_id', machineId).eq('date', date).eq('shift', shift)
        .order('reported_at', { ascending: false }).limit(1).maybeSingle();
      outputQty = last?.shift_output_qty ?? null;
    }
    if (outputQty === null) return NextResponse.json({ error: 'no quantity to close (진척·final_qty 없음)' }, { status: 400 });

    // 비가동 = 확정 OEE 와 동일 계약. tact = 뷰.
    const window = await getShiftWindow(date, shift);
    if (!window) return NextResponse.json({ error: 'Shift time configuration is invalid' }, { status: 500 });
    const rows = await loadDowntimeSourceRows(machineId, new Date(window.start).toISOString(), new Date(window.end).toISOString());
    const breakMinutes = await getBreakTimeMinutes();
    const downtimeMinutes = calculateVerifiedDowntimeMinutesForWindow(rows, window, breakMinutes, Date.now());
    const operatingMinutes = Math.round((window.end - window.start) / 60_000);

    const { data: tactRow } = await supabaseAdmin
      .from('machines_with_production_info').select('current_tact_time').eq('id', machineId).maybeSingle();
    const tactSeconds = tactRow?.current_tact_time && tactRow.current_tact_time > 0 ? tactRow.current_tact_time : 120;

    // F2: 이미 다음날 불량이 확정된 교대를 재마감하는 경우 그 확정 불량을 보존한다.
    // null 로 덮으면 파생된 quality/oee 까지 소실되므로, 기존 defect 를 읽어 스냅샷에 넘겨 재파생한다.
    const { data: existingRec } = await supabaseAdmin
      .from('production_records')
      .select('defect_qty')
      .eq('machine_id', machineId).eq('date', date).eq('shift', shift)
      .maybeSingle();
    const preservedDefect = existingRec?.defect_qty ?? null;

    const snap = computeShiftSnapshot({
      operatingMinutes, breakMinutes, downtimeMinutes, outputQty, defectQty: preservedDefect, tactSeconds,
    });

    const { error: upsertError } = await supabaseAdmin
      .from('production_records')
      .upsert({
        machine_id: machineId, date, shift,
        output_qty: outputQty, defect_qty: preservedDefect,  // 미검사면 NULL, 확정 불량 있으면 보존
        // 정수 컬럼(runtime)·소수 4자리(비율)로 반올림해 저장한다(daily 라우트와 동일 규율).
        planned_runtime: Math.round(snap.plannedRuntime),
        actual_runtime: snap.actualRuntime === null ? null : Math.round(snap.actualRuntime),
        ideal_runtime: Math.round(snap.idealRuntime),
        availability: snap.availability === null ? null : Math.round(snap.availability * 10000) / 10000,
        performance: snap.performance === null ? null : Math.round(snap.performance * 10000) / 10000,
        quality: snap.quality === null ? null : Math.round(snap.quality * 10000) / 10000,
        oee: snap.oee === null ? null : Math.round(snap.oee * 10000) / 10000,
        downtime_minutes: snap.downtime === null ? null : Math.round(snap.downtime),
        tact_time_seconds: tactSeconds,
      }, { onConflict: 'machine_id,date,shift' });

    if (upsertError) {
      console.error('교대 마감 저장 오류:', upsertError);
      return NextResponse.json({ error: 'Failed to close shift' }, { status: 500 });
    }
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
