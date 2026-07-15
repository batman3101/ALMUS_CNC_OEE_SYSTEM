import { useState, useEffect, useCallback, useRef } from 'react';
import { format } from 'date-fns';
import { DowntimeData, ProductionData, isMachineState } from '@/types';
import { fetchJsonDeduped } from '@/lib/requestCache';

interface OEETrendData {
  date: string;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  shift: 'A' | 'B' | 'C' | 'D';
}

interface ProductivityAnalysisResponse {
  summary: {
    overall_performance: {
      avg_oee: number;
      avg_availability: number;
      avg_performance: number;
      avg_quality: number;
      total_output_qty: number;
      total_good_qty: number;
      total_defect_qty: number;
    };
  };
  trends: {
    daily: Array<{
      date: string;
      avg_oee: number;
      avg_availability: number;
      avg_performance: number;
      avg_quality: number;
      total_output: number;
      total_good_qty: number;
      defect_rate: number;
    }>;
  };
}

type OverallPerformance = ProductivityAnalysisResponse['summary']['overall_performance'];

interface DowntimeAnalysisResponse {
  downtime_by_cause: Array<{
    state: string;
    occurrence_count: number;
    total_duration: number;
    percentage: number;
  }>;
  // 설비별 비가동 (기간/교대 필터가 이미 적용된 값).
  // 설비별 표가 "전역 최근 로그 100개"로 자체 계산하던 것을 대체한다.
  machine_analysis: Array<{
    machine_id: string;
    total_downtime: number;
    downtime_events: number;
  }>;
}

/** 설비별 비가동 시간(분). 기간·교대 필터가 적용된 값이다. */
export type MachineDowntimeMap = Record<string, { totalDowntime: number; events: number }>;

interface QualityAnalysisResponse {
  trends: {
    daily: Array<{
      date: string;
      total_output: number;
      total_defects: number;
      defect_rate: number;
      avg_quality: number;
    }>;
  };
}

