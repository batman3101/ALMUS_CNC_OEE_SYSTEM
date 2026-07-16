import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  DEFAULT_OPERATING_MINUTES,
  getBreakTimeMinutes,
  resolvePlannedRuntime
} from '@/lib/plannedRuntime';
import { synchronizeDowntime } from '../oeeRules';
import {
  apiAuthErrorResponse,
  assertMachineAccess,
  requireUser,
} from '@/lib/apiAuth';

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

interface ExistingRecord {
  record_id: string;
  machine_id: string;
  date: string;
  shift: string | null;
  planned_runtime: number | null;
  actual_runtime: number | null;
  ideal_runtime: number | null;
  output_qty: number;
  defect_qty: number;
  tact_time_seconds: number | null;
  cavity_count: number | null;
  downtime_minutes: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
}

const EXISTING_RECORD_COLUMNS =
  'record_id, machine_id, date, shift, planned_runtime, actual_runtime, ideal_runtime, output_qty, defect_qty, tact_time_seconds, cavity_count, downtime_minutes, availability, performance, quality, oee';

// 설비의 현재 공정 기준 Tact Time / Cavity 조회 (서버 기준값)
async function getMachineTactInfo(machineId: string) {
  const { data } = await supabaseAdmin
    .from('machines_with_production_info')
    .select('current_tact_time, current_cavity_count')
    .eq('id', machineId)
    .maybeSingle();

  return {
    tactSeconds:
      data?.current_tact_time && data.current_tact_time > 0
        ? data.current_tact_time
        : null,
    cavity:
      data?.current_cavity_count && data.current_cavity_count > 0
        ? data.current_cavity_count
        : DEFAULT_CAVITY
  };
}

/**
 * 이 기록의 "단위당 이론 생산시간(분)"을 정한다.
 *
 * 과거 기록을 수정할 때 설비의 **현재** 공정 Tact/Cavity 로 다시 계산하면, 제품이나 공정이
 * 바뀐 뒤에는 그 교대의 역사가 오늘의 조건으로 덮인다. 수량 한 자리를 고쳤을 뿐인데
 * ideal_runtime, performance, oee 가 전부 달라지고 원래 값은 복구할 수 없다.
 *
 * 그래서 다음 순서로 "그때의 조건"을 우선한다:
 *   1. 기록에 저장된 tact/cavity 스냅샷 (2026-07-14 이후 저장분)
 *   2. 스냅샷이 없는 레거시 기록이면, 저장된 ideal_runtime / output_qty 에서 역산한다.
 *      ideal_runtime = (output / cavity) * tact / 60 이므로 그 몫이 곧 단위당 생산시간이고,
 *      cavity 를 몰라도 값이 나온다. 수량만 바뀌면 비율은 그대로 유지된다.
 *   3. 둘 다 불가능하면(생산 0 등 역산 불가) 현재 공정 값으로 계산한다. 이 경우엔 보존할
 *      역사 자체가 없다.
 */
function resolveSavedMinutesPerUnit(existing: ExistingRecord): number | null {
  const snapshotTact = existing.tact_time_seconds;
  const snapshotCavity = existing.cavity_count;

  if (snapshotTact && snapshotTact > 0) {
    const cavity = snapshotCavity && snapshotCavity > 0 ? snapshotCavity : DEFAULT_CAVITY;
    return snapshotTact / 60 / cavity;
  }

  const storedIdeal = existing.ideal_runtime ?? 0;
  if (storedIdeal > 0 && existing.output_qty > 0) {
    return storedIdeal / existing.output_qty;
  }

  return null;
}

async function resolveMinutesPerUnit(existing: ExistingRecord): Promise<number | null> {
  const savedMinutesPerUnit = resolveSavedMinutesPerUnit(existing);
  if (savedMinutesPerUnit !== null) return savedMinutesPerUnit;

  const { tactSeconds, cavity } = await getMachineTactInfo(existing.machine_id);
  if (tactSeconds === null) return null;
  return tactSeconds / 60 / Math.max(1, cavity);
}

/**
 * 수정 요청으로부터 저장할 데이터 구성.
 * 수량/가동시간이 변경되면 파생 지표(ideal_runtime, availability, performance, quality, oee)를
 * 서버에서 항상 재계산한다. (클라이언트가 보낸 지표 값은 무시)
 */
