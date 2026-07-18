import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getBreakTimeMinutes } from '@/lib/plannedRuntime';
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
  requireUser,
} from '@/lib/apiAuth';

// 교대별 입력 데이터 (클라이언트 폼에서 전송)
interface ShiftInputData {
  actual_production: number;
  defect_quantity: number;
  operating_minutes: number;
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
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
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

    const businessTime = await getBusinessTimeConfig();
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
    // 비가동 원본은 클라이언트 합계가 아니라 서버 DB에서 직접 읽는다. 조회 실패 시
    // 생산수량 저장은 계속하되 OEE 런타임 계열을 NULL로 남겨 잘못된 100%를 만들지 않는다.
    const breakMinutes = await getBreakTimeMinutes();
    const downtimeByShift = await loadDowntimeMinutes(machine_id, {
      A: dayWindow,
      B: nightWindow,
    }, breakMinutes);

    // 설비 존재 확인
    const { data: machine, error: machineError } = await supabaseAdmin
      .from('machines')
      .select('id, name, is_active')
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
        .eq('id', machine_id)
        .maybeSingle(),
      supabaseAdmin
        .from('production_records')
        .select('shift, output_qty, ideal_runtime, tact_time_seconds, cavity_count')
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
        ideal_runtime: processStandardKnown ? Math.round(metrics.idealRuntime) : null,
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
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      'save_daily_production',
      {
      p_machine_id: machine_id,
      p_date: date,
      p_day_shift_off: Boolean(day_shift_off),
      p_night_shift_off: Boolean(night_shift_off),
      p_day_record: !day_shift_off && day_shift
        ? buildShiftRecord('A', day_shift, downtimeByShift.A)
        : null,
      p_night_record: !night_shift_off && night_shift
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
      saved_records?: SavedRecord[];
      deleted_shifts?: ('A' | 'B')[];
    };
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
