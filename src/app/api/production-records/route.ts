import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// 기본값 (교대 12시간 = 720분)
const DEFAULT_PLANNED_RUNTIME = 720;
const DEFAULT_TACT_SECONDS = 120;
const DEFAULT_CAVITY = 1;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

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
function calculateOEEMetrics(params: {
  plannedRuntime: number;
  actualRuntime: number;
  outputQty: number;
  defectQty: number;
  tactSeconds: number;
  cavity: number;
}) {
  const plannedRuntime = params.plannedRuntime > 0 ? params.plannedRuntime : DEFAULT_PLANNED_RUNTIME;
  const actualRuntime = clamp(params.actualRuntime, 0, plannedRuntime);
  const idealRuntime = (params.outputQty / Math.max(1, params.cavity)) * params.tactSeconds / 60;

  const availability = plannedRuntime > 0 ? clamp(actualRuntime / plannedRuntime, 0, 1) : 0;
  const performance = actualRuntime > 0 ? clamp(idealRuntime / actualRuntime, 0, 1) : 0;
  const quality =
    params.outputQty > 0
      ? clamp((params.outputQty - params.defectQty) / params.outputQty, 0, 1)
      : 0;
  const oee = availability * performance * quality;

  return { plannedRuntime, actualRuntime, idealRuntime, availability, performance, quality, oee };
}

// GET /api/production-records - 생산 기록 목록 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    // ✅ 파라미터 이름 통일: camelCase 사용
    const startDate = searchParams.get('startDate') || searchParams.get('start_date');
    const endDate = searchParams.get('endDate') || searchParams.get('end_date');
    const shift = searchParams.get('shift');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '100');

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

    // 데이터가 없으면 빈 배열 반환 (Mock 데이터 생성 금지)
    // ✅ 필터 조건에 해당하는 전체 건수(count)는 그대로 반환 (페이지가 비어도 total 유지)
    if (!records || records.length === 0) {
      return NextResponse.json({
        records: [],
        pagination: {
          page,
          limit,
          total: count || 0,
          pages: Math.ceil((count || 0) / limit)
        }
      });
    }

    // ✅ 실제 Supabase 데이터 그대로 반환 (OEE 필드 포함)
    const formattedRecords = records.map(record => ({
      record_id: record.record_id,  // Supabase의 primary key
      machine_id: record.machine_id,
      date: record.date,
      shift: record.shift,
      planned_runtime: record.planned_runtime || 0,
      actual_runtime: record.actual_runtime || 0,
      ideal_runtime: record.ideal_runtime || 0,
      output_qty: record.output_qty || 0,
      defect_qty: record.defect_qty || 0,
      // ✅ OEE 관련 필드 추가 (Supabase에 저장된 실제 값)
      availability: record.availability || 0,
      performance: record.performance || 0,
      quality: record.quality || 0,
      oee: record.oee || 0,
      created_at: record.created_at,
      machine: record.machines
    }));

    return NextResponse.json({
      records: formattedRecords,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
      }
    });
  } catch (error) {
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
      .select('id')
      .eq('id', machine_id)
      .single();

    if (machineError || !machine) {
      return NextResponse.json(
        { error: 'Machine not found' },
        { status: 404 }
      );
    }

    // 설비의 현재 공정 기준 Tact Time / Cavity 조회 (서버 기준값)
    const { data: productionInfo } = await supabaseAdmin
      .from('machines_with_production_info')
      .select('current_tact_time, current_cavity_count')
      .eq('id', machine_id)
      .maybeSingle();

    const tactSeconds =
      productionInfo?.current_tact_time && productionInfo.current_tact_time > 0
        ? productionInfo.current_tact_time
        : DEFAULT_TACT_SECONDS;
    const cavity =
      productionInfo?.current_cavity_count && productionInfo.current_cavity_count > 0
        ? productionInfo.current_cavity_count
        : DEFAULT_CAVITY;

    // OEE 계산 (기본 계획시간 12시간 = 720분, Cavity 반영, 0~1 클램프)
    const metrics = calculateOEEMetrics({
      plannedRuntime: planned_runtime || DEFAULT_PLANNED_RUNTIME,
      actualRuntime: actual_runtime || 0,
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
        actual_runtime: Math.round(metrics.actualRuntime),
        ideal_runtime: Math.round(metrics.idealRuntime),
        output_qty: outputQtyValue,
        defect_qty: defectQtyValue,
        availability: Math.round(metrics.availability * 10000) / 10000, // 소수점 4자리
        performance: Math.round(metrics.performance * 10000) / 10000,
        quality: Math.round(metrics.quality * 10000) / 10000,
        oee: Math.round(metrics.oee * 10000) / 10000
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
    console.error('Error creating production record:', error);
    return NextResponse.json(
      { error: 'Failed to create production record' },
      { status: 500 }
    );
  }
}