async function buildUpdateData(
  body: Record<string, unknown>,
  existing: ExistingRecord
): Promise<{ updateData?: Record<string, number | null>; error?: string }> {
  const baseFields = ['output_qty', 'defect_qty', 'actual_runtime', 'planned_runtime'] as const;
  const hasBaseField = baseFields.some(field => body[field] !== undefined);

  if (!hasBaseField) {
    return { error: 'No valid fields to update' };
  }

  const outputQty = body.output_qty !== undefined ? body.output_qty : existing.output_qty;
  const defectQty = body.defect_qty !== undefined ? body.defect_qty : existing.defect_qty;

  const validationError = validateQuantities(outputQty, defectQty);
  if (validationError) {
    return { error: validationError };
  }

  // 계획 가동시간 = max(0, 가동시간 - 휴식시간(system_settings))
  // - body.planned_runtime 이 오면 교대 가동시간(분)으로 해석하여 휴식시간을 차감한다.
  // - 오지 않으면 이미 저장된 planned_runtime(차감이 끝난 값)을 그대로 유지한다. (중복 차감 방지)
  // - 저장된 값도 없으면 기본 가동시간(720분)에서 휴식시간을 차감한 값을 사용한다.
  const runtimeWasEdited = body.actual_runtime !== undefined || body.planned_runtime !== undefined;

  let plannedRuntime: number | null = existing.planned_runtime;
  if (runtimeWasEdited) {
    if (body.planned_runtime === null) {
      plannedRuntime = null;
    } else if (body.planned_runtime !== undefined) {
      const breakMinutes = await getBreakTimeMinutes();
      plannedRuntime = resolvePlannedRuntime(Number(body.planned_runtime), breakMinutes);
    } else if (plannedRuntime === null) {
      const breakMinutes = await getBreakTimeMinutes();
      plannedRuntime = resolvePlannedRuntime(DEFAULT_OPERATING_MINUTES, breakMinutes);
    }
  }

  let actualRuntime: number | null = existing.actual_runtime;
  if (body.actual_runtime === null) {
    actualRuntime = null;
  } else if (body.actual_runtime !== undefined && plannedRuntime !== null) {
    const actualRuntimeInput = Number(body.actual_runtime);
    actualRuntime = clamp(Number.isFinite(actualRuntimeInput) ? actualRuntimeInput : 0, 0, plannedRuntime);
  } else if (runtimeWasEdited && actualRuntime !== null && plannedRuntime !== null) {
    actualRuntime = clamp(actualRuntime, 0, plannedRuntime);
  }

  const downtimeMinutes =
    runtimeWasEdited && plannedRuntime !== null && actualRuntime !== null
      ? synchronizeDowntime(plannedRuntime, actualRuntime, true, existing.downtime_minutes)
      : existing.downtime_minutes;

  // 현재 공정이 아니라 "이 기록이 만들어질 때의 조건"으로 계산한다 (역사 덮어쓰기 방지)
  // 수량만 수정하는 경우 저장 당시 조건을 증명할 수 없으면 현재 공정/기본값을 끌어오지 않는다.
  const minutesPerUnit = runtimeWasEdited
    ? await resolveMinutesPerUnit(existing)
    : resolveSavedMinutesPerUnit(existing);

  const outputQtyValue = outputQty as number;
  const defectQtyValue = defectQty as number;

  const idealRuntime = minutesPerUnit === null ? null : outputQtyValue * minutesPerUnit;
  const availability =
    plannedRuntime === null || actualRuntime === null
      ? null
      : plannedRuntime > 0
        ? clamp(actualRuntime / plannedRuntime, 0, 1)
        : 0;
  const performance =
    actualRuntime === null || idealRuntime === null
      ? null
      : actualRuntime > 0
        ? clamp(idealRuntime / actualRuntime, 0, 1)
        : 0;
  const quality =
    outputQtyValue > 0 ? clamp((outputQtyValue - defectQtyValue) / outputQtyValue, 0, 1) : 0;
  const oee = availability === null || performance === null
    ? null
    : availability * performance * quality;

  const roundMetric = (value: number | null): number | null =>
    value === null ? null : Math.round(value * 10000) / 10000;

  return {
    updateData: {
      output_qty: outputQtyValue,
      defect_qty: defectQtyValue,
      planned_runtime: plannedRuntime === null ? null : Math.round(plannedRuntime),
      actual_runtime: actualRuntime === null ? null : Math.round(actualRuntime),
      downtime_minutes: downtimeMinutes,
      ideal_runtime: idealRuntime === null ? null : Math.round(idealRuntime),
      availability: roundMetric(availability),
      performance: roundMetric(performance),
      quality: roundMetric(quality),
      oee: roundMetric(oee)
    }
  };
}

// GET /api/production-records/[recordId] - 특정 생산 기록 조회
export async function GET(
  request: NextRequest,
  { params }: { params: { recordId: string } }
) {
  try {
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
    console.log('GET /api/production-records/[recordId] called with id:', params.recordId);

    const { data: record, error } = await supabaseAdmin
      .from('production_records')
      .select(`
        record_id,
        machine_id,
        date,
        shift,
        planned_runtime,
        actual_runtime,
        ideal_runtime,
        output_qty,
        defect_qty,
        availability,
        performance,
        quality,
        oee,
        created_at,
        machines:machine_id (
          id,
          name,
          location,
          equipment_type
        )
      `)
      .eq('record_id', params.recordId)
      .single();

    if (error) {
      console.error('Supabase error:', error);
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { success: false, error: 'Production record not found' },
          { status: 404 }
        );
      }
      throw error;
    }

    assertMachineAccess(authenticatedUser, record.machine_id);

    console.log('Successfully fetched production record:', record?.record_id);

    return NextResponse.json({
      success: true,
      record: record
    });

  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error in GET /api/production-records/[recordId]:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch production record',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}

