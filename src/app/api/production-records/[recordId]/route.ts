import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  DEFAULT_OPERATING_MINUTES,
  getBreakTimeMinutes,
  resolvePlannedRuntime
} from '@/lib/plannedRuntime';
import { redactSecrets } from '@/lib/redactSecrets';
import { synchronizeDowntime } from '../oeeRules';
import {
  apiAuthErrorResponse,
  assertMachineAccess,
  requireUser,
} from '@/lib/apiAuth';
import { PRODUCTION_RECORD_DELETE_ROLES } from '@/lib/pageAccess';

// cavity_count 는 참고용(사이클 수 환산·JIG 구성 기록)으로 스냅샷에만 보존하고
// OEE 계산에는 사용하지 않는다. tact_time_seconds 가 이미 개당 가공시간이다.

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/**
 * 수량 검증: 정수 & 0 이상 & 불량 수량 <= 생산 수량.
 *
 * `defectQty === null` 은 **미검사**다(교대 마감은 `defect_qty` 를 NULL 로 두고 다음날 확정한다).
 * 예전에는 null 을 "정수가 아님"으로 보고 400 을 냈다. 그래서 불량대기 상태의 레코드는
 * 생산량만 고치려 해도 열리지 않았고 — 즉 **가장 손대야 할 행이 오히려 수정 불가였다** —
 * 오류 문구까지 "불량 수량은 0 이상의 정수여야 합니다"라 원인을 오해하게 만들었다.
 */
