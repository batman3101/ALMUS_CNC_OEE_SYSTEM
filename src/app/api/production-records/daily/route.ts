import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getBreakTimeMinutes } from '@/lib/plannedRuntime';
import { redactSecrets } from '@/lib/redactSecrets';
import {
  DEFAULT_CAVITY,
  DEFAULT_TACT_SECONDS,
  resolveHistoricalProductionParameters,
  type HistoricalProductionSnapshot,
} from '../oeeRules';
import { buildShiftWindows, type Interval } from '@/utils/downtimeIntervals';
import {
  calculateVerifiedDowntimeMinutesForWindow,
  resolveConfirmedDowntimeMinutes,
  type DowntimeSourceInterval,
} from './downtimeCalculation';
import { getBusinessTimeConfig } from '@/lib/shiftConfig';
import { loadDowntimeSourceRows } from '@/lib/shiftDowntime';
import { computeShiftSnapshot } from '@/lib/shiftMetrics';
import {
  apiAuthErrorResponse,
  assertMachineAccess,
} from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { PRODUCTION_RECORD_DELETE_ROLES } from '@/lib/pageAccess';

// 교대별 입력 데이터 (클라이언트 폼에서 전송)
interface ShiftInputData {
  actual_production: number;
  defect_quantity: number;
  operating_minutes: number;
}

/**
 * 화면이 읽어 둔 기존 기록의 지문. `null` 은 "이 교대에는 기록이 없었다"는 뜻이다.
 * save_daily_production_v2 가 잠금 아래에서 현재 행과 대조해, 그 사이 누가 바꿨으면 쓰지 않는다
 * (감사 2026-11-14 F-02 — 낡은 화면이 확정 불량·실적을 덮어쓰던 문제).
 */
type ExpectedRecord = Record<string, unknown> & { record_id: string };

interface DailyProductionRequest {
  machine_id: string;
  date: string;
  day_shift_off?: boolean;
  night_shift_off?: boolean;
  day_shift?: ShiftInputData;
  night_shift?: ShiftInputData;
  /** 건드리는 교대(저장·휴무)마다 반드시 있어야 한다. 키가 없으면 낡은 화면인지 알 수 없다. */
  expected_records?: Partial<Record<'A' | 'B', ExpectedRecord | null>>;
}

/** v2 가 대조하는 지문 컬럼. [recordId] 라우트의 CONCURRENCY_GUARD_COLUMNS 와 같은 집합이다. */
const EXPECTED_RECORD_COLUMNS = [
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
] as const;

/**
 * 지문 하나를 검사하고 대조에 쓰는 컬럼만 남긴다. 형식이 틀리면 'invalid' 를 돌려준다
 * (null 은 "기록 없음"이라는 정당한 값이라 오류 표시로 쓸 수 없다).
 */
function normalizeExpectedRecord(value: unknown): ExpectedRecord | null | 'invalid' {
  if (value === null) return null;
  if (typeof value !== 'object' || Array.isArray(value)) return 'invalid';
  const source = value as Record<string, unknown>;
  if (typeof source.record_id !== 'string' || source.record_id.length === 0) return 'invalid';
  const normalized: ExpectedRecord = { record_id: source.record_id };
  for (const column of EXPECTED_RECORD_COLUMNS) {
    const v = source[column];
    if (v === undefined || v === null) {
      normalized[column] = null;
    } else if (typeof v === 'number' && Number.isFinite(v)) {
      normalized[column] = v;
    } else {
      return 'invalid';
    }
  }
  return normalized;
}

/**
 * 가동시간 검증 (감사 F-03): 0 이상의 정수이고 설정된 교대 창 길이를 넘을 수 없다.
 * 상한을 720 으로 박지 않는 이유 — 교대 시각은 시스템 설정이고, 자정을 넘는 B 교대도 같은 창 계산으로 잰다.
 */