// PUT /api/production-records/[recordId] - 생산 기록 수정
export async function PUT(
  request: NextRequest,
  { params }: { params: { recordId: string } }
) {
  try {
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
    console.log('PUT /api/production-records/[recordId] called with id:', params.recordId);

    const body = await request.json();
    console.log('PUT request body:', JSON.stringify(body, null, 2));

    // 생산 기록 존재 확인
    const { data: existingRecord, error: checkError } = await supabaseAdmin
      .from('production_records')
      .select(EXISTING_RECORD_COLUMNS)
      .eq('record_id', params.recordId)
      .single();

    if (checkError || !existingRecord) {
      return NextResponse.json(
        { success: false, error: 'Production record not found' },
        { status: 404 }
      );
    }

    assertMachineAccess(authenticatedUser, existingRecord.machine_id);

    // 업데이트할 데이터 구성 (파생 지표는 서버에서 재계산)
    const { updateData, error: buildError } = await buildUpdateData(body, existingRecord);

    if (buildError || !updateData) {
      return NextResponse.json(
        { success: false, error: buildError },
        { status: 400 }
      );
    }

    // 생산 기록 업데이트
    const { data: updatedRecord, error: updateError } = await supabaseAdmin
      .from('production_records')
      .update(updateData)
      .eq('record_id', params.recordId)
      .select()
      .single();

    if (updateError) {
      console.error('Update error:', updateError);
      throw updateError;
    }

    console.log('Successfully updated production record:', updatedRecord?.record_id);

    return NextResponse.json({
      success: true,
      message: '생산 기록이 성공적으로 수정되었습니다',
      record: updatedRecord
    });

  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error in PUT /api/production-records/[recordId]:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update production record',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}

// DELETE /api/production-records/[recordId] - 생산 기록 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: { recordId: string } }
) {
  try {
    await requireUser(request, ['admin']);
    console.log('DELETE /api/production-records/[recordId] called with id:', params.recordId);

    // 생산실적만 삭제하고 해당 교대 상태를 MISSING으로 기록한다.
    // 비가동은 생산실적 유무와 무관한 현장 사건이므로 삭제하거나 롤백하지 않는다.
    const { data: deleted, error: deleteError } = await supabaseAdmin.rpc(
      'delete_production_record',
      { p_record_id: params.recordId }
    );

    if (deleteError) {
      if (deleteError.message?.includes('RECORD_NOT_FOUND')) {
        return NextResponse.json(
          { success: false, error: 'Production record not found' },
          { status: 404 }
        );
      }
      console.error('Delete error:', deleteError);
      throw deleteError;
    }

    console.log(`Successfully deleted production record: ${params.recordId}`);

    return NextResponse.json({
      success: true,
      message: '생산 기록이 성공적으로 삭제되었습니다',
      deleted_record: deleted
    });

  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error in DELETE /api/production-records/[recordId]:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete production record',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}

// PATCH /api/production-records/[recordId] - 생산 기록 부분 수정
export async function PATCH(
  request: NextRequest,
  { params }: { params: { recordId: string } }
) {
  try {
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
    console.log('PATCH /api/production-records/[recordId] called with id:', params.recordId);

    const body = await request.json();
    console.log('PATCH request body:', JSON.stringify(body, null, 2));

    // 생산 기록 존재 확인
    const { data: existingRecord, error: checkError } = await supabaseAdmin
      .from('production_records')
      .select(EXISTING_RECORD_COLUMNS)
      .eq('record_id', params.recordId)
      .single();

    if (checkError || !existingRecord) {
      return NextResponse.json(
        { success: false, error: 'Production record not found' },
        { status: 404 }
      );
    }

    assertMachineAccess(authenticatedUser, existingRecord.machine_id);

    // 업데이트할 데이터 구성 (파생 지표는 서버에서 재계산)
    const { updateData, error: buildError } = await buildUpdateData(body, existingRecord);

    if (buildError || !updateData) {
      return NextResponse.json(
        { success: false, error: buildError },
        { status: 400 }
      );
    }

    // 생산 기록 부분 업데이트
    const { data: updatedRecord, error: updateError } = await supabaseAdmin
      .from('production_records')
      .update(updateData)
      .eq('record_id', params.recordId)
      .select()
      .single();

    if (updateError) {
      console.error('PATCH update error:', updateError);
      throw updateError;
    }

    console.log('Successfully patched production record:', updatedRecord?.record_id);

    return NextResponse.json({
      success: true,
      message: '생산 기록이 성공적으로 부분 수정되었습니다',
      record: updatedRecord,
      updated_fields: Object.keys(updateData)
    });

  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error in PATCH /api/production-records/[recordId]:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to patch production record',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}
