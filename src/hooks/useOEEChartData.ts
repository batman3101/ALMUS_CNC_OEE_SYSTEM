'use client';

import { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';

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
      // toISOString()은 UTC 기준으로 변환되어 KST 새벽 시간대(B조 근무 중)에 날짜가 하루 밀리는 문제가 있었음.
      // 로컬 달력 날짜를 그대로 사용하도록 date-fns format으로 변경.
      start_date: format(startDate, 'yyyy-MM-dd'),
      end_date: format(endDate, 'yyyy-MM-dd')
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

  // 기간 변경 핸들러 (실제 조회는 아래 통합 effect가 상태 변경을 감지해서 수행)
  const handlePeriodChange = useCallback((newPeriod: 'daily' | 'weekly' | 'monthly') => {
    console.log('📈 차트 기간 변경:', period, '->', newPeriod);
    setPeriod(newPeriod);
    setDateRange(null); // 사용자 정의 날짜 범위 초기화
  }, [period]);

  // 날짜 범위 변경 핸들러 (실제 조회는 아래 통합 effect가 상태 변경을 감지해서 수행)
  const handleDateRangeChange = useCallback((dates: [string, string] | null) => {
    console.log('📅 차트 날짜 범위 변경:', dates);
    setDateRange(dates);
  }, []);

  // 기간/날짜범위/설비/교대 필터가 바뀔 때마다 재조회.
  // fetchChartData는 machineId, selectedShifts, externalCustomDateRange가 실제로 변경될 때만
  // 재생성되므로(내부에서 조회 결과 상태를 의존하지 않음) 무한 루프 없이 안전하게 의존성에 포함할 수 있음.
  useEffect(() => {
    fetchChartData(period, dateRange);
  }, [period, dateRange, externalCustomDateRange, machineId, selectedShifts, fetchChartData]);

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