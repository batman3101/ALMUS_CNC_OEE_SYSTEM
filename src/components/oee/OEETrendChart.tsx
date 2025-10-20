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
import { Card, Typography, Select, DatePicker, Row, Col } from 'antd';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';
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

interface OEETrendData {
  date: string;
  availability: number;
  performance: number;
  quality: number;
  oee: number;
  shift?: 'A' | 'B';
}

interface OEETrendChartProps {
  data: OEETrendData[];
  title?: string;
  height?: number;
  showControls?: boolean;
  onDateRangeChange?: (dates: [string, string] | null) => void;
  onPeriodChange?: (period: 'daily' | 'weekly' | 'monthly') => void;
}

export const OEETrendChart: React.FC<OEETrendChartProps> = ({
  data,
  title = 'OEE 추이',
  height = 400,
  showControls = true,
  onDateRangeChange,
  onPeriodChange
}) => {
  const { t } = useDashboardTranslation();
  
  // 데이터 로깅 (디버깅용)
  React.useEffect(() => {
    console.log('📈 OEETrendChart 받은 데이터:', {
      dataLength: data.length,
      sampleData: data.slice(0, 3),
      title,
      allDates: data.map(item => item.date)
    });

    if (data.length === 0) {
      console.warn('⚠️ OEETrendChart: 데이터가 비어있습니다!');
    }
  }, [data, title]);
  // 차트 데이터 구성 (하이드레이션 오류 방지를 위해 간단한 포맷 사용)
  const chartData = {
    labels: data.map(item => {
      try {
        // 날짜 문자열 처리 개선
        const dateStr = item.date;
        if (!dateStr) return '';

        // YYYY-MM-DD 형식인 경우
        if (dateStr.includes('-')) {
          const dateParts = dateStr.split('-');
          if (dateParts.length === 3) {
            return `${dateParts[1]}/${dateParts[2]}`;
          }
        }

        // 다른 형식일 경우 Date 객체로 변환
        const date = new Date(dateStr);
        if (!isNaN(date.getTime())) {
          const month = String(date.getMonth() + 1).padStart(2, '0');
          const day = String(date.getDate()).padStart(2, '0');
          return `${month}/${day}`;
        }

        return dateStr; // 파싱 실패 시 원본 반환
      } catch (error) {
        console.error('날짜 포맷 오류:', error, item.date);
        return String(item.date);
      }
    }),
    datasets: [
      {
        label: 'OEE',
        data: data.map(item => (item.oee || 0) * 100),
        borderColor: '#1890ff',
        backgroundColor: 'rgba(24, 144, 255, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
        pointRadius: 5,
        pointHoverRadius: 7,
      },
      {
        label: t('oee.availability'),
        data: data.map(item => (item.availability || 0) * 100),
        borderColor: '#52c41a',
        backgroundColor: 'rgba(82, 196, 26, 0.1)',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
      {
        label: t('oee.performance'),
        data: data.map(item => (item.performance || 0) * 100),
        borderColor: '#faad14',
        backgroundColor: 'rgba(250, 173, 20, 0.1)',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
      {
        label: t('oee.quality'),
        data: data.map(item => (item.quality || 0) * 100),
        borderColor: '#722ed1',
        backgroundColor: 'rgba(114, 46, 209, 0.1)',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        pointRadius: 4,
        pointHoverRadius: 6,
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
          afterLabel: function(context) {
            const dataIndex = context.dataIndex;
            const item = data[dataIndex];
            if (item.shift) {
              return `교대: ${item.shift}`;
            }
            return '';
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
    { label: t('oee.daily'), value: 'daily' },
    { label: t('oee.weekly'), value: 'weekly' },
    { label: t('oee.monthly'), value: 'monthly' },
  ];

  return (
    <Card>
      {/* 제목 및 컨트롤 */}
      <div style={{ marginBottom: 16 }}>
        <Row justify="space-between" align="middle">
          <Col>
            <AntTitle level={4} style={{ margin: 0 }}>
              {title}
            </AntTitle>
          </Col>
          
          {showControls && (
            <Col>
              <Row gutter={16} align="middle">
                <Col>
                  <Select
                    defaultValue="daily"
                    options={periodOptions}
                    onChange={onPeriodChange}
                    style={{ width: 100 }}
                  />
                </Col>
                <Col>
                  <RangePicker
                    onChange={(dates, dateStrings) => {
                      if (onDateRangeChange) {
                        onDateRangeChange(dates ? [dateStrings[0], dateStrings[1]] : null);
                      }
                    }}
                    format="YYYY-MM-DD"
                    placeholder={[t('time.startDate'), t('time.endDate')]}
                  />
                </Col>
              </Row>
            </Col>
          )}
        </Row>
      </div>

      {/* 차트 */}
      <div style={{ height }}>
        {data.length === 0 ? (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#666',
            fontSize: 16
          }}>
            선택된 기간에 데이터가 없습니다
          </div>
        ) : (
          <Line data={chartData} options={options} />
        )}
      </div>

      {/* 통계 요약 */}
      <div style={{ marginTop: 16, padding: '16px 0', borderTop: '1px solid #f0f0f0' }}>
        <Row gutter={[32, 16]} justify="center">
          <Col>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1890ff' }}>
                {data.length > 0 ? (data.reduce((sum, item) => sum + item.oee, 0) / data.length * 100).toFixed(1) : 0}%
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>{t('oee.average')}</div>
            </div>
          </Col>
          
          <Col>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#52c41a' }}>
                {data.length > 0 ? Math.max(...data.map(item => item.oee * 100)).toFixed(1) : 0}%
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>{t('oee.highest')}</div>
            </div>
          </Col>
          
          <Col>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#ff4d4f' }}>
                {data.length > 0 ? Math.min(...data.map(item => item.oee * 100)).toFixed(1) : 0}%
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>{t('oee.lowest')}</div>
            </div>
          </Col>
          
          <Col>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#722ed1' }}>
                {data.filter(item => item.oee >= 0.85).length}
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>{t('oee.excellentDays')}</div>
            </div>
          </Col>
        </Row>
      </div>
    </Card>
  );
};