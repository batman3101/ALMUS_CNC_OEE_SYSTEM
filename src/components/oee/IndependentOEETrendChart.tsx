'use client';

import React from 'react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Card, Typography, Select, DatePicker, Row, Col, Spin } from 'antd';
import { useOEEChartData } from '@/hooks/useOEEChartData';
import { useDashboardTranslation } from '@/hooks/useTranslation';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const { Title: AntTitle } = Typography;
const { RangePicker } = DatePicker;

interface IndependentOEETrendChartProps {
  title?: string;
  height?: number;
  externalPeriod?: 'week' | 'month' | 'quarter'; // 외부에서 전달받는 기간
  onPeriodChange?: (period: 'week' | 'month' | 'quarter') => void; // 기간 변경 콜백
  customDateRange?: [string, string] | null; // 커스텀 날짜 범위
  machineId?: string; // 설비 필터
  selectedShifts?: string[]; // 교대 필터
}

export const IndependentOEETrendChart: React.FC<IndependentOEETrendChartProps> = ({
  title = 'OEE 추이 분석',
  height = 400,
  externalPeriod,
  onPeriodChange,
  customDateRange,
  machineId,
  selectedShifts
}) => {
  const { t } = useDashboardTranslation();
  
  // 외부 기간이 제공되면 그것을 사용하고, 그렇지 않으면 내부 상태 사용
  const initialPeriod = externalPeriod ? 
    (externalPeriod === 'week' ? 'daily' : 
     externalPeriod === 'month' ? 'weekly' : 'monthly') : 'daily';
  
  const {
    chartData,
    loading,
    error,
    period,
    dateRange,
    handlePeriodChange: internalHandlePeriodChange,
    handleDateRangeChange
  } = useOEEChartData(initialPeriod, customDateRange, machineId, selectedShifts);
  
  // 기간 변경 핸들러 - 외부 콜백이 있으면 사용
  const handlePeriodChangeWrapper = React.useCallback((newPeriod: 'daily' | 'weekly' | 'monthly') => {
    if (onPeriodChange) {
      // 외부에서 기간을 관리하는 경우, 내부 형식을 외부 형식으로 변환
      const externalPeriodValue = newPeriod === 'daily' ? 'week' : 
                                  newPeriod === 'weekly' ? 'month' : 'quarter';
      onPeriodChange(externalPeriodValue);
    } else {
      // 내부에서 기간을 관리하는 경우
      internalHandlePeriodChange(newPeriod);
    }
  }, [onPeriodChange, internalHandlePeriodChange]);
  
  // 외부 기간 변경에 따른 내부 차트 데이터 업데이트
  React.useEffect(() => {
    if (externalPeriod) {
      const internalPeriodValue = externalPeriod === 'week' ? 'daily' : 
                                  externalPeriod === 'month' ? 'weekly' : 'monthly';
      if (period !== internalPeriodValue) {
        internalHandlePeriodChange(internalPeriodValue);
      }
    }
  }, [externalPeriod, period, internalHandlePeriodChange]);

  // 차트 데이터 구성
  const chartDataConfig = {
    labels: chartData.map(item => {
      const dateParts = item.date.split('-');
      return `${dateParts[1]}/${dateParts[2]}`;
    }),
    datasets: [
      {
        label: 'OEE',
        data: chartData.map(item => item.oee * 100),
        borderColor: '#1890ff',
        backgroundColor: 'rgba(24, 144, 255, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
      },
      {
        label: t('oee.availability'),
        data: chartData.map(item => item.availability * 100),
        borderColor: '#52c41a',
        backgroundColor: 'rgba(82, 196, 26, 0.1)',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
      },
      {
        label: t('oee.performance'),
        data: chartData.map(item => item.performance * 100),
        borderColor: '#faad14',
        backgroundColor: 'rgba(250, 173, 20, 0.1)',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
      },
      {
        label: t('oee.quality'),
        data: chartData.map(item => item.quality * 100),
        borderColor: '#722ed1',
        backgroundColor: 'rgba(114, 46, 209, 0.1)',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
      },
    ],
  };

  // 차트 옵션
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'top' as const,
        labels: {
          usePointStyle: true,
          padding: 20,
        },
      },
      tooltip: {
        mode: 'index',
        intersect: false,
        callbacks: {
          label: function(context) {
            return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
          },
        },
      },
    },
    interaction: {
      mode: 'nearest',
      axis: 'x',
      intersect: false,
    },
    scales: {
      x: {
        display: true,
        title: {
          display: true,
          text: t('time.date'),
        },
        grid: {
          display: true,
          color: 'rgba(0, 0, 0, 0.1)',
        },
      },
      y: {
        display: true,
        title: {
          display: true,
          text: t('chart.percentage'),
        },
        min: 0,
        max: 100,
        grid: {
          display: true,
          color: 'rgba(0, 0, 0, 0.1)',
        },
        ticks: {
          callback: function(value) {
            return value + '%';
          },
        },
      },
    },
    elements: {
      point: {
        radius: 4,
        hoverRadius: 6,
      },
    },
  };

  // 기간 선택 옵션
  const periodOptions = [
    { label: '일별 (7일)', value: 'daily' },
    { label: '주별 (30일)', value: 'weekly' },
    { label: '월별 (90일)', value: 'monthly' },
  ];

  if (error) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '50px', color: '#ff4d4f' }}>
          오류가 발생했습니다: {error}
        </div>
      </Card>
    );
  }

  return (
    <Card>
      {/* 제목 */}
      <div style={{ marginBottom: 16 }}>
        <AntTitle level={4} style={{ margin: 0 }}>
          {title} {loading && <Spin size="small" style={{ marginLeft: 8 }} />}
        </AntTitle>
      </div>

      {/* 차트 */}
      <div style={{ height, position: 'relative' }}>
        {loading && (
          <div style={{ 
            position: 'absolute', 
            top: '50%', 
            left: '50%', 
            transform: 'translate(-50%, -50%)',
            zIndex: 10 
          }}>
            <Spin size="large" />
          </div>
        )}
        <Line data={chartDataConfig} options={options} />
      </div>

      {/* 통계 요약 */}
      <div style={{ marginTop: 16, padding: '16px 0', borderTop: '1px solid #f0f0f0' }}>
        <Row gutter={[32, 16]} justify="center">
          <Col>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1890ff' }}>
                {chartData.length > 0 ? (chartData.reduce((sum, item) => sum + item.oee, 0) / chartData.length * 100).toFixed(1) : 0}%
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>평균 OEE</div>
            </div>
          </Col>
          
          <Col>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#52c41a' }}>
                {chartData.length > 0 ? Math.max(...chartData.map(item => item.oee * 100)).toFixed(1) : 0}%
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>최고 OEE</div>
            </div>
          </Col>
          
          <Col>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#ff4d4f' }}>
                {chartData.length > 0 ? Math.min(...chartData.map(item => item.oee * 100)).toFixed(1) : 0}%
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>최저 OEE</div>
            </div>
          </Col>
          
          <Col>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#722ed1' }}>
                {chartData.filter(item => item.oee >= 0.85).length}
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>우수한 날</div>
            </div>
          </Col>
        </Row>
      </div>
    </Card>
  );
};