function validateQuantities(outputQty: unknown, defectQty: unknown): string | null {
  if (!Number.isInteger(outputQty) || (outputQty as number) < 0) {
    return '생산 수량(output_qty)은 0 이상의 정수여야 합니다';
  }
  if (defectQty === null) return null;
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
  // DB 는 이 컬럼을 NULL 로 허용한다 — 마감은 됐지만 불량 검사 전인 상태다.
  // `number` 로 적으면 "미검사"를 표현할 수 없고, 그 타입 거짓말이 위 400 버그를 만들었다.
  defect_qty: number | null;
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

/**
 * 낙관적 동시성(CAS) 대조에 쓸 컬럼.
 *
 * ## 왜 필요한가
 *
 * 이 라우트는 행을 읽고 → Node 에서 파생지표를 전부 다시 계산하고 → 통째로 덮어쓴다.
 * 그런데 같은 행을 고치는 다른 경로(`confirm_shift_defect`, `close_shift_upsert_v2`)는
 * `pg_advisory_xact_lock(machine||date||shift)` 아래에서 돈다. advisory lock 은 Postgres 에서
 * 독립된 네임스페이스라 이 라우트의 평범한 UPDATE 를 **차단하지 않는다**. 그래서 넷 다
 * "보호되는 것처럼" 보였지만 실제로는 다음이 가능했다:
 *
 *   1. PATCH 가 `defect_qty = 1` 을 읽는다
 *   2. `confirm_shift_defect` 가 `defect_qty = 5` 와 새 quality/oee 를 확정 저장한다
 *   3. PATCH 가 1단계 값으로 계산한 지표를 덮어쓴다 → **확정 불량이 사라진다**
 *
 * `close_shift_upsert_v2` 는 `on conflict … defect_qty = production_records.defect_qty` 로
 * 확정 불량을 일부러 보존한다. 그 규약을 이 라우트만 지키지 않고 있었다.
 *
 * ## 왜 잠금이 아니라 CAS 인가
 *
 * 잠금을 쓰려면 RPC 를 새로 만들어야 하고, 그건 마이그레이션 배포와 코드 배포 사이에 창을
 * 만든다. CAS 는 앱만으로 완결되고 **읽은 그대로가 아니면 쓰지 않는다**는 같은 보장을 준다.
 * 최악이 "불필요한 409 재시도"인데 그건 되돌릴 수 있다. 조용한 덮어쓰기는 되돌릴 수 없다.
 *
 * ## 왜 파생지표까지 전부 대조하는가
 *
 * 이 라우트가 **덮어쓰는 모든 컬럼**과 **계산에 쓴 모든 컬럼**을 넣는다. 일부만 넣으면
 * 넣지 않은 컬럼이 그 사이 바뀌었을 때 조용히 통과한다. 좁은 지문은 지문이 아니다.
 */
const CONCURRENCY_GUARD_COLUMNS = [
  'output_qty',
  'defect_qty',
  'planned_runtime',
  'actual_runtime',
  'ideal_runtime',
  'downtime_minutes',
  'tact_time_seconds',
  'availability',
  'performance',
  'quality',
  'oee',
] as const satisfies readonly (keyof ExistingRecord)[];

/**
 * 읽은 스냅샷과 **완전히 같을 때만** 갱신한다. 그 사이 누가 바꿨으면 0행이 갱신되고,
 * 호출자는 409 로 되돌려 보낸다.
 *
 * NULL 은 `.eq()` 로 비교되지 않는다(SQL 에서 `col = NULL` 은 NULL 이다). 그래서 값이 null 인
 * 컬럼은 `.is()` 로 건다 — 이걸 빠뜨리면 NULL 컬럼을 가진 행은 **어떤 조건도 만족하지 못해**
 * 항상 409 가 되거나, 반대로 조건에서 빠져 보호받지 못한다.
 */
async function updateRecordIfUnchanged(
  recordId: string,
  existing: ExistingRecord,
  updateData: Record<string, number | null>
) {
  let query = supabaseAdmin
    .from('production_records')
    .update(updateData)
    .eq('record_id', recordId);

  for (const column of CONCURRENCY_GUARD_COLUMNS) {
    const seen = existing[column];
    query = seen === null || seen === undefined
      ? query.is(column, null)
      : query.eq(column, seen);
  }

  return query.select().maybeSingle();
}

/** 동시 수정으로 갱신이 무산됐을 때의 응답. 사용자에게는 "다시 불러와 확인"이 유일한 안전한 행동이다. */
const concurrentModificationResponse = () =>
  NextResponse.json(
    {
      success: false,
      error: 'record_changed',
      message:
        '다른 곳에서 이 기록이 먼저 변경되었습니다. 최신 내용을 다시 불러온 뒤 수정해 주세요.'
    },
    { status: 409 }
  );

// 설비의 현재 공정 기준 Tact Time 조회 (서버 기준값).
// current_tact_time 은 개당(1 piece) 가공시간이다. cavity 는 계산에 쓰지 않으므로
// 조회하지 않는다.
async function getMachineTactInfo(machineId: string) {
  const { data } = await supabaseAdmin
    .from('machines_with_production_info')
    .select('current_tact_time')
    .eq('id', machineId)
    .maybeSingle();

  return {
    tactSeconds:
      data?.current_tact_time && data.current_tact_time > 0
        ? data.current_tact_time
        : null
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
 *   1. 기록에 저장된 tact 스냅샷 (2026-07-14 이후 저장분). tact 는 개당(1 piece)
 *      가공시간이므로 cavity 로 나누지 않는다 — JIG 의 cavity 수는 이미 개당 t/t 에
 *      반영돼 있어 다시 나누면 이중 반영이 된다.
 *      (src/app/api/production-records/oeeRules.ts 의 minutesPerUnit 과 동일한 정의)
 *   2. 스냅샷이 없는 레거시 기록이면, 저장된 ideal_runtime / output_qty 에서 역산한다.
 *      그 몫이 곧 단위당 생산시간이므로 수량만 바뀌면 비율은 그대로 유지된다.
 *   3. 둘 다 불가능하면(생산 0 등 역산 불가) 현재 공정 값으로 계산한다. 이 경우엔 보존할
 *      역사 자체가 없다.
 */
function resolveSavedMinutesPerUnit(existing: ExistingRecord): number | null {
  const snapshotTact = existing.tact_time_seconds;

  if (snapshotTact && snapshotTact > 0) {
    return snapshotTact / 60;
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

  const { tactSeconds } = await getMachineTactInfo(existing.machine_id);
  if (tactSeconds === null) return null;
  return tactSeconds / 60;
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
  // 미검사(NULL)를 0 으로 접지 않는다. 접으면 불량 0건으로 확정한 것과 구분이 사라지고,
  // 품질 100% 로 보이는 행이 만들어진다(NULL≠0 원칙).
  const defectQtyValue = defectQty === null ? null : (defectQty as number);

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
  // 불량이 미검사면 품질도 OEE 도 "계산할 수 없음"이다. close_shift_upsert_v2 가
  // 같은 규칙을 쓴다(`v_defect is null → v_quality := null`) — 두 경로가 같은 말을 해야 한다.
  const quality =
    defectQtyValue === null
      ? null
      : outputQtyValue > 0
        ? clamp((outputQtyValue - defectQtyValue) / outputQtyValue, 0, 1)
        : 0;
  const oee = availability === null || performance === null || quality === null
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
  { params }: { params: Promise<{ recordId: string }> }
) {
  try {
    const { recordId } = await params;
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
    console.log('GET /api/production-records/[recordId] called with id:', recordId);

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
      .eq('record_id', recordId)
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
  { params }: { params: Promise<{ recordId: string }> }
) {
  try {
    const { recordId } = await params;
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
    console.log('PUT /api/production-records/[recordId] called with id:', recordId);

    const body = await request.json();
    console.log('PUT request body:', JSON.stringify(redactSecrets(body), null, 2));

    // 생산 기록 존재 확인
    const { data: existingRecord, error: checkError } = await supabaseAdmin
      .from('production_records')
      .select(EXISTING_RECORD_COLUMNS)
      .eq('record_id', recordId)
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

    // 읽은 스냅샷 그대로일 때만 쓴다 — 마감·불량확정과 경쟁해 확정값을 덮어쓰지 않게.
    const { data: updatedRecord, error: updateError } = await updateRecordIfUnchanged(
      recordId,
      existingRecord,
      updateData
    );

    if (updateError) {
      console.error('Update error:', updateError);
      throw updateError;
    }

    if (!updatedRecord) {
      return concurrentModificationResponse();
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
  { params }: { params: Promise<{ recordId: string }> }
) {
  try {
    const { recordId } = await params;
    // 역할 목록을 여기 다시 적지 않는다 — 목록 화면의 삭제 버튼과 **같은 규칙**을 읽는다.
    await requireUser(request, [...PRODUCTION_RECORD_DELETE_ROLES]);
    console.log('DELETE /api/production-records/[recordId] called with id:', recordId);

    // 생산실적만 삭제하고 해당 교대 상태를 MISSING으로 기록한다.
    // 비가동은 생산실적 유무와 무관한 현장 사건이므로 삭제하거나 롤백하지 않는다.
    const { data: deleted, error: deleteError } = await supabaseAdmin.rpc(
      'delete_production_record',
      { p_record_id: recordId }
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

    console.log(`Successfully deleted production record: ${recordId}`);

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
  { params }: { params: Promise<{ recordId: string }> }
) {
  try {
    const { recordId } = await params;
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
    console.log('PATCH /api/production-records/[recordId] called with id:', recordId);

    const body = await request.json();
    console.log('PATCH request body:', JSON.stringify(redactSecrets(body), null, 2));

    // 생산 기록 존재 확인
    const { data: existingRecord, error: checkError } = await supabaseAdmin
      .from('production_records')
      .select(EXISTING_RECORD_COLUMNS)
      .eq('record_id', recordId)
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

    // 읽은 스냅샷 그대로일 때만 쓴다 (PUT 과 동일 규율).
    const { data: updatedRecord, error: updateError } = await updateRecordIfUnchanged(
      recordId,
      existingRecord,
      updateData
    );

    if (updateError) {
      console.error('PATCH update error:', updateError);
      throw updateError;
    }

    if (!updatedRecord) {
      return concurrentModificationResponse();
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
