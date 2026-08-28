import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { chunkIdsForInFilter } from '@/lib/idFilter';
import {
  InvalidQueueSortError,
  buildQueueComparator,
  parseQueueSort,
} from './queueSort';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** 기본 조회 창(일). 종이 전사는 며칠 내가 현실이라 짧게 잡고, 필요하면 늘려서 부른다. */
const DEFAULT_WINDOW_DAYS = 7;
/** 허용 최대 창(일). `pending` 라우트의 현장 콘솔 창과 같은 상한이다. */
const MAX_WINDOW_DAYS = 90;
/**
 * 한 번에 훑을 원천 행 상한.
 *
 * 마감대기는 "진척은 있는데 확정 record 가 없는 교대"라 두 테이블의 **차집합**이다. SQL 로
 * 밀어 넣으려면 새 RPC(=마이그레이션)가 필요하고, 그건 별도 승인 대상이라 여기서는 창을
 * 좁게 잡고 상한을 **명시적으로** 둔다.
 *
 * 상한에 닿으면 조용히 자르지 않고 `truncated: true` 를 실어 보낸다 — 보이지 않는 절단은
 * 정확성 버그이고, 보이는 절단은 그냥 페이지다(PostgREST 무음 절단에서 얻은 교훈).
 */
const SCAN_CAP = 20_000;

