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
    // 마감은 교대 종료 후에만(늦은 마감은 무기한 허용, 이른 마감은 금지). UI 는 현재 교대를
    // 제외하지만 API 를 직접 치면 진행 중·미래 교대의 확정 record 를 만들 수 있었다(자체 감사 #4).
    if (window.end > Date.now())
      return NextResponse.json({ error: 'shift has not ended yet (이른 마감 금지)' }, { status: 400 });
    const rows = await loadDowntimeSourceRows(machineId, new Date(window.start).toISOString(), new Date(window.end).toISOString());
    const breakMinutes = await getBreakTimeMinutes();
    const downtimeMinutes = calculateVerifiedDowntimeMinutesForWindow(rows, window, breakMinutes, Date.now());
    const operatingMinutes = Math.round((window.end - window.start) / 60_000);

    // tact 없음 = 공정 기준 미확인 → null. 임의 기본값(과거 120초)으로 성능을 날조해
    // 확정 저장하면 안 된다(NULL≠0 원칙, daily 라우트의 processStandardKnown 과 동일 정책).
    const { data: tactRow } = await supabaseAdmin
      .from('machines_with_production_info').select('current_tact_time').eq('id', machineId).maybeSingle();
    const tactSeconds = tactRow?.current_tact_time && tactRow.current_tact_time > 0 ? tactRow.current_tact_time : null;

    // quality/oee 는 여기서 만들지 않는다 — 기존 확정 불량(F2 보존)을 읽어 재파생하는 일은
    // close_shift_upsert RPC 가 advisory lock(machine·date·shift) 아래에서 원자적으로 한다.
    // (앱에서 읽고 upsert 하면 불량 확정과 경쟁해 확정 불량이 유실될 수 있다 — TOCTOU)
    const snap = computeShiftSnapshot({
      operatingMinutes, breakMinutes, downtimeMinutes, outputQty, defectQty: null, tactSeconds,
    });

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('close_shift_upsert', {
      p_machine_id: machineId, p_date: date, p_shift: shift, p_output_qty: outputQty,
      // 정수 컬럼(runtime)·소수 4자리(비율)로 반올림해 저장한다(daily 라우트와 동일 규율).
      p_planned_runtime: Math.round(snap.plannedRuntime),
      p_actual_runtime: snap.actualRuntime === null ? null : Math.round(snap.actualRuntime),
      p_ideal_runtime: snap.idealRuntime === null ? null : Math.round(snap.idealRuntime),
      p_availability: snap.availability === null ? null : Math.round(snap.availability * 10000) / 10000,
      p_performance: snap.performance === null ? null : Math.round(snap.performance * 10000) / 10000,
      p_downtime_minutes: snap.downtime === null ? null : Math.round(snap.downtime),
      p_tact_time_seconds: tactSeconds,
    });

    const rpcResult = rpcData as { ok?: boolean; reason?: string; defect_qty?: number } | null;
    if (rpcError || !rpcResult?.ok) {
      // 확정 불량보다 작은 output 재마감 — 데이터 불변조건(defect ≤ output) 보호.
      if (rpcResult?.reason === 'output_lt_defect')
        return NextResponse.json(
          { error: 'output_qty is less than confirmed defect_qty', defect_qty: rpcResult.defect_qty },
          { status: 409 },
        );
      console.error('교대 마감 저장 오류:', rpcError ?? rpcData);
      return NextResponse.json({ error: 'Failed to close shift' }, { status: 500 });
    }
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
