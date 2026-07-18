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
      .select('record_id, machine_id, output_qty, availability, performance')
      .eq('record_id', recordId).maybeSingle();
    if (readErr) return NextResponse.json({ error: 'Failed to read record' }, { status: 500 });
    if (!rec) return NextResponse.json({ error: 'record not found' }, { status: 404 });

    // 담당 설비 검사 — record_id 만으로 남의 설비 실적을 조작하지 못하게 한다(형제 라우트와 동일 기준).
    assertMachineAccess(user, rec.machine_id);

    if (defect > rec.output_qty)
      return NextResponse.json({ error: 'defect_qty must not exceed output_qty' }, { status: 400 });

    const quality = rec.output_qty > 0 ? Math.min(Math.max((rec.output_qty - defect) / rec.output_qty, 0), 1) : 0;
    // avail·perf 가 null(런타임 미보고)이면 oee 도 null 로 남긴다.
    const oee = rec.availability === null || rec.performance === null
      ? null : rec.availability * rec.performance * quality;

    const { error: updErr } = await supabaseAdmin
      .from('production_records')
      .update({ defect_qty: defect, quality, oee })
      .eq('record_id', recordId);
    if (updErr) return NextResponse.json({ error: 'Failed to update defect' }, { status: 500 });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
