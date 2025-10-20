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
   * 이론 생산시간 계산
   */
  static calculateIdealRuntime(outputQty: number, tactTime: number): number {
    if (tactTime <= 0) return 0;
    return (outputQty * tactTime) / 60; // 분 단위로 변환
  }
}

/**
 * 교대 시간 계산 유틸리티
 */
class ShiftUtils {
  /**
   * 특정 날짜의 교대 시간 범위 반환
   */
  static getShiftTimeRanges(date: Date) {
    const targetDate = new Date(date);
    const nextDay = new Date(targetDate.getTime() + 24 * 60 * 60 * 1000);
    
    return {
      A: {
        start: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 8, 0, 0),
        end: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 20, 0, 0)
      },
      B: {
        start: new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 20, 0, 0),
        end: new Date(nextDay.getFullYear(), nextDay.getMonth(), nextDay.getDate(), 8, 0, 0)
      }
    };
  }

  /**
   * 계획 가동시간 계산 (12시간 교대에서 휴식시간 제외)
   */
  static calculatePlannedRuntime(shiftHours: number = 12, plannedBreakMinutes: number = 60): number {
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
    const url = new URL(req.url);
    const targetDateStr = url.searchParams.get('date') || new Date().toISOString().split('T')[0];
    const targetDate = new Date(targetDateStr);

    console.log(`Starting daily OEE aggregation for date: ${targetDateStr}`);

    // 활성 설비 목록 조회
    const { data: machines, error: machinesError } = await supabase
      .from('machines')
      .select('id, name, default_tact_time')
      .eq('is_active', true);

    if (machinesError) {
      throw new Error(`Failed to fetch machines: ${machinesError.message}`);
    }

    console.log(`Found ${machines?.length || 0} active machines`);

    const results = [];
    const shiftRanges = ShiftUtils.getShiftTimeRanges(targetDate);

    // 각 설비별로 교대별 OEE 계산
    for (const machine of machines || []) {
      for (const shift of ['A', 'B'] as const) {
        const shiftRange = shiftRanges[shift];
        
        try {
          // 해당 교대 시간의 설비 로그 조회
          const { data: machineLogs, error: logsError } = await supabase
            .from('machine_logs')
            .select('*')
            .eq('machine_id', machine.id)
            .gte('start_time', shiftRange.start.toISOString())
            .lt('start_time', shiftRange.end.toISOString())
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

          // 계획 가동시간 계산
          const plannedRuntime = ShiftUtils.calculatePlannedRuntime();

          // 생산 수량 (기존 실적이 있으면 사용, 없으면 Tact Time 기반 추정)
          let outputQty = existingRecord?.output_qty || 0;
          let defectQty = existingRecord?.defect_qty || 0;

          // 생산 실적이 없고 실제 가동시간이 있으면 Tact Time 기반으로 추정
          if (!existingRecord && actualRuntime > 0) {
            const estimatedOutput = Math.floor(actualRuntime * 60 / machine.default_tact_time);
            outputQty = estimatedOutput;
            console.log(`Estimated output for machine ${machine.name}, shift ${shift}: ${estimatedOutput} units`);
          }

          // 이론 생산시간 계산
          const idealRuntime = OEECalculator.calculateIdealRuntime(outputQty, machine.default_tact_time);

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