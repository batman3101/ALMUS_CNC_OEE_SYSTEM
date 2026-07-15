import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { getBreakTimeMinutes, resolvePlannedRuntime } from '@/lib/plannedRuntime';
import {
  calculateOeeMetrics,
  DEFAULT_CAVITY,
  DEFAULT_TACT_SECONDS,
  resolveHistoricalProductionParameters,
  validateDowntimeEntriesForWindow,
  type HistoricalProductionSnapshot,
} from '../oeeRules';
import { buildShiftWindows } from '@/utils/downtimeIntervals';

// 교대별 입력 데이터 (클라이언트 폼에서 전송)
interface ShiftInputData {
  actual_production: number;
  defect_quantity: number;
  operating_minutes: number;
  total_downtime_minutes: number;
  // 비가동이 0분일 때, 작업자가 "무중단"임을 명시적으로 확인했는지 여부.
  // 비가동·수량을 사람이 직접 입력하는 시스템이므로 "입력하지 않은 것"과
  // "0이라고 입력한 것"을 반드시 구분해야 한다 (구분하지 않으면 가동률이 100%로 부풀려진다).
  downtime_confirmed?: boolean;
}

interface DowntimeSaveEntry {
  start_time: string;
  end_time: string;
  reason: string;
  description?: string;
  operator_id?: string;
}

