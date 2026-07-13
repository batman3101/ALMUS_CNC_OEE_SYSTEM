import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// 기본값 (교대 12시간 = 720분)
const DEFAULT_PLANNED_RUNTIME = 720;
const DEFAULT_TACT_SECONDS = 120;
const DEFAULT_CAVITY = 1;

// 교대별 입력 데이터 (클라이언트 폼에서 전송)
interface ShiftInputData {
  actual_production: number;
  defect_quantity: number;
  operating_minutes: number;
  total_downtime_minutes: number;
}

interface DailyProductionRequest {
  machine_id: string;
  date: string;
  day_shift_off?: boolean;
  night_shift_off?: boolean;
  day_shift?: ShiftInputData;
  night_shift?: ShiftInputData;
}

interface SavedRecord {
  record_id: string;
  [key: string]: unknown;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

const toNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0;

// 수량 검증: 정수 & 0 이상 & 불량 수량 <= 생산 수량
function validateQuantities(
  shiftName: string,
  outputQty: unknown,
  defectQty: unknown
): string | null {
  if (!Number.isInteger(outputQty) || (outputQty as number) < 0) {
    return `${shiftName} 생산 수량은 0 이상의 정수여야 합니다`;
  }
  if (!Number.isInteger(defectQty) || (defectQty as number) < 0) {
    return `${shiftName} 불량 수량은 0 이상의 정수여야 합니다`;
  }
  if ((defectQty as number) > (outputQty as number)) {
    return `${shiftName} 불량 수량은 생산 수량보다 클 수 없습니다`;
  }
  return null;
}

// 교대별 OEE 지표 계산 (서버가 단일 진실 공급원 - 클라이언트 값 무시)
function calculateShiftMetrics(params: {
  operatingMinutes: number;
  downtimeMinutes: number;
  outputQty: number;
  defectQty: number;
  tactSeconds: number;
  cavity: number;
}) {
  const plannedRuntime =
    params.operatingMinutes > 0 ? params.operatingMinutes : DEFAULT_PLANNED_RUNTIME;
  const downtime = clamp(params.downtimeMinutes, 0, plannedRuntime);
  const actualRuntime = Math.max(0, plannedRuntime - downtime);
  const idealRuntime =
    (params.outputQty / Math.max(1, params.cavity)) * params.tactSeconds / 60;

  const availability = plannedRuntime > 0 ? clamp(actualRuntime / plannedRuntime, 0, 1) : 0;
  const performance = actualRuntime > 0 ? clamp(idealRuntime / actualRuntime, 0, 1) : 0;
  const quality =
    params.outputQty > 0
      ? clamp((params.outputQty - params.defectQty) / params.outputQty, 0, 1)
      : 0;
  const oee = availability * performance * quality;

  return { plannedRuntime, actualRuntime, idealRuntime, availability, performance, quality, oee };
}

// POST /api/production-records/daily - 일일 생산 데이터 저장
export async function POST(request: NextRequest) {
  try {
    console.log('POST /api/production-records/daily called');

    const body: DailyProductionRequest = await request.json();
    console.log('Received daily production data:', body);

    const {
      machine_id,
      date,
      day_shift,
      day_shift_off,
      night_shift,
      night_shift_off
    } = body;

    // 필수 필드 검증
    if (!machine_id || !date) {
      return NextResponse.json(
        {
          success: false,
          error: 'Machine ID and date are required'
        },
        { status: 400 }
      );
    }

    // 수량 검증 (휴무가 아닌 교대만)
    if (day_shift && !day_shift_off) {
      const error = validateQuantities('주간조', day_shift.actual_production, day_shift.defect_quantity);
      if (error) {
        return NextResponse.json({ success: false, error }, { status: 400 });
      }
    }

    if (night_shift && !night_shift_off) {
      const error = validateQuantities('야간조', night_shift.actual_production, night_shift.defect_quantity);
      if (error) {
        return NextResponse.json({ success: false, error }, { status: 400 });
      }
    }

    // 설비 존재 확인
    const { data: machine, error: machineError } = await supabaseAdmin
      .from('machines')
      .select('id, name')
      .eq('id', machine_id)
      .single();

    if (machineError || !machine) {
      console.error('Machine not found:', machineError);
      return NextResponse.json(
        {
          success: false,
          error: 'Machine not found'
        },
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

    const savedRecords: SavedRecord[] = [];
    const deletedShifts: ('A' | 'B')[] = [];

    // 휴무 교대는 기존 기록 삭제
    const deleteShiftRecord = async (shift: 'A' | 'B') => {
      const { data: deleted, error: deleteError } = await supabaseAdmin
        .from('production_records')
        .delete()
        .eq('machine_id', machine_id)
        .eq('date', date)
        .eq('shift', shift)
        .select('record_id');

      if (deleteError) {
        console.error(`Error deleting ${shift} shift record:`, deleteError);
        throw new Error(`${shift} 교대 기록 삭제 실패: ${deleteError.message}`);
      }

      if (deleted && deleted.length > 0) {
        deletedShifts.push(shift);
        console.log(`Deleted ${deleted.length} record(s) for shift ${shift}`);
      }
    };

    // 교대별 기록 저장 (서버에서 지표 재계산)
    const saveShiftRecord = async (shift: 'A' | 'B', shiftData: ShiftInputData) => {
      const outputQty = shiftData.actual_production;
      const defectQty = shiftData.defect_quantity;

      const metrics = calculateShiftMetrics({
        operatingMinutes: toNumber(shiftData.operating_minutes),
        downtimeMinutes: toNumber(shiftData.total_downtime_minutes),
        outputQty,
        defectQty,
        tactSeconds,
        cavity
      });

      const record = {
        machine_id,
        date,
        shift,
        planned_runtime: Math.round(metrics.plannedRuntime),
        actual_runtime: Math.round(metrics.actualRuntime),
        ideal_runtime: Math.round(metrics.idealRuntime),
        output_qty: outputQty,
        defect_qty: defectQty,
        availability: Math.round(metrics.availability * 10000) / 10000, // 소수점 4자리
        performance: Math.round(metrics.performance * 10000) / 10000,
        quality: Math.round(metrics.quality * 10000) / 10000,
        oee: Math.round(metrics.oee * 10000) / 10000
      };

      const { data: savedRecord, error: saveError } = await supabaseAdmin
        .from('production_records')
        .upsert(record, {
          onConflict: 'machine_id,date,shift',
          ignoreDuplicates: false
        })
        .select()
        .single();

      if (saveError) {
        console.error(`Error saving ${shift} shift data:`, saveError);
        throw new Error(`${shift === 'A' ? '주간' : '야간'} 교대 데이터 저장 실패: ${saveError.message}`);
      }

      savedRecords.push(savedRecord);
      console.log(`${shift} shift record saved:`, savedRecord.record_id);
    };

    // 주간 교대 (A): 휴무면 삭제, 아니면 저장
    if (day_shift_off) {
      await deleteShiftRecord('A');
    } else if (day_shift) {
      await saveShiftRecord('A', day_shift);
    }

    // 야간 교대 (B): 휴무면 삭제, 아니면 저장
    if (night_shift_off) {
      await deleteShiftRecord('B');
    } else if (night_shift) {
      await saveShiftRecord('B', night_shift);
    }

    console.log(
      `Saved ${savedRecords.length} / deleted ${deletedShifts.length} production records for machine ${machine.name} on ${date}`
    );

    // 양쪽 교대조 모두 휴무인 경우
    const isHoliday = Boolean(day_shift_off && night_shift_off);

    if (isHoliday) {
      return NextResponse.json({
        success: true,
        message: `${date} - 주간조/야간조 모두 휴무로 설정되어 생산 기록이 저장되지 않았습니다.`,
        records_saved: 0,
        record_ids: [],
        deleted_shifts: deletedShifts,
        machine_name: machine.name,
        date: date,
        is_holiday: true
      });
    }

    // 성공 응답
    return NextResponse.json({
      success: true,
      message: `일일 생산 데이터가 성공적으로 저장되었습니다 (${savedRecords.length}개 레코드)`,
      records_saved: savedRecords.length,
      record_ids: savedRecords.map(r => r.record_id),
      deleted_shifts: deletedShifts,
      machine_name: machine.name,
      date: date,
      is_holiday: false,
      saved_records: savedRecords
    });

  } catch (error: unknown) {
    console.error('Error in POST /api/production-records/daily:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to save daily production data',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}
