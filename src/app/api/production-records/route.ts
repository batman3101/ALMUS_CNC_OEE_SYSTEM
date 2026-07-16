import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getBreakTimeMinutes, resolvePlannedRuntime } from '@/lib/plannedRuntime';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';
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
    minutesPerUnit: params.tactSeconds / 60 / Math.max(1, params.cavity),
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

    // 기본 쿼리 생성
    let query = supabaseAdmin
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

    // 필터 적용
    if (machineId) {
      query = query.eq('machine_id', machineId);
    } else if (authenticatedUser.role === 'operator') {
      if (authenticatedUser.assignedMachineIds.length === 0) {
        return NextResponse.json({
          records: [],
          shift_states: [],
          pagination: { page, limit, total: 0, pages: 0 }
        });
      }
      query = query.in('machine_id', authenticatedUser.assignedMachineIds);
    }

    if (startDate) {
      query = query.gte('date', startDate);
    }

    if (endDate) {
      query = query.lte('date', endDate);
    }

    if (shift) {
      query = query.eq('shift', shift);
    }

    // 페이지네이션 적용
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data: records, error, count } = await query;

    if (error) {
      console.error('Error fetching production records:', error);
      
      // 테이블이 없는 경우 빈 배열 반환
      if (error.code === '42P01') {
        return NextResponse.json({
          records: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0
          }
        });
      }
      
      throw error;
    }

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
        quality: Math.round(metrics.quality * 10000) / 10000,
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
