'use client';

import { useState, useEffect, useCallback } from 'react';

interface OEEChartData {
  date: string;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  shift?: 'A' | 'B';
}

interface ProductivityAnalysisResponse {
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

export const useOEEChartData = (
  initialPeriod: 'daily' | 'weekly' | 'monthly' = 'daily', 
  externalCustomDateRange?: [string, string] | null,
  machineId?: string,
  selectedShifts?: string[]
) => {
  const [chartData, setChartData] = useState<OEEChartData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>(initialPeriod);
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);

  // 기간별 날짜 계산
  const getDateRangeForPeriod = useCallback((periodType: 'daily' | 'weekly' | 'monthly') => {
    const endDate = new Date();
    const startDate = new Date();

    switch (periodType) {
      case 'daily':
        startDate.setDate(endDate.getDate() - 7); // 7일
        break;
      case 'weekly':
        startDate.setDate(endDate.getDate() - 30); // 30일
        break;
      case 'monthly':
        startDate.setDate(endDate.getDate() - 90); // 90일
        break;
    }

    return {
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0]
    };
  }, []);

  // API 데이터 가져오기
  const fetchChartData = useCallback(async (
    periodType: 'daily' | 'weekly' | 'monthly',
    customDateRange?: [string, string] | null
  ) => {
    try {
      setLoading(true);
      setError(null);

      // 외부에서 전달된 커스텀 날짜 범위를 우선 사용
      const effectiveCustomRange = externalCustomDateRange || customDateRange;
      const { start_date, end_date } = effectiveCustomRange 
        ? { start_date: effectiveCustomRange[0], end_date: effectiveCustomRange[1] }
        : getDateRangeForPeriod(periodType);

      const params = new URLSearchParams({
        analysis_type: 'summary',
        start_date,
        end_date,
        ...(machineId && { machine_id: machineId }),
        ...(selectedShifts && selectedShifts.length > 0 && !selectedShifts.includes('all') && { 
          shift: selectedShifts.join(',') 
        })
      });

      console.log('🔍 OEE 차트 데이터 API 호출:', { 
        periodType, 
        start_date, 
        end_date, 
        customDateRange 
      });

      const response = await fetch(`/api/productivity-analysis?${params}`);
      if (!response.ok) throw new Error('Failed to fetch OEE chart data');

      const data: ProductivityAnalysisResponse = await response.json();
      
      // API 응답을 차트용 데이터로 변환
      const trendData: OEEChartData[] = data.trends.daily.map(item => ({
        date: item.date,
        availability: item.avg_availability,
        performance: item.avg_performance,
        quality: item.avg_quality,
        oee: item.avg_oee,
        shift: 'A' as const
      }));

      console.log('📊 OEE 차트 데이터 처리 완료:', { 
        dataLength: trendData.length, 
        sampleData: trendData.slice(0, 3),
        externalCustomRange: externalCustomDateRange
      });

      setChartData(trendData);
    } catch (error) {
      console.error('❌ OEE 차트 데이터 가져오기 오류:', error);
      setError(error instanceof Error ? error.message : 'Unknown error');
      setChartData([]);
    } finally {
      setLoading(false);
    }
  }, [getDateRangeForPeriod, externalCustomDateRange, machineId, selectedShifts]);

  // 기간 변경 핸들러
  const handlePeriodChange = useCallback((newPeriod: 'daily' | 'weekly' | 'monthly') => {
    console.log('📈 차트 기간 변경:', period, '->', newPeriod);
    setPeriod(newPeriod);
    setDateRange(null); // 사용자 정의 날짜 범위 초기화
    fetchChartData(newPeriod, null);
  }, [fetchChartData, period, machineId, selectedShifts]);

  // 날짜 범위 변경 핸들러
  const handleDateRangeChange = useCallback((dates: [string, string] | null) => {
    console.log('📅 차트 날짜 범위 변경:', dates);
    setDateRange(dates);
    fetchChartData(period, dates);
  }, [fetchChartData, period, machineId, selectedShifts]);

  // 초기 데이터 로드
  useEffect(() => {
    fetchChartData(period, dateRange);
  }, []); // 의존성 배열을 비워서 초기화 시에만 호출

  // 외부 커스텀 날짜 범위 변경 감지
  useEffect(() => {
    if (externalCustomDateRange) {
      fetchChartData(period, null); // 외부 범위는 fetchChartData에서 처리
    }
  }, [externalCustomDateRange, period, fetchChartData]);

  return {
    chartData,
    loading,
    error,
    period,
    dateRange,
    handlePeriodChange,
    handleDateRangeChange,
    refreshData: () => fetchChartData(period, dateRange)
  };
};