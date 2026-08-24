import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { getBreakTimeMinutes } from '@/lib/plannedRuntime';
import { getShiftReportingWindow, loadDowntimeSourceRows } from '@/lib/shiftDowntime';
import { isShiftCloseAllowed } from '@/utils/shiftReportingWindow';
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
    const user = await requireFactoryUser(request, ['admin', 'engineer', 'operator']);
    const body = await request.json() as {
      machine_id?: unknown; date?: unknown; shift?: unknown; final_qty?: unknown;
      below_progress_reason?: unknown;
    };
    const machineId = typeof body.machine_id === 'string' ? body.machine_id : '';
    const date = typeof body.date === 'string' ? body.date : '';
    const shift = body.shift === 'A' || body.shift === 'B' ? body.shift : null;
    const finalQty = typeof body.final_qty === 'number' ? body.final_qty : null;
    /**
     * 진척보다 낮게 마감할 때의 사유. 그 경우가 아니면 무시된다.
     *
     * 필요 여부를 여기서 판단하지 않는다 — 진척은 잠금 밖에서 읽으면 그 사이에 새 보고가
     * 들어올 수 있어, "사유가 필요한 마감"이 사유 없이 통과할 수 있다. 판정은 RPC 가
     * 잠금을 쥔 뒤에 하고, 여기서는 값을 그대로 넘긴다.
     */
    const belowProgressReason =
      typeof body.below_progress_reason === 'string' ? body.below_progress_reason : null;

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
      .eq('factory_id', user.factoryId)
        .eq('machine_id', machineId).eq('date', date).eq('shift', shift)
        .order('reported_at', { ascending: false }).limit(1).maybeSingle();
      outputQty = last?.shift_output_qty ?? null;
    }
    if (outputQty === null) return NextResponse.json({ error: 'no quantity to close (진척·final_qty 없음)' }, { status: 400 });

    // 비가동 = 확정 OEE 와 동일 계약. tact = 뷰.
    const reporting = await getShiftReportingWindow(date, shift, user.factoryId);
    if (!reporting) return NextResponse.json({ error: 'Shift time configuration is invalid' }, { status: 500 });
    const { window, bufferMinutes } = reporting;
    // 마감은 **진척 창이 완전히 닫힌 뒤에만**(늦은 마감은 무기한 허용, 이른 마감은 금지).
    // UI 는 현재 교대를 제외하지만 API 를 직접 치면 진행 중·미래 교대의 확정 record 를
    // 만들 수 있었다(자체 감사 #4).
    //
    // 예전에는 조건이 `window.end > now` 였다. 그런데 진척은 `window.end + 유예(10분)`
    // 까지 받으므로 그 10분 동안 두 경로가 겹쳤고, 마감이 잠금 **밖에서** 읽어둔 수량을
    // 그 사이 승인된 더 큰 진척 위에 덮어쓸 수 있었다(적대적 재감사 #5). 같은 판정 함수를
    // 써서 두 창이 서로소임을 정의상 보장한다.
    if (!isShiftCloseAllowed(window, bufferMinutes, Date.now()))
      return NextResponse.json(
        { error: 'shift reporting window is still open (이른 마감 금지)' },
        { status: 400 },
      );
    const windowStartIso = new Date(window.start).toISOString();
    const windowEndIso = new Date(window.end).toISOString();

    // 원천 지문을 **행을 읽기 전에** 잡는다. 이 순서가 정확성의 전부다(자체 감사 #6).
    //
    // 반대로 하면(행 먼저, 지문 나중) 그 사이의 변경이 지문에는 반영되고 행에는 반영되지
    // 않는다. RPC 의 대조는 통과하고, 낡은 행으로 계산한 지표가 확정 저장된다 — 거짓 음성.
    // 지금 순서에서는 같은 변경이 지문 불일치를 만들어 409 가 된다. 최악이 "불필요한 재시도"
    // 이고, 그건 되돌릴 수 있다. 거짓 음성은 되돌릴 수 없다(스냅샷 보존 원칙).
    const { data: expectedDigest, error: digestError } = await supabaseAdmin.rpc(
      'downtime_window_digest',
      { p_machine_id: machineId, p_window_start: windowStartIso, p_window_end: windowEndIso },
    );
    if (digestError || typeof expectedDigest !== 'string') {
      console.error('비가동 원천 지문 조회 오류:', digestError);
      return NextResponse.json({ error: 'Failed to read downtime source' }, { status: 500 });
    }

    const rows = await loadDowntimeSourceRows(machineId, windowStartIso, windowEndIso);
    const breakMinutes = await getBreakTimeMinutes(user.factoryId);
    const downtimeMinutes = calculateVerifiedDowntimeMinutesForWindow(rows, window, breakMinutes, Date.now());
    const operatingMinutes = Math.round((window.end - window.start) / 60_000);

    // tact 없음 = 공정 기준 미확인 → null. 임의 기본값(과거 120초)으로 성능을 날조해
    // 확정 저장하면 안 된다(NULL≠0 원칙, daily 라우트의 processStandardKnown 과 동일 정책).
    const { data: tactRow } = await supabaseAdmin
      .from('machines_with_production_info')
        .select('current_tact_time')
        // tact 는 OEE 의 분자다. 다른 공장 값으로 계산된 성능이 스냅샷으로 박히면 되돌릴 수 없다.
        .eq('factory_id', user.factoryId)
        .eq('id', machineId)
        .maybeSingle();
    const tactSeconds = tactRow?.current_tact_time && tactRow.current_tact_time > 0 ? tactRow.current_tact_time : null;

    // quality/oee 는 여기서 만들지 않는다 — 기존 확정 불량(F2 보존)을 읽어 재파생하는 일은
    // close_shift_upsert RPC 가 advisory lock(machine·date·shift) 아래에서 원자적으로 한다.
    // (앱에서 읽고 upsert 하면 불량 확정과 경쟁해 확정 불량이 유실될 수 있다 — TOCTOU)
    const snap = computeShiftSnapshot({
      operatingMinutes, breakMinutes, downtimeMinutes, outputQty, defectQty: null, tactSeconds,
    });

    const { data: rpcData, error: rpcError } = await supabaseAdmin.rpc('close_shift_upsert_v3', {
      p_machine_id: machineId, p_date: date, p_shift: shift, p_output_qty: outputQty,
      // 정수 컬럼(runtime)·소수 4자리(비율)로 반올림해 저장한다(daily 라우트와 동일 규율).
      p_planned_runtime: Math.round(snap.plannedRuntime),
      p_actual_runtime: snap.actualRuntime === null ? null : Math.round(snap.actualRuntime),
      p_ideal_runtime: snap.idealRuntime === null ? null : Math.round(snap.idealRuntime),
      p_availability: snap.availability === null ? null : Math.round(snap.availability * 10000) / 10000,
      p_performance: snap.performance === null ? null : Math.round(snap.performance * 10000) / 10000,
      p_downtime_minutes: snap.downtime === null ? null : Math.round(snap.downtime),
      p_tact_time_seconds: tactSeconds,
      // 잠금 아래에서 원천이 그대로인지 대조할 재료.
      p_window_start: windowStartIso,
      p_window_end: windowEndIso,
      p_expected_digest: expectedDigest,
      // 하향 마감 사유와 그 기록의 주체. 서비스 롤로 부르므로 auth.uid() 를 쓸 수 없다.
      p_below_progress_reason: belowProgressReason,
      p_actor_id: user.userId,
    });

    const rpcResult = rpcData as {
      ok?: boolean; reason?: string; defect_qty?: number; last_progress_qty?: number;
    } | null;
    if (rpcError || !rpcResult?.ok) {
      /**
       * 진척보다 낮은 마감인데 사유가 없다.
       *
       * 오류가 아니라 **확인이 필요한 상태**다 — 현장에서 실제로 일어날 수 있는 일이라
       * 막지 않기로 했고(사용자 확정 2026-08-04), 대신 나중에 되짚을 수 있게 사유를 받는다.
       * 마지막 진척값을 함께 실어 화면이 "진척 100개보다 적습니다"라고 구체적으로 물을 수
       * 있게 한다.
       */
      if (rpcResult?.reason === 'below_progress_needs_reason')
        return NextResponse.json(
          {
            error: 'below_progress_needs_reason',
            last_progress_qty: rpcResult.last_progress_qty,
          },
          { status: 409 },
        );
      // 확정 불량보다 작은 output 재마감 — 데이터 불변조건(defect ≤ output) 보호.
      if (rpcResult?.reason === 'output_lt_defect')
        return NextResponse.json(
          { error: 'output_qty is less than confirmed defect_qty', defect_qty: rpcResult.defect_qty },
          { status: 409 },
        );
      // 지표를 계산하는 사이 비가동이 바뀌었다. 낡은 값을 확정 저장하지 않고 되묻는다 —
      // 클라이언트가 재시도하면 새 원천으로 다시 계산된다.
      if (rpcResult?.reason === 'source_changed')
        return NextResponse.json(
          { error: 'downtime source changed during close', retryable: true },
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
