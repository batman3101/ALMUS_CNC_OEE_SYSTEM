import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getBreakTimeMinutes, resolvePlannedRuntime } from '@/lib/plannedRuntime';
import { apiAuthErrorResponse, assertMachineAccess } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { chunkIdsForInFilter } from '@/lib/idFilter';
import {
  calculateOeeMetrics,
  DEFAULT_CAVITY,
  DEFAULT_TACT_SECONDS,
  resolveActualRuntime,
} from './oeeRules';

// 수량 검증: 정수 & 0 이상 & 불량 수량 <= 생산 수량
function validateQuantities(outputQty: unknown, defectQty: unknown): string | null {
  if (!Number.isInteger(outputQty) || (outputQty as number) < 0) {
    return '생산 수량(output_qty)은 0 이상의 정수여야 합니다';
  }
  if (!Number.isInteger(defectQty) || (defectQty as number) < 0) {
    return '불량 수량(defect_qty)은 0 이상의 정수여야 합니다';
  }
  if ((defectQty as number) > (outputQty as number)) {
    return '불량 수량(defect_qty)은 생산 수량(output_qty)보다 클 수 없습니다';
  }
  return null;
}

// OEE 지표 계산 (서버가 단일 진실 공급원)
// 계획 가동시간 = max(0, 가동시간 - 휴식시간(system_settings))
function calculateOEEMetrics(params: {
  operatingMinutes: number;
  breakMinutes: number;
  actualRuntime: number;
  outputQty: number;
  defectQty: number;
  tactSeconds: number;
  cavity: number;
}) {
  const plannedRuntime = resolvePlannedRuntime(params.operatingMinutes, params.breakMinutes);
  const actualRuntime = resolveActualRuntime(params.actualRuntime, plannedRuntime);
  const metrics = calculateOeeMetrics({
    plannedRuntime,
    actualRuntime: actualRuntime ?? 0,
    outputQty: params.outputQty,
    defectQty: params.defectQty,
    // tact 는 개당(1 piece) 가공시간이다. JIG 의 cavity 수는 이미 개당 t/t 에
    // 반영돼 있으므로 여기서 나누면 이중 반영이 된다 (oeeRules.ts 주석 참고).
    minutesPerUnit: params.tactSeconds / 60,
  });

  if (actualRuntime === null) {
    return {
      ...metrics,
      actualRuntime: null,
      availability: null,
      performance: null,
      oee: null,
    };
  }

  return metrics;
}

