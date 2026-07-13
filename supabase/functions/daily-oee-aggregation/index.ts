import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

interface OEECalculationResult {
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  actual_runtime: number;
  planned_runtime: number;
  ideal_runtime: number;
  output_qty: number;
  defect_qty: number;
}

interface MachineLog {
  log_id: string;
  machine_id: string;
  state: string;
  start_time: string;
  end_time: string | null;
  duration: number | null;
}

interface ProductionRecord {
  record_id?: string;
  machine_id: string;
  date: string;
  shift: 'A' | 'B';
  planned_runtime?: number;
  actual_runtime?: number;
  ideal_runtime?: number;
  output_qty: number;
  defect_qty: number;
  availability?: number;
  performance?: number;
  quality?: number;
  oee?: number;
}

/**
 * OEE 계산 유틸리티 클래스
 */
class OEECalculator {
  /**
   * 가동률 계산: 실제 가동시간 / 계획 가동시간
   */
  static calculateAvailability(actualRuntime: number, plannedRuntime: number): number {
    if (plannedRuntime <= 0) return 0;
    return Math.min(Math.max(0, actualRuntime / plannedRuntime), 1);
  }

  /**
   * 성능 계산: 이론 생산시간 / 실제 가동시간
   */
  static calculatePerformance(idealRuntime: number, actualRuntime: number): number {
    if (actualRuntime <= 0) return 0;
    return Math.min(Math.max(0, idealRuntime / actualRuntime), 1);
  }

  /**
   * 품질 계산: 양품 수량 / 총 생산 수량
   */
  static calculateQuality(outputQty: number, defectQty: number): number {
    if (outputQty <= 0) return 0;
    const goodQty = Math.max(0, outputQty - defectQty);
    return Math.min(1, goodQty / outputQty);
  }

  /**
   * OEE 계산: 가동률 × 성능 × 품질
   */
  static calculateOEE(availability: number, performance: number, quality: number): number {
    return availability * performance * quality;
  }

  /**
   * 설비 로그에서 실제 가동시간 계산
   */
  static calculateActualRuntimeFromLogs(
    machineLogs: MachineLog[],
    shiftStart: Date,
    shiftEnd: Date
  ): number {
    let totalRuntime = 0;

    for (const log of machineLogs) {
      if (log.state !== 'NORMAL_OPERATION') continue;

      const logStart = new Date(log.start_time);
      const logEnd = log.end_time ? new Date(log.end_time) : shiftEnd;

      // 교대 시간 내의 로그만 계산
      if (logStart >= shiftEnd || logEnd <= shiftStart) continue;

      const effectiveStart = logStart > shiftStart ? logStart : shiftStart;
      const effectiveEnd = logEnd < shiftEnd ? logEnd : shiftEnd;

      if (effectiveEnd > effectiveStart) {
        const duration = (effectiveEnd.getTime() - effectiveStart.getTime()) / (1000 * 60);
        totalRuntime += duration;
      }
    }

    return totalRuntime;
  }

  /**
   * 이론 생산시간 계산 (Cavity 반영)
   */
  static calculateIdealRuntime(outputQty: number, tactTime: number, cavity: number = 1): number {
    if (tactTime <= 0 || outputQty <= 0) return 0;
    const effectiveCavity = cavity > 0 ? cavity : 1;
    return ((outputQty / effectiveCavity) * tactTime) / 60; // 분 단위로 변환
  }
}

// 기본값 (공정 정보가 없는 설비)
const DEFAULT_TACT_SECONDS = 120;
const DEFAULT_CAVITY = 1;

// 공장 표준시간대 (system_settings.general.timezone = 'Asia/Ho_Chi_Minh', UTC+7, DST 없음)
// 교대 시간(A: 08:00-20:00, B: 20:00-08:00)은 이 현지 시간 기준 벽시계 시각이다.
const PLANT_TIMEZONE = 'Asia/Ho_Chi_Minh';
const PLANT_UTC_OFFSET_HOURS = 7;

// system_settings에서 휴식 시간을 읽지 못했을 때만 사용하는 폴백 값
const DEFAULT_BREAK_MINUTES = 60;

/**
 * 주어진 시각을 공장 현지 시간 기준 'YYYY-MM-DD' 날짜 문자열로 변환
 */
function getLocalDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: PLANT_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

/**
 * system_settings(category='shift', setting_key='break_time_minutes')에서 휴식 시간(분)을 조회.
 * setting_value는 bare number 또는 {"value": N} 래퍼 형태일 수 있으므로 방어적으로 파싱한다.
 * 요청당 한 번만 호출한다 (설비별로 반복 조회하지 않음).
 * 행이 없거나 조회/파싱에 실패하면 기본값(60분)으로 폴백한다.
 */