function validateOperatingMinutes(shiftName: string, value: unknown, maxMinutes: number): string | null {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > maxMinutes) {
    return `${shiftName} 가동시간은 0 이상 ${maxMinutes} 이하의 정수(분)여야 합니다`;
  }
  return null;
}

interface SavedRecord {
  record_id: string;
  [key: string]: unknown;
}

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

// 교대별 OEE 지표 계산 (서버가 단일 진실 공급원 - 클라이언트 값 무시).
// 계산은 shiftMetrics.computeShiftSnapshot 에 위임한다 — close-shift 라우트와 공유(DRY).
// cavity 는 per-piece tact 규율상 계산에 쓰지 않으므로 시그니처만 유지하고 전달하지 않는다.
function calculateShiftMetrics(params: {
  operatingMinutes: number;
  breakMinutes: number;
  downtimeMinutes: number | null;
  outputQty: number;
  defectQty: number;
  tactSeconds: number;
  cavity: number;
}) {
  return computeShiftSnapshot({
    operatingMinutes: params.operatingMinutes,
    breakMinutes: params.breakMinutes,
    downtimeMinutes: params.downtimeMinutes,
    outputQty: params.outputQty,
    defectQty: params.defectQty,
    tactSeconds: params.tactSeconds,
  });
}

async function loadDowntimeMinutes(
  machineId: string,
  windows: { A: Interval; B: Interval },
  breakMinutes: number
): Promise<{ A: number | null; B: number | null }> {
  const rangeStart = new Date(Math.min(windows.A.start, windows.B.start)).toISOString();
  const rangeEnd = new Date(Math.max(windows.A.end, windows.B.end)).toISOString();

  // downtime_entries + machine_logs 병합 로딩은 실시간 경로(production-progress)와 공유한다.
  // 두 경로가 같은 원천을 봐야 실시간 가동률과 확정 OEE 가 어긋나지 않는다.
  let rows: DowntimeSourceInterval[];
  try {
    rows = await loadDowntimeSourceRows(machineId, rangeStart, rangeEnd);
  } catch (error) {
    console.error('Failed to load downtime for OEE:', error);
    return { A: null, B: null };
  }

  const now = Date.now();
  return {
    A: calculateVerifiedDowntimeMinutesForWindow(rows, windows.A, breakMinutes, now),
    B: calculateVerifiedDowntimeMinutesForWindow(rows, windows.B, breakMinutes, now),
  };
}

