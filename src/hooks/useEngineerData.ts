import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { DowntimeData, ProductionData, isMachineState } from '@/types';

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

interface DowntimeAnalysisResponse {
  downtime_by_cause: Array<{
    state: string;
    occurrence_count: number;
    total_duration: number;
    percentage: number;
  }>;
}

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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  // OEE 추이 데이터 API 호출
  const fetchOEETrendData = useCallback(async (period: 'week' | 'month' | 'quarter') => {
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

      const response = await fetch(`/api/productivity-analysis?${params}`);
      if (!response.ok) throw new Error('Failed to fetch OEE trend data');

      const data: ProductivityAnalysisResponse = await response.json();
      
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

      setOeeData(trendData);
    } catch (error) {
      console.error('Error fetching OEE trend data:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    }
  }, [getDateRange, machineId, selectedShifts]);

  // 다운타임 분석 데이터 API 호출
  const fetchDowntimeData = useCallback(async (period: 'week' | 'month' | 'quarter') => {
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

      console.log('다운타임 분석 데이터:', { sampleData: downtimeAnalysis.slice(0, 3), totalCount: downtimeAnalysis.length });

      setDowntimeData(downtimeAnalysis);
    } catch (error) {
      console.error('Error fetching downtime data:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    }
  }, [getDateRange, machineId, selectedShifts]);

  // 생산성 데이터 API 호출
  const fetchProductionData = useCallback(async (period: 'week' | 'month' | 'quarter') => {
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

      setProductionData(productionAnalysis);
    } catch (error) {
      console.error('Error fetching production data:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
    }
  }, [getDateRange, machineId, selectedShifts]);

  // 모든 데이터 새로고침
  const refreshData = useCallback(async () => {
    const dateRangeInfo = customDateRange ? `커스텀: ${customDateRange[0]} ~ ${customDateRange[1]}` : `기간: ${selectedPeriod}`;
    const shiftInfo = selectedShifts && !selectedShifts.includes('all') ? selectedShifts.join(',') : 'all';
    console.log(`🔄 엔지니어 데이터 새로고침 시작 - ${dateRangeInfo}, 설비: ${machineId || 'all'}, 교대: ${shiftInfo}`);
    setLoading(true);
    setError(null);

    try {
      await Promise.all([
        fetchOEETrendData(selectedPeriod),
        fetchDowntimeData(selectedPeriod),
        fetchProductionData(selectedPeriod)
      ]);
      console.log('✅ 엔지니어 데이터 새로고침 완료');
    } catch (error) {
      console.error('❌ 엔지니어 데이터 새로고침 오류:', error);
      setError(error instanceof Error ? error.message : 'Failed to refresh data');
    } finally {
      setLoading(false);
    }
  }, [selectedPeriod, machineId, customDateRange, selectedShifts, fetchOEETrendData, fetchDowntimeData, fetchProductionData]);

  // 기간이나 커스텀 날짜 범위 변경시 데이터 재조회
  useEffect(() => {
    refreshData();
  }, [refreshData]);

  return {
    oeeData,
    downtimeData,
    productionData,
    loading,
    error,
    refreshData
  };
};