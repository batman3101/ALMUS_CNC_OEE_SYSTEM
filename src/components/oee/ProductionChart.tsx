'use client';

import React from 'react';
import { Bar, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend,
  ChartOptions,
} from 'chart.js';
import { Card, Typography, Select, Row, Col, Statistic } from 'antd';
import { format } from 'date-fns';
import { ko } from 'date-fns/locale';

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  LineElement,
  PointElement,
  Title,
  Tooltip,
  Legend
);

const { Title: AntTitle } = Typography;

interface ProductionData {
  date: string;
  output_qty: number;
  defect_qty: number;
  good_qty: number;
  defect_rate: number;
  target_qty?: number;
  shift?: 'A' | 'B';
}

interface ProductionChartProps {
  data: ProductionData[];
  title?: string;
  height?: number;
  chartType?: 'bar' | 'line';
  showControls?: boolean;
  onChartTypeChange?: (type: 'bar' | 'line') => void;
}

export const ProductionChart: React.FC<ProductionChartProps> = ({
  data,
  title = '생산 실적',
  height = 400,
  chartType = 'bar',
  showControls = true,
  onChartTypeChange
}) => {
  // 차트 데이터 구성
  const chartData = {
    labels: data.map(item => {
      const date = new Date(item.date);
      return format(date, 'MM/dd', { locale: ko });
    }),
    datasets: [
      {
        type: chartType as const,
        label: '양품 수량',
        data: data.map(item => item.good_qty),
        backgroundColor: 'rgba(82, 196, 26, 0.8)',
        borderColor: '#52c41a',
        borderWidth: 2,
        yAxisID: 'y',
      },
      {
        type: chartType as const,
        label: '불량 수량',
        data: data.map(item => item.defect_qty),
        backgroundColor: 'rgba(255, 77, 79, 0.8)',
        borderColor: '#ff4d4f',
        borderWidth: 2,
        yAxisID: 'y',
      },
      ...(data.some(item => item.target_qty) ? [{
        type: 'line' as const,
        label: '목표 수량',
        data: data.map(item => item.target_qty || 0),
        borderColor: '#1890ff',
        backgroundColor: 'rgba(24, 144, 255, 0.1)',
        borderWidth: 2,
        borderDash: [5, 5],
        fill: false,
        tension: 0.4,
        yAxisID: 'y',
        pointBackgroundColor: '#1890ff',
        pointBorderColor: '#1890ff',
        pointRadius: 4,
      }] : []),
      {
        type: 'line' as const,
        label: '불량률 (%)',
        data: data.map(item => item.defect_rate * 100),
        borderColor: '#faad14',
        backgroundColor: 'rgba(250, 173, 20, 0.1)',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        yAxisID: 'y1',
        pointBackgroundColor: '#faad14',
        pointBorderColor: '#faad14',
        pointRadius: 4,
      },
    ],
  };

  // 차트 옵션
  const options: ChartOptions<'bar'> = {
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
            if (context.dataset.label === '불량률 (%)') {
              return `${context.dataset.label}: ${context.parsed.y.toFixed(2)}%`;
            } else {
              return `${context.dataset.label}: ${context.parsed.y.toLocaleString()}개`;
            }
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
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: '수량 (개)',
        },
        beginAtZero: true,
        grid: {
          display: true,
          color: 'rgba(0, 0, 0, 0.1)',
        },
        ticks: {
          callback: function(value) {
            return value.toLocaleString();
          },
        },
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: '불량률 (%)',
        },
        min: 0,
        grid: {
          drawOnChartArea: false,
        },
        ticks: {
          callback: function(value) {
            return value + '%';
          },
        },
      },
    },
  };

  // 통계 계산
  const totalOutput = data.reduce((sum, item) => sum + item.output_qty, 0);
  const totalDefects = data.reduce((sum, item) => sum + item.defect_qty, 0);
  const totalGood = data.reduce((sum, item) => sum + item.good_qty, 0);
  const avgDefectRate = data.length > 0 ? (totalDefects / totalOutput) * 100 : 0;
  const totalTarget = data.reduce((sum, item) => sum + (item.target_qty || 0), 0);
  const achievementRate = totalTarget > 0 ? (totalOutput / totalTarget) * 100 : 0;

  // 차트 타입 옵션
  const chartTypeOptions = [
    { label: '막대 차트', value: 'bar' },
    { label: '선 차트', value: 'line' },
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
              <Select
                value={chartType}
                options={chartTypeOptions}
                onChange={onChartTypeChange}
                style={{ width: 120 }}
              />
            </Col>
          )}
        </Row>
      </div>

      {/* 차트 */}
      <div style={{ height, marginBottom: 24 }}>
        {chartType === 'bar' ? (
          <Bar data={chartData} options={options} />
        ) : (
          <Line data={chartData} options={options} />
        )}
      </div>

      {/* 통계 요약 */}
      <Row gutter={[24, 16]}>
        <Col xs={12} sm={8} md={6}>
          <Statistic
            title="총 생산량"
            value={totalOutput}
            suffix="개"
            valueStyle={{ color: '#1890ff' }}
          />
        </Col>
        
        <Col xs={12} sm={8} md={6}>
          <Statistic
            title="양품 수량"
            value={totalGood}
            suffix="개"
            valueStyle={{ color: '#52c41a' }}
          />
        </Col>
        
        <Col xs={12} sm={8} md={6}>
          <Statistic
            title="불량 수량"
            value={totalDefects}
            suffix="개"
            valueStyle={{ color: '#ff4d4f' }}
          />
        </Col>
        
        <Col xs={12} sm={8} md={6}>
          <Statistic
            title="평균 불량률"
            value={avgDefectRate}
            precision={2}
            suffix="%"
            valueStyle={{ color: avgDefectRate > 5 ? '#ff4d4f' : '#faad14' }}
          />
        </Col>

        {totalTarget > 0 && (
          <>
            <Col xs={12} sm={8} md={6}>
              <Statistic
                title="목표 수량"
                value={totalTarget}
                suffix="개"
                valueStyle={{ color: '#722ed1' }}
              />
            </Col>
            
            <Col xs={12} sm={8} md={6}>
              <Statistic
                title="목표 달성률"
                value={achievementRate}
                precision={1}
                suffix="%"
                valueStyle={{ color: achievementRate >= 100 ? '#52c41a' : '#faad14' }}
              />
            </Col>
          </>
        )}
      </Row>

      {/* 일별 최고/최저 실적 */}
      {data.length > 0 && (
        <div style={{ marginTop: 24, padding: '16px 0', borderTop: '1px solid #f0f0f0' }}>
          <Row gutter={[32, 16]} justify="center">
            <Col>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#52c41a' }}>
                  {Math.max(...data.map(item => item.output_qty)).toLocaleString()}개
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>최고 생산량</div>
              </div>
            </Col>
            
            <Col>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#ff4d4f' }}>
                  {Math.min(...data.map(item => item.output_qty)).toLocaleString()}개
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>최저 생산량</div>
              </div>
            </Col>
            
            <Col>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#faad14' }}>
                  {(Math.max(...data.map(item => item.defect_rate)) * 100).toFixed(2)}%
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>최고 불량률</div>
              </div>
            </Col>
            
            <Col>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#1890ff' }}>
                  {data.length > 0 ? (totalOutput / data.length).toFixed(0) : 0}개
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>일평균 생산량</div>
              </div>
            </Col>
          </Row>
        </div>
      )}
    </Card>
  );
};