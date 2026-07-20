import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 백로그는 최근 창으로 바운드한다 — 비바운드 스캔(PostgREST 10만행 무음 절단 + Node 집계) 방지.
// 종이 전사는 며칠 내가 현실이라 90일은 넉넉하다. 더 오래 미마감된 교대는 관리자 백필 대상이며,
// 콘솔이 대상 교대를 직접 선택해 마감하는 경로를 이미 제공한다(백로그는 nudge, 유일 경로 아님).
const BACKLOG_WINDOW_DAYS = 90;

/**
 * GET /api/production-records/pending?machine_id= — 마감/불량 백로그.
 * close_pending: 진척 보고(작업 증거) 있는 교대인데 확정 record 없음(마감 필요). 무기한(자동 마감 없음).
 * defect_pending: record 있으나 defect NULL(미검사, 다음날 불량 필요).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id') ?? '';
    if (!UUID.test(machineId)) return NextResponse.json({ error: 'machine_id is required' }, { status: 400 });
    assertMachineAccess(user, machineId);

    const cutoff = new Date(Date.now() - BACKLOG_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);

    // 마감대기: 진척 보고(작업 증거)가 있는 교대 중 확정 record 없는 것. progress_reports 기반이라
    // 자동 바운드된다(과거 전체가 뜨지 않음). production_shift_states.status='WORKING' 은 수천 행이라
    // 마감대기 도출에 쓰면 안 된다(실측). 종이값만 있는(진척 미입력) 교대는 콘솔에서 작업자가
    // 대상 교대를 직접 골라 마감한다(Plan 2 — 백로그는 nudge, 유일 경로 아님).
    const { data: progressed, error: pErr } = await supabaseAdmin
      .from('production_progress_reports')
      .select('date, shift, shift_output_qty').eq('machine_id', machineId).gte('date', cutoff);
    if (pErr) return NextResponse.json({ error: 'Failed to read progress' }, { status: 500 });

    const { data: records, error: rErr } = await supabaseAdmin
      .from('production_records')
      .select('date, shift, record_id, defect_qty').eq('machine_id', machineId).gte('date', cutoff);
    if (rErr) return NextResponse.json({ error: 'Failed to read records' }, { status: 500 });

    const recKeys = new Set((records ?? []).map(r => `${r.date}|${r.shift}`));
    // 교대별 마지막(=최대, 단조증가) 진척값 — 마감 UI prefill 용(스펙: "진척값 prefill + 원탭 확정").
    const lastQtyByKey = new Map<string, number>();
    for (const p of progressed ?? []) {
      const key = `${p.date}|${p.shift}`;
      const prev = lastQtyByKey.get(key);
      if (prev === undefined || p.shift_output_qty > prev) lastQtyByKey.set(key, p.shift_output_qty);
    }
    const seen = new Set<string>();
    const close_pending: { date: string; shift: string; last_qty: number }[] = [];
    for (const p of progressed ?? []) {
      const key = `${p.date}|${p.shift}`;
      if (!recKeys.has(key) && !seen.has(key)) {
        seen.add(key);
        close_pending.push({ date: p.date, shift: p.shift, last_qty: lastQtyByKey.get(key) ?? 0 });
      }
    }
    const defect_pending = (records ?? [])
      .filter(r => r.defect_qty === null)
      .map(r => ({ date: r.date, shift: r.shift, record_id: r.record_id }));

    return NextResponse.json({ close_pending, defect_pending });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