export const useEngineerData = (
  selectedPeriod: 'week' | 'month' | 'quarter' = 'month',
  machineId?: string,
  customDateRange?: [string, string] | null,
  selectedShifts?: string[]
) => {
  const [oeeData, setOeeData] = useState<OEETrendData[]>([]);
  const [downtimeData, setDowntimeData] = useState<DowntimeData[]>([]);
  const [productionData, setProductionData] = useState<ProductionData[]>([]);
  const [machineDowntime, setMachineDowntime] = useState<MachineDowntimeMap>({});
  const [overallPerformance, setOverallPerformance] = useState<OverallPerformance | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 요청 순번 가드: 요청을 버리지 않고 모두 진행시키되, 최신 요청이 아닌 응답은 무시한다.
  // (진행 중이라고 새 요청을 건너뛰면 필터 변경이 영영 반영되지 않는 문제가 있었음)
  const requestIdRef = useRef(0);

  // 기간별 날짜 계산 (커스텀 날짜 범위 우선 사용)
  const getDateRange = useCallback((period: 'week' | 'month' | 'quarter') => {
    // 커스텀 날짜 범위가 있으면 우선 사용
    if (customDateRange) {
      return {
        start_date: customDateRange[0],
        end_date: customDateRange[1]
      };
    }

    // 기본 기간별 계산
    const endDate = new Date();
    const startDate = new Date();

    switch (period) {
      case 'week':
        startDate.setDate(endDate.getDate() - 7);
        break;
      case 'month':
        startDate.setDate(endDate.getDate() - 30);
        break;
      case 'quarter':
        startDate.setDate(endDate.getDate() - 90);
        break;
    }

    return {
      // toISOString()은 UTC 기준으로 변환되어 KST 새벽 시간대(B조 근무 중)에 날짜가 하루 밀리는 문제가 있었음.
      // 로컬 달력 날짜를 그대로 사용하도록 date-fns format으로 변경.
      start_date: format(startDate, 'yyyy-MM-dd'),
      end_date: format(endDate, 'yyyy-MM-dd')
    };
  }, [customDateRange]);

  // OEE 추이 데이터 API 호출 (requestId가 최신이 아니면 결과를 버린다)
  const fetchOEETrendData = useCallback(async (period: 'week' | 'month' | 'quarter', requestId: number) => {
    try {
      const { start_date, end_date } = getDateRange(period);
      const params = new URLSearchParams({
        analysis_type: 'summary',
        start_date,
        end_date,
        ...(machineId && { machine_id: machineId }),
        ...(selectedShifts && selectedShifts.length > 0 && !selectedShifts.includes('all') && { 
          shift: selectedShifts.join(',') 
        })
      });

      // 동일 요청 중복 제거: OEE 추이 차트(useOEEChartData)가 같은 URL 을 조회하므로 캐시를 공유한다.
      const data = await fetchJsonDeduped<ProductivityAnalysisResponse>(
        `/api/productivity-analysis?${params}`
      );
      
      // API 응답을 차트용 데이터로 변환 (API는 이미 0-1 범위 소수점으로 반환)
      const trendData: OEETrendData[] = data.trends.daily.map(item => ({
        date: item.date,
        availability: item.avg_availability, // API는 이미 0-1 범위로 반환
        performance: item.avg_performance,
        quality: item.avg_quality,
        oee: item.avg_oee,
        shift: 'A' as const // 기본값, 실제로는 교대별 데이터 필요시 별도 처리
      }));

      console.log('OEE 트렌드 데이터:', { sampleData: trendData.slice(0, 3), totalCount: trendData.length });

      if (requestId !== requestIdRef.current) return; // 오래된 응답은 반영하지 않음
      setOverallPerformance(data.summary.overall_performance);
      setOeeData(trendData);
    } catch (error) {
      console.error('Error fetching OEE trend data:', error);
      if (requestId !== requestIdRef.current) return;
      setError(error instanceof Error ? error.message : 'Unknown error');
    }
  }, [getDateRange, machineId, selectedShifts]);

  // 다운타임 분석 데이터 API 호출 (requestId가 최신이 아니면 결과를 버린다)
  const fetchDowntimeData = useCallback(async (period: 'week' | 'month' | 'quarter', requestId: number) => {
    try {
      const { start_date, end_date } = getDateRange(period);
      const params = new URLSearchParams({
        analysis_type: 'summary',
        start_date,
        end_date,
        ...(machineId && { machine_id: machineId }),
        ...(selectedShifts && selectedShifts.length > 0 && !selectedShifts.includes('all') && { 
          shift: selectedShifts.join(',') 
        })
      });

      const response = await fetch(`/api/downtime-analysis?${params}`);
      if (!response.ok) throw new Error('Failed to fetch downtime data');

      const data: DowntimeAnalysisResponse = await response.json();
      
      // API 응답을 차트용 데이터로 변환 (알 수 없는 상태값은 제외)
      const downtimeAnalysis: DowntimeData[] = [];
      for (const item of data.downtime_by_cause) {
        if (!isMachineState(item.state)) continue;
        downtimeAnalysis.push({
          state: item.state,
          duration: item.total_duration,
          count: item.occurrence_count,
          percentage: item.percentage
        });
      }

      // 설비별 비가동 (같은 응답에 이미 기간·교대 필터가 적용되어 들어온다)
      const downtimeByMachine: MachineDowntimeMap = {};
      for (const item of data.machine_analysis || []) {
        downtimeByMachine[item.machine_id] = {
          totalDowntime: item.total_downtime,
          events: item.downtime_events
        };
      }

      console.log('다운타임 분석 데이터:', { sampleData: downtimeAnalysis.slice(0, 3), totalCount: downtimeAnalysis.length });

      if (requestId !== requestIdRef.current) return; // 오래된 응답은 반영하지 않음
      setDowntimeData(downtimeAnalysis);
      setMachineDowntime(downtimeByMachine);
    } catch (error) {
      console.error('Error fetching downtime data:', error);
      if (requestId !== requestIdRef.current) return;
      setError(error instanceof Error ? error.message : 'Unknown error');
    }
  }, [getDateRange, machineId, selectedShifts]);

  // 생산성 데이터 API 호출 (requestId가 최신이 아니면 결과를 버린다)
  const fetchProductionData = useCallback(async (period: 'week' | 'month' | 'quarter', requestId: number) => {
    try {
      const { start_date, end_date } = getDateRange(period);
      const params = new URLSearchParams({
        analysis_type: 'summary',
        start_date,
        end_date,
        ...(machineId && { machine_id: machineId }),
        ...(selectedShifts && selectedShifts.length > 0 && !selectedShifts.includes('all') && { 
          shift: selectedShifts.join(',') 
        })
      });

      const response = await fetch(`/api/quality-analysis?${params}`);
      if (!response.ok) throw new Error('Failed to fetch production data');

      const data: QualityAnalysisResponse = await response.json();
      
      // API 응답을 차트용 데이터로 변환
      const productionAnalysis: ProductionData[] = data.trends.daily.map(item => ({
        date: item.date,
        output_qty: item.total_output,
        defect_qty: item.total_defects,
        good_qty: item.total_output - item.total_defects,
        defect_rate: item.defect_rate / 100, // 백분율을 0-1로 변환
        target_qty: 0, // target_qty는 DB에 없으므로 0으로 설정 (차트에서 사용하지 않음)
        shift: 'A' as const // 기본값
      }));

      if (requestId !== requestIdRef.current) return; // 오래된 응답은 반영하지 않음
      setProductionData(productionAnalysis);
    } catch (error) {
      console.error('Error fetching production data:', error);
      if (requestId !== requestIdRef.current) return;
      setError(error instanceof Error ? error.message : 'Unknown error');
    }
  }, [getDateRange, machineId, selectedShifts]);

  // 모든 데이터 새로고침
  // 요청을 건너뛰지 않는다. 새 요청은 순번(requestId)을 받아 그대로 진행하고,
  // 뒤늦게 도착한 이전 요청의 응답과 loading 해제는 무시된다.
  const refreshData = useCallback(async () => {
    const requestId = ++requestIdRef.current;

    const dateRangeInfo = customDateRange ? `커스텀: ${customDateRange[0]} ~ ${customDateRange[1]}` : `기간: ${selectedPeriod}`;
    const shiftInfo = selectedShifts && !selectedShifts.includes('all') ? selectedShifts.join(',') : 'all';
    console.log(`🔄 엔지니어 데이터 새로고침 시작 - ${dateRangeInfo}, 설비: ${machineId || 'all'}, 교대: ${shiftInfo}`);
    setLoading(true);
    setError(null);
    setOverallPerformance(null);

    try {
      await Promise.all([
        fetchOEETrendData(selectedPeriod, requestId),
        fetchDowntimeData(selectedPeriod, requestId),
        fetchProductionData(selectedPeriod, requestId)
      ]);
      if (requestId !== requestIdRef.current) {
        console.log('⏭️ 이전 요청의 응답이라 무시함');
        return;
      }
      console.log('✅ 엔지니어 데이터 새로고침 완료');
    } catch (error) {
      console.error('❌ 엔지니어 데이터 새로고침 오류:', error);
      if (requestId !== requestIdRef.current) return;
      setError(error instanceof Error ? error.message : 'Failed to refresh data');
    } finally {
      // 최신 요청만 로딩 상태를 해제한다 (오래된 요청이 로딩을 먼저 끄면
      // 이전 필터의 데이터가 "로드 완료"처럼 보이게 됨)
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [selectedPeriod, machineId, customDateRange, selectedShifts, fetchOEETrendData, fetchDowntimeData, fetchProductionData]);

  // 기간, 설비, 날짜 범위, 교대 필터 변경시 데이터 재조회 (이 훅이 유일한 조회 주체)
  useEffect(() => {
    refreshData();
  }, [refreshData]);

  return {
    oeeData,
    downtimeData,
    productionData,
    machineDowntime,
    overallPerformance,
    loading,
    error,
    refreshData
  };
};
