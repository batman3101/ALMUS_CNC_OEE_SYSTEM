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
}

export const IndependentOEETrendChart: React.FC<IndependentOEETrendChartProps> = ({
  title = 'OEE 추이 분석',
  height = 400,
}) => {
  const { t } = useDashboardTranslation();
  
  const {
    chartData,
    loading,
    error,
    period,
    dateRange,
    handlePeriodChange,
    handleDateRangeChange
  } = useOEEChartData('daily');

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
      {/* 제목 및 컨트롤 */}
      <div style={{ marginBottom: 16 }}>
        <Row justify="space-between" align="middle">
          <Col>
            <AntTitle level={4} style={{ margin: 0 }}>
              {title} {loading && <Spin size="small" style={{ marginLeft: 8 }} />}
            </AntTitle>
          </Col>
          
          <Col>
            <Row gutter={16} align="middle">
              <Col>
                <Select
                  value={period}
                  options={periodOptions}
                  onChange={handlePeriodChange}
                  style={{ width: 120 }}
                  loading={loading}
                />
              </Col>
              <Col>
                <RangePicker
                  value={dateRange ? [dateRange[0], dateRange[1]] as any : null}
                  onChange={(dates, dateStrings) => {
                    handleDateRangeChange(dates ? [dateStrings[0], dateStrings[1]] : null);
                  }}
                  format="YYYY-MM-DD"
                  placeholder={['시작일', '종료일']}
                  disabled={loading}
                />
              </Col>
            </Row>
          </Col>
        </Row>
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