// deno-lint-ignore no-explicit-any
async function getBreakTimeMinutes(supabase: any): Promise<number> {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('setting_value')
      .eq('category', 'shift')
      .eq('setting_key', 'break_time_minutes')
      .single();

    if (error || !data) {
      console.error('Failed to fetch break_time_minutes, falling back to default:', error);
      return DEFAULT_BREAK_MINUTES;
    }

    const raw = data.setting_value;
    const parsed = typeof raw === 'number'
      ? raw
      : (raw && typeof raw === 'object' && typeof raw.value === 'number')
        ? raw.value
        : Number(raw);

    if (!Number.isFinite(parsed) || parsed < 0) {
      console.error(`Invalid break_time_minutes value, falling back to default:`, raw);
      return DEFAULT_BREAK_MINUTES;
    }

    return parsed;
  } catch (e) {
    console.error('Error fetching break_time_minutes, falling back to default:', e);
    return DEFAULT_BREAK_MINUTES;
  }
}

/**
 * 교대 시간 계산 유틸리티
 */
class ShiftUtils {
  /**
   * 특정 날짜(공장 현지 날짜, 'YYYY-MM-DD')의 교대 시간 범위를 UTC Date로 반환.
   * 현지 08:00/20:00 벽시계 시각에 대응하는 실제 UTC 시각을 계산한다.
   */
  static getShiftTimeRanges(targetDateStr: string) {
    const [year, month, day] = targetDateStr.split('-').map(Number);

    // 현지 시각(year, month, day, hour, minute)을 UTC Date로 변환.
    // 현지시간 = UTC + PLANT_UTC_OFFSET_HOURS 이므로, UTC = 현지시간 - offset
    // Date.UTC는 day가 월의 마지막 날을 넘어가도(월/연도 롤오버) 자동으로 정규화한다.
    const localToUtc = (y: number, m: number, d: number, h: number, min: number): Date =>
      new Date(Date.UTC(y, m - 1, d, h - PLANT_UTC_OFFSET_HOURS, min, 0));

    const shiftAStart = localToUtc(year, month, day, 8, 0);
    const shiftAEnd = localToUtc(year, month, day, 20, 0);
    const shiftBStart = shiftAEnd;
    const shiftBEnd = localToUtc(year, month, day + 1, 8, 0);

    return {
      A: { start: shiftAStart, end: shiftAEnd },
      B: { start: shiftBStart, end: shiftBEnd }
    };
  }

  /**
   * 계획 가동시간 계산 (기본 12시간 교대에서 휴식시간 제외).
   * plannedBreakMinutes는 호출부에서 system_settings(category='shift', key='break_time_minutes')
   * 조회 결과를 전달한다. 기본값 60은 그 조회가 실패했을 때만 쓰이는 최종 폴백이다.
   */
  static calculatePlannedRuntime(shiftHours: number = 12, plannedBreakMinutes: number = DEFAULT_BREAK_MINUTES): number {
    return (shiftHours * 60) - plannedBreakMinutes;
  }
}

