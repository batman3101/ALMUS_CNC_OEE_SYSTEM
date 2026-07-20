import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/production-records/[recordId]/defect — 다음날 불량 입력 → 확정.
 * avail·perf 스냅샷은 유지, quality/oee 만 파생 재계산. (미검사 NULL → 확정)
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ recordId: string }> }) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { recordId } = await ctx.params;
    const body = await request.json() as { defect_qty?: unknown };
    const defect = typeof body.defect_qty === 'number' ? body.defect_qty : Number.NaN;
    if (!Number.isInteger(defect) || defect < 0)
      return NextResponse.json({ error: 'defect_qty must be a non-negative integer' }, { status: 400 });

    const { data: rec, error: readErr } = await supabaseAdmin
      .from('production_records')
      .select('record_id, machine_id')
      .eq('record_id', recordId).maybeSingle();
    if (readErr) return NextResponse.json({ error: 'Failed to read record' }, { status: 500 });
    if (!rec) return NextResponse.json({ error: 'record not found' }, { status: 404 });

    // 담당 설비 검사 — record_id 만으로 남의 설비 실적을 조작하지 못하게 한다(형제 라우트와 동일 기준).
    // (record 의 machine_id 는 불변이라 이 선행 읽기로 충분하다)
    assertMachineAccess(user, rec.machine_id);

    // 검증·quality/oee 파생·갱신은 RPC 가 advisory lock(machine·date·shift, 재마감과 동일 키)
    // 아래에서 원자적으로 한다 — 앱에서 읽고 쓰면 재마감과 경쟁해 확정 불량이 유실된다(TOCTOU).
    const { data: rpcData, error: rpcErr } = await supabaseAdmin
      .rpc('confirm_shift_defect', { p_record_id: recordId, p_defect: defect });
    if (rpcErr) return NextResponse.json({ error: 'Failed to update defect' }, { status: 500 });

    const r = rpcData as { ok: boolean; reason?: string } | null;
    if (!r?.ok) {
      if (r?.reason === 'exceeds_output')
        return NextResponse.json({ error: 'defect_qty must not exceed output_qty' }, { status: 400 });
      if (r?.reason === 'not_found')
        return NextResponse.json({ error: 'record not found' }, { status: 404 });
      return NextResponse.json({ error: 'Failed to update defect' }, { status: 500 });
    }
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