// POST /api/production-records/daily - 일일 생산 데이터 저장
export async function POST(request: NextRequest) {
  try {
    // '휴무' 체크는 그 교대의 확정 기록을 지운다. 삭제 권한과 같은 역할로 닫는다(감사 F-02,
    // 사용자 확정 2026-11-14). 이 라우트의 유일한 화면 /data-input 도 MANAGERS 전용이다.
    const authenticatedUser = await requireFactoryUser(request, [...PRODUCTION_RECORD_DELETE_ROLES]);
    console.log('POST /api/production-records/daily called');

    const body: DailyProductionRequest = await request.json();
    console.log('Received daily production data:', redactSecrets(body));

    const {
      machine_id,
      date,
      day_shift,
      day_shift_off,
      night_shift,
      night_shift_off,
      expected_records
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

    assertMachineAccess(authenticatedUser, machine_id);

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

    // 건드리는 교대(저장 또는 휴무)는 화면이 본 지문이 반드시 있어야 한다(감사 F-02).
    // 없으면 "기록 없음을 봤다"와 "아무것도 모른다"가 구분되지 않아 낡은 화면을 막을 수 없다.
    const savingShift = {
      A: Boolean(day_shift && !day_shift_off),
      B: Boolean(night_shift && !night_shift_off),
    };
    const touchedShifts = (['A', 'B'] as const).filter(shift =>
      shift === 'A' ? Boolean(day_shift_off) || savingShift.A : Boolean(night_shift_off) || savingShift.B
    );
    const expected: Partial<Record<'A' | 'B', ExpectedRecord | null>> = {};
    for (const shift of touchedShifts) {
      const hasKey = expected_records !== null && typeof expected_records === 'object'
        && Object.prototype.hasOwnProperty.call(expected_records, shift);
      const normalized = hasKey ? normalizeExpectedRecord(expected_records![shift]) : 'invalid';
      if (normalized === 'invalid') {
        return NextResponse.json(
          {
            success: false,
            error: 'expected_records_required',
            message: '화면을 새로 고친 뒤 다시 저장해 주세요 (기존 기록 확인 정보가 없습니다).',
          },
          { status: 400 }
        );
      }
      expected[shift] = normalized;
    }

    const businessTime = await getBusinessTimeConfig(authenticatedUser.factoryId);
    const [dayWindow] = buildShiftWindows({
      startDate: date,
      endDate: date,
      ...businessTime,
      requestedShifts: ['A'],
    });
    const [nightWindow] = buildShiftWindows({
      startDate: date,
      endDate: date,
      ...businessTime,
      requestedShifts: ['B'],
    });
    if (!dayWindow || !nightWindow) {
      return NextResponse.json({ success: false, error: 'Shift time configuration is invalid' }, { status: 500 });
    }

    // 가동시간 상한 = 설정된 교대 창 길이(감사 F-03). 휴무 교대는 저장하지 않으므로 검사하지 않는다.
    const shiftMinutes = {
      A: Math.round((dayWindow.end - dayWindow.start) / 60_000),
      B: Math.round((nightWindow.end - nightWindow.start) / 60_000),
    };
    if (savingShift.A) {
      const error = validateOperatingMinutes('주간조', day_shift!.operating_minutes, shiftMinutes.A);
      if (error) return NextResponse.json({ success: false, error }, { status: 400 });
    }
    if (savingShift.B) {
      const error = validateOperatingMinutes('야간조', night_shift!.operating_minutes, shiftMinutes.B);
      if (error) return NextResponse.json({ success: false, error }, { status: 400 });
    }

    // 비가동 원천 지문을 **행을 읽기 전에** 잡는다(close-shift 와 같은 순서, 자체 감사 #6).
    // 반대로 하면 그 사이의 변경이 지문에는 반영되고 계산에는 반영되지 않아 대조가 통과해 버린다.
    const sources: Partial<Record<'A' | 'B', { start: string; end: string; digest: string }>> = {};
    for (const [shift, window, saving] of [
      ['A', dayWindow, savingShift.A],
      ['B', nightWindow, savingShift.B],
    ] as const) {
      if (!saving) continue;
      const start = new Date(window.start).toISOString();
      const end = new Date(window.end).toISOString();
      const { data: digest, error: digestError } = await supabaseAdmin.rpc('downtime_window_digest', {
        p_machine_id: machine_id,
        p_window_start: start,
        p_window_end: end,
      });
      if (digestError || typeof digest !== 'string') {
        console.error('비가동 원천 지문 조회 오류:', digestError);
        return NextResponse.json({ success: false, error: 'Failed to read downtime source' }, { status: 500 });
      }
      sources[shift] = { start, end, digest };
    }
    // 비가동 원본은 클라이언트 합계가 아니라 서버 DB에서 직접 읽는다. 조회 실패 시
    // 생산수량 저장은 계속하되 OEE 런타임 계열을 NULL로 남겨 잘못된 100%를 만들지 않는다.
    const breakMinutes = await getBreakTimeMinutes(authenticatedUser.factoryId);
    const downtimeByShift = await loadDowntimeMinutes(machine_id, {
      A: dayWindow,
      B: nightWindow,
    }, breakMinutes);

    // 설비 존재 확인
    const { data: machine, error: machineError } = await supabaseAdmin
      .from('machines')
      .select('id, name, is_active')
      .eq('factory_id', authenticatedUser.factoryId)
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
    if (!machine.is_active) {
      return NextResponse.json(
        { success: false, error: 'Inactive machines cannot receive production records' },
        { status: 409 }
      );
    }

    // 기존 교대 snapshot과 현재 공정값을 함께 조회한다. 기존 행은 반드시 과거 snapshot을 우선한다.
    const [{ data: productionInfo }, { data: existingRows, error: existingError }] = await Promise.all([
      supabaseAdmin
        .from('machines_with_production_info')
        .select('current_tact_time, current_cavity_count')
        // tact 는 OEE 의 분자다. 다른 공장 값으로 계산된 성능이 스냅샷으로 박히면 되돌릴 수 없다.
        .eq('factory_id', authenticatedUser.factoryId)
        .eq('id', machine_id)
        .maybeSingle(),
      supabaseAdmin
        .from('production_records')
        .select('shift, output_qty, ideal_runtime, tact_time_seconds, cavity_count')
      .eq('factory_id', authenticatedUser.factoryId)
        .eq('machine_id', machine_id)
        .eq('date', date)
        .in('shift', ['A', 'B'])
    ]);

    if (existingError) throw existingError;

    const tactSeconds =
      productionInfo?.current_tact_time && productionInfo.current_tact_time > 0
        ? productionInfo.current_tact_time
        : DEFAULT_TACT_SECONDS;
    const cavity =
      productionInfo?.current_cavity_count && productionInfo.current_cavity_count > 0
        ? productionInfo.current_cavity_count
        : DEFAULT_CAVITY;

    // 휴식 시간은 위의 비가동 검증과 두 교대 OEE 계산에 같은 값으로 적용한다.

    // 교대별 저장 레코드 구성 (서버에서 지표 재계산)
    const existingByShift = new Map(
      (existingRows ?? []).map(row => [row.shift, row as HistoricalProductionSnapshot])
    );

    const buildShiftRecord = (
      shift: 'A' | 'B',
      shiftData: ShiftInputData,
      downtimeMinutes: number | null
    ) => {
      const outputQty = shiftData.actual_production;
      const defectQty = shiftData.defect_quantity;
      const parameters = resolveHistoricalProductionParameters(
        existingByShift.get(shift),
        tactSeconds,
        cavity
      );
      const existingSnapshot = existingByShift.get(shift);
      const processStandardKnown = Boolean(
        (existingSnapshot?.tact_time_seconds && existingSnapshot.tact_time_seconds > 0) ||
        (
          existingSnapshot && existingSnapshot.output_qty > 0 &&
          existingSnapshot.ideal_runtime && existingSnapshot.ideal_runtime > 0
        ) ||
        (
          productionInfo?.current_tact_time && productionInfo.current_tact_time > 0 &&
          productionInfo?.current_cavity_count && productionInfo.current_cavity_count > 0
        )
      );

      const metrics = calculateShiftMetrics({
        operatingMinutes: toNumber(shiftData.operating_minutes),
        breakMinutes,
        downtimeMinutes: resolveConfirmedDowntimeMinutes(downtimeMinutes),
        outputQty,
        defectQty,
        tactSeconds: parameters.minutesPerUnit * 60,
        cavity: 1
      });

      return {
        planned_runtime: Math.round(metrics.plannedRuntime),
        actual_runtime: metrics.actualRuntime === null ? null : Math.round(metrics.actualRuntime),
        // 이 라우트는 tactSeconds 를 항상 number 로 넘기므로 idealRuntime 이 null 일 일은
        // 없지만, computeShiftSnapshot 의 tact-null 확장(감사 #2) 이후 타입상 가드가 필요하다.
        ideal_runtime: processStandardKnown && metrics.idealRuntime !== null ? Math.round(metrics.idealRuntime) : null,
        output_qty: outputQty,
        defect_qty: defectQty,
        availability: metrics.availability === null ? null : Math.round(metrics.availability * 10000) / 10000,
        performance: !processStandardKnown || metrics.performance === null
          ? null
          : Math.round(metrics.performance * 10000) / 10000,
        quality: metrics.quality === null ? null : Math.round(metrics.quality * 10000) / 10000,
        oee: !processStandardKnown || metrics.oee === null
          ? null
          : Math.round(metrics.oee * 10000) / 10000,
        downtime_minutes: metrics.downtime === null ? null : Math.round(metrics.downtime),
        // 계산에 실제로 쓴 Tact/Cavity 를 함께 남긴다.
        // 이 값이 없으면 나중에 이 기록을 수정할 때 서버가 "그때"가 아니라 "지금"의 공정
        // 조건으로 ideal_runtime/performance/oee 를 다시 계산해 역사를 덮어쓴다.
        tact_time_seconds: processStandardKnown ? parameters.tactSeconds || null : null,
        cavity_count: processStandardKnown ? parameters.cavity || null : null
      };
    };

    // 주간(A)/야간(B) 교대의 삭제·저장을 하나의 트랜잭션에서 처리한다.
    // (기존에는 교대별 delete/upsert 를 개별 왕복으로 실행해, 중간 실패 시 하루치가
    //  반쪽만 적용된 채로 남는 문제가 있었다)
    // save_daily_production_v2 는 잠금(설비 → 교대) 아래에서 p_expected 지문과 p_sources 비가동 지문을
    // 현재 DB 와 대조한 뒤에만 v1 과 같은 쓰기를 한다. 어긋나면 아무것도 쓰지 않고 ok:false 를 돌려준다.
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      'save_daily_production_v2',
      {
      p_expected: expected,
      p_sources: sources,
      p_machine_id: machine_id,
      p_date: date,
      p_day_shift_off: Boolean(day_shift_off),
      p_night_shift_off: Boolean(night_shift_off),
      p_day_record: savingShift.A && day_shift
        ? buildShiftRecord('A', day_shift, downtimeByShift.A)
        : null,
      p_night_record: savingShift.B && night_shift
        ? buildShiftRecord('B', night_shift, downtimeByShift.B)
        : null,
    });

    if (rpcError) {
      console.error('Error saving daily production records:', rpcError);
      if (rpcError.code === '23P01' || rpcError.code === '23503' || rpcError.code === '55000') {
        return NextResponse.json(
          { success: false, error: rpcError.message },
          { status: 409 }
        );
      }
      if (rpcError.code === '22007' || rpcError.code === '22023' || rpcError.code === '23502') {
        return NextResponse.json(
          { success: false, error: rpcError.message },
          { status: 400 }
        );
      }
      throw new Error(`일일 생산 데이터 저장 실패: ${rpcError.message}`);
    }

    const rpcData = (rpcResult ?? {}) as {
      ok?: boolean;
      reason?: string;
      shift?: 'A' | 'B';
      saved_records?: SavedRecord[];
      deleted_shifts?: ('A' | 'B')[];
    };

    if (rpcData.ok !== true) {
      // 거부는 쓰기 전에 일어난다. 화면은 최신 상태를 다시 불러와야 한다.
      const messages: Record<string, string> = {
        record_changed: '다른 곳에서 이 교대 기록이 먼저 변경되었습니다. 최신 내용을 다시 불러온 뒤 저장해 주세요.',
        source_changed: '저장하는 동안 비가동 기록이 바뀌었습니다. 다시 저장해 주세요.',
      };
      const reason = rpcData.reason ?? 'unknown';
      if (reason in messages) {
        return NextResponse.json(
          { success: false, error: reason, shift: rpcData.shift, message: messages[reason] },
          { status: 409 }
        );
      }
      throw new Error(`일일 생산 데이터 저장 실패: ${reason}`);
    }
    const savedRecords: SavedRecord[] = rpcData.saved_records ?? [];
    const deletedShifts: ('A' | 'B')[] = rpcData.deleted_shifts ?? [];

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
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

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