serve(async (req) => {
  try {
    // CORS 헤더 설정
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    };

    if (req.method === 'OPTIONS') {
      return new Response('ok', { headers: corsHeaders });
    }

    // Supabase 클라이언트 생성
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // 요청 파라미터 파싱
    // 날짜는 supabase.functions.invoke()가 보내는 POST 바디({ date })로 전달된다.
    // 바디가 없거나 JSON이 아닌 경우(예: curl로 직접 호출)에는 쿼리스트링(?date=)을 폴백으로 허용한다.
    const url = new URL(req.url);
    let bodyDateStr: string | undefined;
    try {
      const body = await req.json();
      if (body && typeof body.date === 'string' && body.date.trim() !== '') {
        bodyDateStr = body.date;
      }
    } catch (_e) {
      // 바디가 비어 있거나 유효한 JSON이 아님 - 무시하고 쿼리스트링/기본값으로 폴백
    }

    const targetDateStr = bodyDateStr || url.searchParams.get('date') || getLocalDateString(new Date());

    console.log(`Starting daily OEE aggregation for date: ${targetDateStr}`);

    // 휴식 시간(분)을 system_settings에서 요청당 한 번만 조회 (설비별 반복 조회 방지)
    const breakTimeMinutes = await getBreakTimeMinutes(supabase);
    console.log(`Using break time minutes: ${breakTimeMinutes}`);

    // 활성 설비 목록 조회 (현재 공정의 Tact Time / Cavity 포함)
    const { data: machines, error: machinesError } = await supabase
      .from('machines_with_production_info')
      .select('id, name, current_tact_time, current_cavity_count')
      .eq('is_active', true);

    if (machinesError) {
      throw new Error(`Failed to fetch machines: ${machinesError.message}`);
    }

    console.log(`Found ${machines?.length || 0} active machines`);

    const results = [];
    const shiftRanges = ShiftUtils.getShiftTimeRanges(targetDateStr);

    // 각 설비별로 교대별 OEE 계산
    for (const machine of machines || []) {
      for (const shift of ['A', 'B'] as const) {
        const shiftRange = shiftRanges[shift];
        
        try {
          // 해당 교대 시간과 겹치는 설비 로그 조회
          // (start_time만으로 필터링하면 교대 시작 전에 시작해서 교대 중에 끝나는 로그가
          //  누락되어 정상 가동 중인 설비가 OEE 0으로 집계되는 문제가 있었다.
          //  교대 구간과 "겹치는" 모든 로그를 가져온 뒤 calculateActualRuntimeFromLogs에서 클리핑한다.)
          const { data: machineLogs, error: logsError } = await supabase
            .from('machine_logs')
            .select('*')
            .eq('machine_id', machine.id)
            .lt('start_time', shiftRange.end.toISOString())
            .or(`end_time.is.null,end_time.gt.${shiftRange.start.toISOString()}`)
            .order('start_time', { ascending: true });

          if (logsError) {
            console.error(`Error fetching logs for machine ${machine.id}, shift ${shift}:`, logsError);
            continue;
          }

          // 기존 생산 실적 조회
          const { data: existingRecord, error: recordError } = await supabase
            .from('production_records')
            .select('*')
            .eq('machine_id', machine.id)
            .eq('date', targetDateStr)
            .eq('shift', shift)
            .single();

          if (recordError && recordError.code !== 'PGRST116') { // PGRST116 = no rows returned
            console.error(`Error fetching production record for machine ${machine.id}, shift ${shift}:`, recordError);
            continue;
          }

          // 실제 가동시간 계산
          const actualRuntime = OEECalculator.calculateActualRuntimeFromLogs(
            machineLogs || [],
            shiftRange.start,
            shiftRange.end
          );

          // 계획 가동시간 계산 (휴식 시간은 요청 시작 시 한 번 조회한 breakTimeMinutes 사용)
          const plannedRuntime = ShiftUtils.calculatePlannedRuntime(12, breakTimeMinutes);

          // Tact Time / Cavity (공정 정보가 없거나 0 이하이면 기본값 사용)
          const tactTime = machine.current_tact_time && machine.current_tact_time > 0
            ? machine.current_tact_time
            : DEFAULT_TACT_SECONDS;
          const cavity = machine.current_cavity_count && machine.current_cavity_count > 0
            ? machine.current_cavity_count
            : DEFAULT_CAVITY;

          // 생산 수량 (작업자가 입력한 실적이 있는 경우에만 사용)
          // 실적이 없으면 추정하지 않는다 (추정값은 성능을 항상 100%로 만들어 지표를 왜곡함)
          const outputQty = existingRecord?.output_qty || 0;
          const defectQty = existingRecord?.defect_qty || 0;

          if (!existingRecord) {
            console.log(`No production record for machine ${machine.name}, shift ${shift} - output_qty 0으로 집계`);
          }

          // 이론 생산시간 계산 (Cavity 반영)
          const idealRuntime = OEECalculator.calculateIdealRuntime(outputQty, tactTime, cavity);

          // OEE 지표 계산
          const availability = OEECalculator.calculateAvailability(actualRuntime, plannedRuntime);
          const performance = OEECalculator.calculatePerformance(idealRuntime, actualRuntime);
          const quality = OEECalculator.calculateQuality(outputQty, defectQty);
          const oee = OEECalculator.calculateOEE(availability, performance, quality);

          const productionRecord: ProductionRecord = {
            machine_id: machine.id,
            date: targetDateStr,
            shift,
            planned_runtime: plannedRuntime,
            actual_runtime: Math.round(actualRuntime),
            ideal_runtime: Math.round(idealRuntime),
            output_qty: outputQty,
            defect_qty: defectQty,
            availability: Math.round(availability * 10000) / 10000, // 소수점 4자리
            performance: Math.round(performance * 10000) / 10000,
            quality: Math.round(quality * 10000) / 10000,
            oee: Math.round(oee * 10000) / 10000
          };

          // 생산 실적 저장 또는 업데이트
          if (existingRecord) {
            const { error: updateError } = await supabase
              .from('production_records')
              .update(productionRecord)
              .eq('record_id', existingRecord.record_id);

            if (updateError) {
              console.error(`Error updating production record:`, updateError);
            } else {
              console.log(`Updated production record for machine ${machine.name}, shift ${shift}`);
            }
          } else {
            const { error: insertError } = await supabase
              .from('production_records')
              .insert(productionRecord);

            if (insertError) {
              console.error(`Error inserting production record:`, insertError);
            } else {
              console.log(`Created production record for machine ${machine.name}, shift ${shift}`);
            }
          }

          results.push({
            machine_id: machine.id,
            machine_name: machine.name,
            shift,
            ...productionRecord
          });

        } catch (error) {
          console.error(`Error processing machine ${machine.id}, shift ${shift}:`, error);
          continue;
        }
      }
    }

    console.log(`Completed daily OEE aggregation. Processed ${results.length} records.`);

    return new Response(
      JSON.stringify({
        success: true,
        date: targetDateStr,
        processed_records: results.length,
        results: results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error in daily OEE aggregation:', error);
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message
      }),
      {
        headers: { 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});