interface DailyProductionRequest {
  machine_id: string;
  date: string;
  day_shift_off?: boolean;
  night_shift_off?: boolean;
  day_shift?: ShiftInputData;
  night_shift?: ShiftInputData;
  day_downtime_entries?: DowntimeSaveEntry[];
  night_downtime_entries?: DowntimeSaveEntry[];
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

const DEFAULT_BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_SHIFT_A_START = '08:00';
const DEFAULT_SHIFT_B_START = '20:00';

async function getBusinessTimeConfig() {
  const defaults = {
    timezone: DEFAULT_BUSINESS_TIMEZONE,
    shiftAStart: DEFAULT_SHIFT_A_START,
    shiftBStart: DEFAULT_SHIFT_B_START,
  };
  try {
    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .select('category, setting_key, setting_value')
      .in('category', ['general', 'shift'])
      .eq('is_active', true);
    if (error || !data) return defaults;
    const readValue = (category: string, key: string): string | undefined => {
      const row = data.find(item => item.category === category && item.setting_key === key);
      const value = row?.setting_value as { value?: unknown } | null | undefined;
      return typeof value?.value === 'string' ? value.value : undefined;
    };
    return {
      timezone: readValue('general', 'timezone') || defaults.timezone,
      shiftAStart: readValue('shift', 'shift_a_start') || defaults.shiftAStart,
      shiftBStart: readValue('shift', 'shift_b_start') || defaults.shiftBStart,
    };
  } catch {
    return defaults;
  }
}

// 교대별 OEE 지표 계산 (서버가 단일 진실 공급원 - 클라이언트 값 무시)
// 계획 가동시간 = max(0, 가동시간 - 휴식시간(system_settings))
function calculateShiftMetrics(params: {
  operatingMinutes: number;
  breakMinutes: number;
  downtimeMinutes: number;
  outputQty: number;
  defectQty: number;
  tactSeconds: number;
  cavity: number;
}) {
  const plannedRuntime = resolvePlannedRuntime(params.operatingMinutes, params.breakMinutes);
  const downtime = clamp(params.downtimeMinutes, 0, plannedRuntime);
  const actualRuntime = Math.max(0, plannedRuntime - downtime);
  return {
    ...calculateOeeMetrics({
      plannedRuntime,
      actualRuntime,
      outputQty: params.outputQty,
      defectQty: params.defectQty,
      minutesPerUnit: params.tactSeconds / 60 / Math.max(1, params.cavity),
    }),
    downtime,
  };
}

/**
 * 저장할 downtime_minutes 를 결정한다.
 *
 *   NULL : 미입력 (가동률을 신뢰할 수 없음)
 *   0    : 무중단으로 확인됨
 *   > 0  : 비가동 있음
 *
 * 비가동이 0보다 크면 그 자체가 입력의 증거이므로 그대로 저장한다.
 * 0 인 경우에만 애매하므로, 작업자가 명시적으로 확인한 경우에만 0으로 저장하고
 * 그렇지 않으면 NULL(미입력)로 남긴다. 폼을 거치지 않는 호출이 0을
 * "확인된 무중단"으로 위장시키지 못하게 하기 위함이다.
 */
function resolveDowntimeMinutes(downtime: number, confirmed: boolean | undefined): number | null {
  if (downtime > 0) return Math.round(downtime);
  return confirmed === true ? 0 : null;
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
      night_shift_off,
      day_downtime_entries,
      night_downtime_entries
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
    const normalizedDayEntries = day_shift_off ? [] : day_downtime_entries;
    const normalizedNightEntries = night_shift_off ? [] : night_downtime_entries;
    const dayDowntime = validateDowntimeEntriesForWindow('주간조', normalizedDayEntries, dayWindow);
    if (dayDowntime.error) {
      return NextResponse.json({ success: false, error: dayDowntime.error }, { status: 400 });
    }
    const nightDowntime = validateDowntimeEntriesForWindow('야간조', normalizedNightEntries, nightWindow);
    if (nightDowntime.error) {
      return NextResponse.json({ success: false, error: nightDowntime.error }, { status: 400 });
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

    // 휴식 시간(system_settings)은 하루 단위로 한 번만 조회하여 두 교대에 동일하게 적용
    const breakMinutes = await getBreakTimeMinutes();

    // 교대별 저장 레코드 구성 (서버에서 지표 재계산)
    const existingByShift = new Map(
      (existingRows ?? []).map(row => [row.shift, row as HistoricalProductionSnapshot])
    );

    const buildShiftRecord = (
      shift: 'A' | 'B',
      shiftData: ShiftInputData,
      downtimeTotal?: number
    ) => {
      const outputQty = shiftData.actual_production;
      const defectQty = shiftData.defect_quantity;
      const parameters = resolveHistoricalProductionParameters(
        existingByShift.get(shift),
        tactSeconds,
        cavity
      );

      const metrics = calculateShiftMetrics({
        operatingMinutes: toNumber(shiftData.operating_minutes),
        breakMinutes,
        downtimeMinutes: downtimeTotal ?? toNumber(shiftData.total_downtime_minutes),
        outputQty,
        defectQty,
        tactSeconds: parameters.minutesPerUnit * 60,
        cavity: 1
      });

      return {
        planned_runtime: Math.round(metrics.plannedRuntime),
        actual_runtime: Math.round(metrics.actualRuntime),
        ideal_runtime: Math.round(metrics.idealRuntime),
        output_qty: outputQty,
        defect_qty: defectQty,
        availability: Math.round(metrics.availability * 10000) / 10000, // 소수점 4자리
        performance: Math.round(metrics.performance * 10000) / 10000,
        quality: Math.round(metrics.quality * 10000) / 10000,
        oee: Math.round(metrics.oee * 10000) / 10000,
        // NULL 이면 "비가동 미입력" = 이 기록의 가동률은 신뢰할 수 없다는 표시
        downtime_minutes: resolveDowntimeMinutes(metrics.downtime, shiftData.downtime_confirmed),
        // 계산에 실제로 쓴 Tact/Cavity 를 함께 남긴다.
        // 이 값이 없으면 나중에 이 기록을 수정할 때 서버가 "그때"가 아니라 "지금"의 공정
        // 조건으로 ideal_runtime/performance/oee 를 다시 계산해 역사를 덮어쓴다.
        tact_time_seconds: parameters.tactSeconds || null,
        cavity_count: parameters.cavity || null
      };
    };

    // 주간(A)/야간(B) 교대의 삭제·저장을 하나의 트랜잭션에서 처리한다.
    // (기존에는 교대별 delete/upsert 를 개별 왕복으로 실행해, 중간 실패 시 하루치가
    //  반쪽만 적용된 채로 남는 문제가 있었다)
    const useAtomicDowntimeSave = normalizedDayEntries !== undefined || normalizedNightEntries !== undefined;
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      useAtomicDowntimeSave ? 'save_daily_production_with_downtime' : 'save_daily_production',
      {
      p_machine_id: machine_id,
      p_date: date,
      p_day_shift_off: Boolean(day_shift_off),
      p_night_shift_off: Boolean(night_shift_off),
      p_day_record: !day_shift_off && day_shift
        ? buildShiftRecord('A', day_shift, dayDowntime.totalMinutes)
        : null,
      p_night_record: !night_shift_off && night_shift
        ? buildShiftRecord('B', night_shift, nightDowntime.totalMinutes)
        : null,
      ...(useAtomicDowntimeSave && {
        p_day_downtime_entries: dayDowntime.entries ?? null,
        p_night_downtime_entries: nightDowntime.entries ?? null,
      })
    });

    if (rpcError) {
      console.error('Error saving daily production records:', rpcError);
      if (rpcError.code === '23P01' || rpcError.code === '23503') {
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
