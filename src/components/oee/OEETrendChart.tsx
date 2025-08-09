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
  // 차트 데이터 구성 (하이드레이션 오류 방지를 위해 간단한 포맷 사용)
  const chartData = {
    labels: data.map(item => {
      // 간단한 문자열 조작으로 날짜 포맷팅 (로케일 독립적)
      const dateParts = item.date.split('-');
      return `${dateParts[1]}/${dateParts[2]}`;
    }),
    datasets: [
      {
        label: 'OEE',
        data: data.map(item => item.oee * 100),
        borderColor: '#1890ff',
        backgroundColor: 'rgba(24, 144, 255, 0.1)',
        borderWidth: 3,
        fill: true,
        tension: 0.4,
      },
      {
        label: '가동률',
        data: data.map(item => item.availability * 100),
        borderColor: '#52c41a',
        backgroundColor: 'rgba(82, 196, 26, 0.1)',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
      },
      {
        label: '성능',
        data: data.map(item => item.performance * 100),
        borderColor: '#faad14',
        backgroundColor: 'rgba(250, 173, 20, 0.1)',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
      },
      {
        label: '품질',
        data: data.map(item => item.quality * 100),
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
          text: '날짜',
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
          text: '비율 (%)',
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
    { label: '일별', value: 'daily' },
    { label: '주별', value: 'weekly' },
    { label: '월별', value: 'monthly' },
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
                    placeholder={['시작일', '종료일']}
                  />
                </Col>
              </Row>
            </Col>
          )}
        </Row>
      </div>

      {/* 차트 */}
      <div style={{ height }}>
        <Line data={chartData} options={options} />
      </div>

      {/* 통계 요약 */}
      <div style={{ marginTop: 16, padding: '16px 0', borderTop: '1px solid #f0f0f0' }}>
        <Row gutter={[32, 16]} justify="center">
          <Col>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1890ff' }}>
                {data.length > 0 ? (data.reduce((sum, item) => sum + item.oee, 0) / data.length * 100).toFixed(1) : 0}%
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>평균 OEE</div>
            </div>
          </Col>
          
          <Col>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#52c41a' }}>
                {data.length > 0 ? Math.max(...data.map(item => item.oee * 100)).toFixed(1) : 0}%
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>최고 OEE</div>
            </div>
          </Col>
          
          <Col>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#ff4d4f' }}>
                {data.length > 0 ? Math.min(...data.map(item => item.oee * 100)).toFixed(1) : 0}%
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>최저 OEE</div>
            </div>
          </Col>
          
          <Col>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 20, fontWeight: 'bold', color: '#722ed1' }}>
                {data.filter(item => item.oee >= 0.85).length}
              </div>
              <div style={{ fontSize: 12, color: '#666' }}>우수 일수</div>
            </div>
          </Col>
        </Row>
      </div>
    </Card>
  );
};