/**
 * GET /api/production-records/close-queue — 전사 교대 마감 대기 큐.
 *
 * 현장 콘솔의 `pending` 은 **설비 한 대**만 본다. 전사 760건을 처리하려면 설비를 계속 바꿔야
 * 했다(감사 P1-2). 이 라우트는 같은 정의(진척 있음 ∧ 확정 record 없음)를 설비 경계 없이
 * 계산하고 서버에서 페이지네이션한다.
 *
 * 마감 **쓰기**는 여기서 하지 않는다 — 기존 `close-shift` 라우트와 `close_shift_upsert_v3`
 * RPC 를 그대로 쓴다. 두 번째 쓰기 경로를 만들지 않는다는 원칙이다.
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer', 'operator']);
    const { searchParams } = new URL(request.url);

    const machineId = searchParams.get('machine_id');
    const shift = searchParams.get('shift');
    if (shift !== null && shift !== 'A' && shift !== 'B') {
      return NextResponse.json({ error: "shift must be 'A' or 'B'" }, { status: 400 });
    }
    if (machineId !== null && !UUID.test(machineId)) {
      return NextResponse.json({ error: 'machine_id must be a UUID' }, { status: 400 });
    }
    if (machineId) assertMachineAccess(user, machineId);

    /**
     * 정렬. 대기 목록 **전체**에 적용된다(아래에서 정렬한 뒤 페이지를 자른다).
     * 허용 목록과 비교 규칙은 `./queueSort` 한 곳에만 있다.
     */
    let sortSpec;
    try {
      sortSpec = parseQueueSort(searchParams.get('sort'), searchParams.get('order'));
    } catch (sortError) {
      if (sortError instanceof InvalidQueueSortError) {
        return NextResponse.json({ error: sortError.message }, { status: 400 });
      }
      throw sortError;
    }

    const endParam = searchParams.get('endDate');
    const startParam = searchParams.get('startDate');
    if ((endParam && !DATE.test(endParam)) || (startParam && !DATE.test(startParam))) {
      return NextResponse.json({ error: 'dates must be YYYY-MM-DD' }, { status: 400 });
    }

    const endDate = endParam ?? new Date().toISOString().slice(0, 10);
    const defaultStart = new Date(`${endDate}T00:00:00Z`);
    defaultStart.setUTCDate(defaultStart.getUTCDate() - (DEFAULT_WINDOW_DAYS - 1));
    const startDate = startParam ?? defaultStart.toISOString().slice(0, 10);

    if (startDate > endDate) {
      return NextResponse.json({ error: 'startDate must not be after endDate' }, { status: 400 });
    }
    const spanDays =
      Math.floor((Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86_400_000) + 1;
    if (spanDays > MAX_WINDOW_DAYS) {
      return NextResponse.json(
        { error: `date range must not exceed ${MAX_WINDOW_DAYS} days` },
        { status: 400 }
      );
    }

    const requestedPage = Number.parseInt(searchParams.get('page') || '1', 10);
    const requestedLimit = Number.parseInt(searchParams.get('limit') || '20', 10);
    const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
    const limit = Number.isFinite(requestedLimit) ? Math.min(100, Math.max(1, requestedLimit)) : 20;

    /**
     * 운영자 스코프는 `.in()` 을 청크로 나눠 건다 — 800개 id 를 한 URL 에 넣으면 게이트웨이가
     * 400 으로 거절한다(`@/lib/idFilter`). 관리자·엔지니어는 스코프 없음(null 한 청크).
     */
    const scopeChunks: Array<string[] | null> =
      !machineId && user.role === 'operator'
        ? chunkIdsForInFilter(user.assignedMachineIds)
        : [null];

    if (!machineId && user.role === 'operator' && scopeChunks.length === 0) {
      return NextResponse.json({
        items: [], pagination: { page, limit, total: 0, pages: 0 },
        window: { startDate, endDate }, truncated: false,
      });
    }

    const applyScope = <T extends { in: (c: string, v: string[]) => T; eq: (c: string, v: string) => T }>(
      q: T, scope: string[] | null
    ): T => {
      let out = q;
      if (scope) out = out.in('machine_id', scope);
      if (machineId) out = out.eq('machine_id', machineId);
      if (shift) out = out.eq('shift', shift);
      return out;
    };

    const progressPages = await Promise.all(scopeChunks.map(scope => applyScope(
      supabaseAdmin
        .from('production_progress_reports')
        .select('machine_id, date, shift, shift_output_qty')
      .eq('factory_id', user.factoryId)
        .gte('date', startDate).lte('date', endDate)
        .limit(SCAN_CAP),
      scope
    )));
    const recordPages = await Promise.all(scopeChunks.map(scope => applyScope(
      supabaseAdmin
        .from('production_records')
        .select('machine_id, date, shift')
      .eq('factory_id', user.factoryId)
        .gte('date', startDate).lte('date', endDate)
        .limit(SCAN_CAP),
      scope
    )));

    const failed = [...progressPages, ...recordPages].find(p => p.error);
    if (failed) {
      console.error('마감 대기 큐 조회 오류:', failed.error);
      return NextResponse.json({ error: 'Failed to read close queue' }, { status: 500 });
    }

    const progressRows = progressPages.flatMap(p => p.data ?? []);
    const recordRows = recordPages.flatMap(p => p.data ?? []);
    // 어느 한쪽이라도 상한에 닿았다면 차집합이 불완전할 수 있다 — 숨기지 않고 알린다.
    const truncated =
      progressPages.some(p => (p.data?.length ?? 0) >= SCAN_CAP) ||
      recordPages.some(p => (p.data?.length ?? 0) >= SCAN_CAP);

    const closedKeys = new Set(recordRows.map(r => `${r.machine_id}|${r.date}|${r.shift}`));

    // 교대별 마지막(=최대, 단조증가) 진척값 — 마감 입력칸 prefill 용.
    const lastQty = new Map<string, number>();
    for (const p of progressRows) {
      const key = `${p.machine_id}|${p.date}|${p.shift}`;
      const prev = lastQty.get(key);
      if (prev === undefined || p.shift_output_qty > prev) lastQty.set(key, p.shift_output_qty);
    }

    const pendingKeys = [...lastQty.keys()].filter(k => !closedKeys.has(k));

    // 설비명은 대기 항목에 실제로 등장하는 id 만 조회한다(전체 설비를 끌어오지 않는다).
    const machineIds = [...new Set(pendingKeys.map(k => k.split('|')[0]))];
    const namePages = await Promise.all(
      chunkIdsForInFilter(machineIds).map(chunk =>
        supabaseAdmin.from('machines').select('id, name')
      .eq('factory_id', user.factoryId).in('id', chunk))
    );
    const nameById = new Map<string, string>();
    for (const p of namePages) for (const m of p.data ?? []) nameById.set(m.id, m.name);

    const items = pendingKeys.map(key => {
      const [mId, date, s] = key.split('|');
      return {
        machine_id: mId,
        machine_name: nameById.get(mId) ?? 'Unknown',
        date,
        shift: s as 'A' | 'B',
        last_qty: lastQty.get(key) ?? null,
      };
    });

    // 기본은 오래된 교대 먼저. 어떤 정렬을 고르든 마지막 기준은 (date, shift, machine_id)
    // 라 안정 전순서다 — 그래야 폴링·페이지 이동 중에 행이 튀지 않는다.
    items.sort(buildQueueComparator(sortSpec.field, sortSpec.direction));

    const total = items.length;
    const start = (page - 1) * limit;

    return NextResponse.json({
      items: items.slice(start, start + limit),
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      window: { startDate, endDate },
      truncated,
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error in GET /api/production-records/close-queue:', error);
    return NextResponse.json({ error: 'Failed to read close queue' }, { status: 500 });
  }
}