// GET /api/production-records - 생산 기록 목록 조회
export async function GET(request: NextRequest) {
  try {
    const authenticatedUser = await requireFactoryUser(request, ['admin', 'engineer', 'operator']);
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    // ✅ 파라미터 이름 통일: camelCase 사용
    const startDate = searchParams.get('startDate') || searchParams.get('start_date');
    const endDate = searchParams.get('endDate') || searchParams.get('end_date');
    const shift = searchParams.get('shift');
    /**
     * NG 확정 상태 필터. 다음날 불량 입력 업무의 작업 목록을 만드는 수단이다.
     *   pending   = `defect_qty IS NULL`     (미검사 — 오늘 처리해야 할 행)
     *   confirmed = `defect_qty IS NOT NULL` (0건 확정 포함, 검사 끝난 행)
     * 허용값이 아니면 400 — 오타를 조용히 무시하면 "필터가 걸린 줄 알았는데 전체"가 된다.
     */
    const defectStatus = searchParams.get('defect_status');
    if (defectStatus !== null && defectStatus !== 'pending' && defectStatus !== 'confirmed') {
      return NextResponse.json(
        { error: "defect_status must be 'pending' or 'confirmed'" },
        { status: 400 }
      );
    }
    const requestedPage = Number.parseInt(searchParams.get('page') || '1', 10);
    const requestedLimit = Number.parseInt(searchParams.get('limit') || '100', 10);
    const page = Number.isFinite(requestedPage) ? Math.max(1, requestedPage) : 1;
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(1000, Math.max(1, requestedLimit))
      : 100;

    if (machineId) assertMachineAccess(authenticatedUser, machineId);

    /**
     * 운영자 스코프를 여러 요청으로 나눠 보낸다.
     *
     * `.in('machine_id', 800개)` 는 URL 이 약 30 KB 가 되어 게이트웨이가 400 으로 거절한다
     * (근거는 `@/lib/idFilter`). 이 프로젝트의 운영자는 전원 800대를 배정받으므로
     * **이 라우트는 운영자에게 늘 500 이었다** — 생산 기록 관리 페이지가 열리지 않았다.
     *
     * 청크는 machine_id 로 나뉘어 **서로소**다. 그래서
     *   · 전체 건수 = 청크별 count 의 합 (중복 없음)
     *   · 어떤 청크의 k번째 행보다 앞설 수 있는 행은 각 청크의 앞쪽 k개뿐
     * 이 성립한다. 정렬이 (date desc, record_id desc) 로 **전순서**라 병합이 유일하게
     * 결정된다. 따라서 청크마다 앞에서 `page*limit` 개만 받아 병합·정렬한 뒤 잘라내면
     * 한 번에 조회한 것과 같은 결과가 나온다.
     *
     * 대가는 깊은 페이지에서 전송량이 청크 수만큼 늘어나는 것이다(청크 4개 · limit 100 ·
     * 1페이지 = 400행). 대안인 "Node 에서 전량 정렬"은 이 테이블이 32만 행이라 불가능하고,
     * RPC 로 옮기려면 마이그레이션이 필요하다.
     */
    const scopeChunks: Array<string[] | null> =
      !machineId && authenticatedUser.role === 'operator'
        ? chunkIdsForInFilter(authenticatedUser.assignedMachineIds)
        : [null];

    /**
     * 청크가 하나면 병합할 것이 없으므로 **요청한 페이지만** 받는다.
     *
     * 예전에는 청크 수와 무관하게 언제나 `range(0, page*limit-1)` 이었다. 바로 위 주석은
     * "스코프가 하나면 그 페이지만 받는다"고 적혀 있었는데 **코드가 그렇게 하지 않았다** —
     * 주석이 의도를 정확히 적어 두고도 구현이 따라가지 않은 채, 그 주석이 문제를 가리고
     * 있었다(감사 정정 #1).
     *
     * 결과는 두 가지였다. 328페이지를 열면 32,736행을 전송해 100행만 남기고 버렸고,
     * `page*limit` 이 PostgREST 의 `max-rows`(100,000)를 넘으면 실제 데이터가 남아 있어도
     * 뒷 페이지가 **조용히 빈 배열**이 됐다. 현재 행 수에서는 후자가 발현하지 않지만,
     * 하루 약 1,423행씩 늘고 있어 시간 문제다.
     *
     * 청크가 여럿일 때(운영자 담당 설비 800대 분할 조회)는 누적 조회가 **정확성의 조건**이다.
     * 어느 청크가 N페이지에 얼마나 기여하는지는 앞에서부터 읽어야만 알 수 있기 때문이다.
     * 그 경우에만 대가를 치른다.
     */
    const singleScope = scopeChunks.length === 1;
    const pageStart = (page - 1) * limit;
    const pageEnd = page * limit - 1;

    const buildQuery = (scope: string[] | null) => {
      let q = supabaseAdmin
        .from('production_records')
        .select(`
          *,
          machines!inner(
            id,
            name,
            location
          )
        `, { count: 'exact' })
      .eq('factory_id', authenticatedUser.factoryId)
        .order('date', { ascending: false })
        // (machine_id, date, shift)가 유니크하므로 date만으로는 정렬이 불안정함 → record_id로 tiebreak
        .order('record_id', { ascending: false });
      if (scope) q = q.in('machine_id', scope);
      if (machineId) q = q.eq('machine_id', machineId);
      if (startDate) q = q.gte('date', startDate);
      if (endDate) q = q.lte('date', endDate);
      if (shift) q = q.eq('shift', shift);
      // NULL 비교는 `.eq()` 로 되지 않는다(SQL 에서 `col = NULL` 은 NULL). `.is()` 를 써야 한다.
      if (defectStatus === 'pending') q = q.is('defect_qty', null);
      else if (defectStatus === 'confirmed') q = q.not('defect_qty', 'is', null);
      // 청크가 하나면 DB 가 페이지를 잘라 준다. 여럿이면 병합을 위해 앞에서부터 받는다.
      return singleScope ? q.range(pageStart, pageEnd) : q.range(0, pageEnd);
    };

    if (!machineId && authenticatedUser.role === 'operator' && scopeChunks.length === 0) {
      return NextResponse.json({
        records: [],
        shift_states: [],
        pagination: { page, limit, total: 0, pages: 0 }
      });
    }

    const pages = await Promise.all(scopeChunks.map(scope => buildQuery(scope)));

    const tableMissing = pages.find(p => p.error?.code === '42P01');
    if (tableMissing) {
      return NextResponse.json({
        records: [],
        pagination: { page, limit, total: 0, pages: 0 }
      });
    }
    const failed = pages.find(p => p.error);
    if (failed) {
      console.error('Error fetching production records:', failed.error);
      throw failed.error;
    }

    const count = pages.reduce((sum, p) => sum + (p.count ?? 0), 0);
    // 청크가 하나면 정렬은 DB 가 이미 끝냈다. 여럿일 때만 병합한다 — 비교 함수는 DB 의
    // ORDER BY (date desc, record_id desc)와 **같은 말**이어야 한다. 달라지면 페이지 경계에서
    // 행이 사라지거나 중복된다.
    const merged = pages.flatMap(p => p.data ?? []);
    if (scopeChunks.length > 1) {
      merged.sort((a, b) =>
        a.date === b.date
          ? String(b.record_id).localeCompare(String(a.record_id))
          : String(b.date).localeCompare(String(a.date))
      );
    }
    // 청크가 하나면 DB 가 이미 이 페이지만 돌려줬다 — 여기서 또 자르면 2페이지부터
    // 빈 배열이 된다(자르기가 두 번 적용됨). 여럿일 때만 병합 결과에서 잘라낸다.
    const records = singleScope ? merged : merged.slice(pageStart, page * limit);

    // ✅ 실제 Supabase 데이터 그대로 반환 (OEE 필드 포함)
    const formattedRecords = (records || []).map(record => ({
      record_id: record.record_id,  // Supabase의 primary key
      machine_id: record.machine_id,
      date: record.date,
      shift: record.shift,
      planned_runtime: record.planned_runtime ?? null,
      actual_runtime: record.actual_runtime ?? null,
      ideal_runtime: record.ideal_runtime ?? null,
      output_qty: record.output_qty || 0,
      /**
       * 미검사(NULL)를 0 으로 접지 않는다.
       *
       * 교대 마감은 `output_qty` 만 확정하고 `defect_qty` 는 NULL 로 남긴다 — 다음날 검사
       * 결과가 나와야 확정할 수 있기 때문이다(2단계 확정 모델). 그런데 이 줄이 그 NULL 을
       * 0 으로 바꿔 보내면 **브라우저는 "불량 0건 확정"과 "아직 안 셌다"를 영영 구분할 수
       * 없다** — 프런트에서 되살릴 방법이 없다.
       *
       * 표시만 틀리는 게 아니었다. 목록의 수정 모달은 이 값을 그대로 prefill 하므로,
       * 미검사 행에서 생산량만 고쳐 저장해도 `defect_qty: 0` 이 함께 전송되고 서버는 그것을
       * **명시적 0 확정**으로 해석해 quality/OEE 까지 계산해 버렸다. 검사하지 않은 교대가
       * 조용히 "불량 0건, 품질 100%"로 확정되는 경로였다.
       *
       * 바로 아래 availability/performance/quality/oee 가 이미 `?? null` 인 것과 같은 규약이다.
       */
      defect_qty: record.defect_qty ?? null,
      // ✅ OEE 관련 필드 추가 (Supabase에 저장된 실제 값)
      availability: record.availability ?? null,
      performance: record.performance ?? null,
      quality: record.quality ?? null,
      oee: record.oee ?? null,
      created_at: record.created_at,
      machine: record.machines
    }));

    let shiftStates: Array<{ shift: 'A' | 'B'; status: 'WORKING' | 'OFF' | 'HOLIDAY' | 'MISSING'; version: number }> = [];
    if (machineId && startDate && endDate && startDate === endDate) {
      const { data, error: shiftStateError } = await supabaseAdmin
        .from('production_shift_states')
        .select('shift, status, version')
      .eq('factory_id', authenticatedUser.factoryId)
        .eq('machine_id', machineId)
        .eq('date', startDate)
        .in('shift', ['A', 'B']);
      if (shiftStateError && shiftStateError.code !== '42P01') throw shiftStateError;
      shiftStates = (data || []) as typeof shiftStates;
    }

    return NextResponse.json({
      records: formattedRecords,
      shift_states: shiftStates,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error fetching production records:', error);
    return NextResponse.json(
      { error: 'Failed to fetch production records' },
      { status: 500 }
    );
  }
}

// POST /api/production-records - 새 생산 기록 생성
export async function POST(request: NextRequest) {
  try {
    const authenticatedUser = await requireFactoryUser(request, ['admin', 'engineer', 'operator']);
    const body = await request.json();
    const {
      machine_id,
      date,
      shift,
      output_qty,
      defect_qty,
      actual_runtime,
      planned_runtime
    } = body;

    // 필수 필드 검증
    if (!machine_id || !date || !shift) {
      return NextResponse.json(
        { error: 'Machine ID, date, and shift are required' },
        { status: 400 }
      );
    }

    assertMachineAccess(authenticatedUser, machine_id);

    // 수량 검증 (정수 & 0 이상 & 불량 <= 생산)
    const outputQtyValue = output_qty ?? 0;
    const defectQtyValue = defect_qty ?? 0;
    const validationError = validateQuantities(outputQtyValue, defectQtyValue);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    // 설비 존재 확인
    const { data: machine, error: machineError } = await supabaseAdmin
      .from('machines')
      .select('id, is_active')
      .eq('factory_id', authenticatedUser.factoryId)
      .eq('id', machine_id)
      .single();

    if (machineError || !machine) {
      return NextResponse.json(
        { error: 'Machine not found' },
        { status: 404 }
      );
    }
    if (!machine.is_active) {
      return NextResponse.json(
        { error: 'Inactive machines cannot receive production records' },
        { status: 409 }
      );
    }

    // 설비의 현재 공정 기준 Tact Time / Cavity 조회 (서버 기준값)
    const { data: productionInfo } = await supabaseAdmin
      .from('machines_with_production_info')
      .select('current_tact_time, current_cavity_count')
      // tact 는 OEE 의 분자다(ideal_runtime = output_qty × tact / 60). 남의 공장 tact 로
      // 계산된 성능은 틀렸다는 표시 없이 스냅샷으로 박힌다 — 나중에 고쳐도 그 행은 남는다.
      .eq('factory_id', authenticatedUser.factoryId)
      .eq('id', machine_id)
      .maybeSingle();

    const processStandardKnown = Boolean(
      productionInfo?.current_tact_time && productionInfo.current_tact_time > 0 &&
      productionInfo?.current_cavity_count && productionInfo.current_cavity_count > 0
    );
    const tactSeconds =
      productionInfo?.current_tact_time && productionInfo.current_tact_time > 0
        ? productionInfo.current_tact_time
        : DEFAULT_TACT_SECONDS;
    const cavity =
      productionInfo?.current_cavity_count && productionInfo.current_cavity_count > 0
        ? productionInfo.current_cavity_count
        : DEFAULT_CAVITY;

    // OEE 계산 (계획 가동시간 = 가동시간 - 휴식시간, Cavity 반영, 0~1 클램프)
    // 요청의 planned_runtime 은 교대 가동시간(분)으로 해석하며, 미전송 시 12시간(720분)을 사용한다.
    const breakMinutes = await getBreakTimeMinutes(authenticatedUser.factoryId);
    const metrics = calculateOEEMetrics({
      operatingMinutes: Number(planned_runtime),
      breakMinutes,
      actualRuntime: actual_runtime,
      outputQty: outputQtyValue,
      defectQty: defectQtyValue,
      tactSeconds,
      cavity
    });

    // production_records 테이블에 실제 데이터 삽입
    const { data: newRecord, error: insertError } = await supabaseAdmin
      .from('production_records')
      .insert({
        factory_id: authenticatedUser.factoryId,
        machine_id,
        date,
        shift,
        planned_runtime: Math.round(metrics.plannedRuntime),
        actual_runtime: metrics.actualRuntime === null ? null : Math.round(metrics.actualRuntime),
        ideal_runtime: processStandardKnown ? Math.round(metrics.idealRuntime) : null,
        output_qty: outputQtyValue,
        defect_qty: defectQtyValue,
        downtime_minutes: metrics.actualRuntime === null
          ? null
          : Math.max(0, Math.round(metrics.plannedRuntime - metrics.actualRuntime)),
        tact_time_seconds: processStandardKnown ? tactSeconds : null,
        cavity_count: processStandardKnown ? cavity : null,
        availability: metrics.availability === null ? null : Math.round(metrics.availability * 10000) / 10000, // 소수점 4자리
        performance: !processStandardKnown || metrics.performance === null
          ? null
          : Math.round(metrics.performance * 10000) / 10000,
        quality: metrics.quality === null ? null : Math.round(metrics.quality * 10000) / 10000,
        oee: !processStandardKnown || metrics.oee === null
          ? null
          : Math.round(metrics.oee * 10000) / 10000
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting production record:', insertError);
      throw insertError;
    }

    return NextResponse.json({
      success: true,
      record: newRecord
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error creating production record:', error);
    return NextResponse.json(
      { error: 'Failed to create production record' },
      { status: 500 }
    );
  }
}
