import { supabase } from '@/lib/supabase';

export interface OEEAggregationResult {
  success: boolean;
  date: string;
  processed_records: number;
  results?: Array<{
    machine_id: string;
    machine_name: string;
    shift: 'A' | 'B';
    availability: number;
    performance: number;
    quality: number;
    oee: number;
    output_qty: number;
    defect_qty: number;
  }>;
  error?: string;
}

export interface AggregationLogEntry {
  id: string;
  execution_date: string;
  target_date: string;
  status: 'started' | 'completed' | 'failed';
  processed_records: number;
  error_message?: string;
  execution_time_ms?: number;
  created_at: string;
}

/**
 * OEE 집계 관련 유틸리티 클래스
 */
export class OEEAggregationService {
  /**
   * 수동으로 일일 OEE 집계 실행
   * @param targetDate 집계할 날짜 (YYYY-MM-DD 형식)
   * @returns 집계 결과
   */
  static async triggerDailyAggregation(targetDate?: string): Promise<OEEAggregationResult> {
    try {
      const date = targetDate || new Date().toISOString().split('T')[0];
      
      // Supabase Edge Function 호출
      const { data, error } = await supabase.functions.invoke('daily-oee-aggregation', {
        body: { date }
      });

      if (error) {
        throw new Error(`Failed to trigger OEE aggregation: ${error.message}`);
      }

      return data as OEEAggregationResult;
    } catch (error) {
      console.error('Error triggering OEE aggregation:', error);
      return {
        success: false,
        date: targetDate || new Date().toISOString().split('T')[0],
        processed_records: 0,
        error: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  /**
   * 데이터베이스 함수를 통한 OEE 집계 실행 (대안 방법)
   * @param targetDate 집계할 날짜
   * @returns 실행 결과 메시지
   */
  static async triggerAggregationViaFunction(targetDate?: Date): Promise<string> {
    try {
      const { data, error } = await supabase.rpc('trigger_daily_oee_aggregation', {
        target_date: targetDate || new Date()
      });

      if (error) {
        throw new Error(`Failed to trigger aggregation via function: ${error.message}`);
      }

      return data as string;
    } catch (error) {
      console.error('Error triggering aggregation via function:', error);
      throw error;
    }
  }

  /**
   * OEE 집계 로그 조회
   * @param limit 조회할 로그 수
   * @param targetDate 특정 날짜의 로그만 조회 (선택사항)
   * @returns 집계 로그 배열
   */
  static async getAggregationLogs(
    limit: number = 50,
    targetDate?: string
  ): Promise<AggregationLogEntry[]> {
    try {
      let query = supabase
        .from('oee_aggregation_log')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (targetDate) {
        query = query.eq('target_date', targetDate);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error(`Failed to fetch aggregation logs: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('Error fetching aggregation logs:', error);
      return [];
    }
  }

  /**
   * 특정 날짜의 최신 집계 상태 조회
   * @param targetDate 조회할 날짜
   * @returns 집계 상태 정보
   */
  static async getAggregationStatus(targetDate: string): Promise<AggregationLogEntry | null> {
    try {
      const { data, error } = await supabase
        .from('oee_aggregation_log')
        .select('*')
        .eq('target_date', targetDate)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw new Error(`Failed to fetch aggregation status: ${error.message}`);
      }

      return data || null;
    } catch (error) {
      console.error('Error fetching aggregation status:', error);
      return null;
    }
  }

  /**
   * 집계가 필요한 날짜들 조회 (생산 실적이 없거나 오래된 날짜)
   * @param daysBack 며칠 전까지 확인할지
   * @returns 집계가 필요한 날짜 배열
   */
  static async getMissingAggregationDates(daysBack: number = 7): Promise<string[]> {
    try {
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - daysBack);

      // 활성 설비 수 조회
      const { data: machines, error: machinesError } = await supabase
        .from('machines')
        .select('id')
        .eq('is_active', true);

      if (machinesError) {
        throw new Error(`Failed to fetch machines: ${machinesError.message}`);
      }

      const expectedRecordsPerDay = (machines?.length || 0) * 2; // A교대 + B교대
      const missingDates: string[] = [];

      // 각 날짜별로 생산 실적 확인
      for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const dateStr = d.toISOString().split('T')[0];
        
        const { data: records, error: recordsError } = await supabase
          .from('production_records')
          .select('record_id')
          .eq('date', dateStr);

        if (recordsError) {
          console.error(`Error checking records for ${dateStr}:`, recordsError);
          continue;
        }

        const actualRecords = records?.length || 0;
        
        // 예상 레코드 수의 50% 미만이면 집계가 필요한 것으로 판단
        if (actualRecords < expectedRecordsPerDay * 0.5) {
          missingDates.push(dateStr);
        }
      }

      return missingDates;
    } catch (error) {
      console.error('Error finding missing aggregation dates:', error);
      return [];
    }
  }

  /**
   * 여러 날짜에 대해 일괄 집계 실행
   * @param dates 집계할 날짜 배열
   * @returns 각 날짜별 집계 결과
   */
  static async batchAggregation(dates: string[]): Promise<OEEAggregationResult[]> {
    const results: OEEAggregationResult[] = [];

    for (const date of dates) {
      try {
        console.log(`Starting aggregation for date: ${date}`);
        const result = await this.triggerDailyAggregation(date);
        results.push(result);
        
        // 각 요청 사이에 잠시 대기 (API 부하 방지)
        await new Promise(resolve => setTimeout(resolve, 1000));
      } catch (error) {
        console.error(`Error aggregating date ${date}:`, error);
        results.push({
          success: false,
          date,
          processed_records: 0,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return results;
  }

  /**
   * 집계 실행 가능 여부 확인 (관리자 권한 체크)
   * @returns 실행 가능 여부
   */
  static async canTriggerAggregation(): Promise<boolean> {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      
      if (!user) {
        return false;
      }

      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('role, is_active')
        .eq('user_id', user.id)
        .single();

      if (error) {
        console.error('Error checking user profile:', error);
        return false;
      }

      return profile?.role === 'admin' && profile?.is_active === true;
    } catch (error) {
      console.error('Error checking aggregation permission:', error);
      return false;
    }
  }

  /**
   * 집계 진행 상황 모니터링
   * @param targetDate 모니터링할 날짜
   * @param onProgress 진행 상황 콜백
   * @param timeoutMs 타임아웃 시간 (밀리초)
   * @returns 최종 집계 결과
   */
  static async monitorAggregationProgress(
    targetDate: string,
    onProgress?: (status: AggregationLogEntry) => void,
    timeoutMs: number = 60000
  ): Promise<AggregationLogEntry | null> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getAggregationStatus(targetDate);
      
      if (status) {
        onProgress?.(status);
        
        if (status.status === 'completed' || status.status === 'failed') {
          return status;
        }
      }
      
      // 2초마다 상태 확인
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    return null; // 타임아웃
  }
}

/**
 * 집계 상태를 사용자 친화적인 메시지로 변환
 */
export const getAggregationStatusMessage = (status: AggregationLogEntry): string => {
  switch (status.status) {
    case 'started':
      return '집계 작업이 시작되었습니다...';
    case 'completed':
      return `집계 완료: ${status.processed_records}개 레코드 처리됨`;
    case 'failed':
      return `집계 실패: ${status.error_message || '알 수 없는 오류'}`;
    default:
      return '알 수 없는 상태';
  }
};

/**
 * 집계 결과를 요약 통계로 변환
 */
export const summarizeAggregationResults = (results: OEEAggregationResult[]) => {
  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);
  const totalRecords = successful.reduce((sum, r) => sum + r.processed_records, 0);

  return {
    totalDates: results.length,
    successfulDates: successful.length,
    failedDates: failed.length,
    totalRecordsProcessed: totalRecords,
    successRate: results.length > 0 ? (successful.length / results.length) * 100 : 0
  };
};