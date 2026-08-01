import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getBreakTimeMinutes, resolvePlannedRuntime } from '@/lib/plannedRuntime';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';
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
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    // ✅ 파라미터 이름 통일: camelCase 사용
    const startDate = searchParams.get('startDate') || searchParams.get('start_date');
    const endDate = searchParams.get('endDate') || searchParams.get('end_date');
    const shift = searchParams.get('shift');
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
        .order('date', { ascending: false })
        // (machine_id, date, shift)가 유니크하므로 date만으로는 정렬이 불안정함 → record_id로 tiebreak
        .order('record_id', { ascending: false });
      if (scope) q = q.in('machine_id', scope);
      if (machineId) q = q.eq('machine_id', machineId);
      if (startDate) q = q.gte('date', startDate);
      if (endDate) q = q.lte('date', endDate);
      if (shift) q = q.eq('shift', shift);
      // 청크마다 **앞에서부터** 이 페이지에 닿을 수 있는 만큼만 받는다. 스코프가 하나면
      // (관리자·엔지니어·설비 지정) 청크가 1개라 예전과 똑같이 그 페이지만 받는다.
      return q.range(0, page * limit - 1);
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
    const records = merged.slice((page - 1) * limit, page * limit);

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
      defect_qty: record.defect_qty || 0,
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
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
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
    const breakMinutes = await getBreakTimeMinutes();
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
