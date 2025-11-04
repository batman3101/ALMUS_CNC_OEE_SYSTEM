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
import { Card, Typography, Row, Col, Statistic } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons';

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend
);

const { Text } = Typography;

interface ProductionData {
  date: string;
  output_qty: number;
  defect_qty: number;
  good_qty?: number;
  quality?: number;
}

interface QualityPerformanceChartProps {
  data: ProductionData[];
  height?: number;
  period?: 'week' | 'month' | 'quarter';
}

export const QualityPerformanceChart: React.FC<QualityPerformanceChartProps> = ({
  data,
  height = 300,
  period = 'month'
}) => {
  // 데이터 가공
  const chartData = React.useMemo(() => {
    return data.map(item => {
      const goodQty = item.output_qty - item.defect_qty;
      const qualityRate = item.output_qty > 0 ? (goodQty / item.output_qty) * 100 : 0;

      return {
        date: item.date,
        goodQty,
        qualityRate,
        totalOutput: item.output_qty,
        defectQty: item.defect_qty
      };
    });
  }, [data]);

  // 통계 계산
  const stats = React.useMemo(() => {
    if (chartData.length === 0) {
      return {
        avgQualityRate: 0,
        totalGoodQty: 0,
        totalDefectQty: 0,
        qualityTrend: 0
      };
    }

    const avgQualityRate = chartData.reduce((sum, item) => sum + item.qualityRate, 0) / chartData.length;
    const totalGoodQty = chartData.reduce((sum, item) => sum + item.goodQty, 0);
    const totalDefectQty = chartData.reduce((sum, item) => sum + item.defectQty, 0);

    // 품질률 추세 계산 (최근 데이터와 초기 데이터 비교)
    const recentAvg = chartData.slice(-3).reduce((sum, item) => sum + item.qualityRate, 0) / Math.min(3, chartData.length);
    const initialAvg = chartData.slice(0, 3).reduce((sum, item) => sum + item.qualityRate, 0) / Math.min(3, chartData.length);
    const qualityTrend = recentAvg - initialAvg;

    return {
      avgQualityRate,
      totalGoodQty,
      totalDefectQty,
      qualityTrend
    };
  }, [chartData]);

  // 차트 데이터 구성
  const lineChartData = {
    labels: chartData.map(item => {
      const dateParts = item.date.split('-');
      return `${dateParts[1]}/${dateParts[2]}`;
    }),
    datasets: [
      {
        type: 'bar' as const,
        label: '양품 생산량',
        data: chartData.map(item => item.goodQty),
        backgroundColor: 'rgba(82, 196, 26, 0.6)',
        borderColor: 'rgba(82, 196, 26, 1)',
        borderWidth: 1,
        yAxisID: 'y',
      },
      {
        type: 'line' as const,
        label: '품질률 (%)',
        data: chartData.map(item => item.qualityRate),
        borderColor: '#1890ff',
        backgroundColor: 'rgba(24, 144, 255, 0.1)',
        borderWidth: 3,
        tension: 0.4,
        yAxisID: 'y1',
        pointBackgroundColor: '#1890ff',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
      },
    ],
  };

  // 차트 옵션
  const options: ChartOptions<'line'> = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: {
      mode: 'index' as const,
      intersect: false,
    },
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
            const label = context.dataset.label || '';
            const value = context.parsed.y;

            if (context.dataset.type === 'line') {
              return `${label}: ${value.toFixed(1)}%`;
            } else {
              return `${label}: ${value.toLocaleString()}개`;
            }
          },
        },
      },
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
          color: 'rgba(0, 0, 0, 0.05)',
        },
      },
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: '양품 생산량 (개)',
        },
        beginAtZero: true,
        grid: {
          color: 'rgba(0, 0, 0, 0.1)',
        },
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: '품질률 (%)',
        },
        min: 0,
        max: 100,
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

  return (
    <div>
      {/* 차트 */}
      <div style={{ height, marginBottom: 24 }}>
        <Line data={lineChartData} options={options} />
      </div>

      {/* 통계 요약 */}
      <Row gutter={[16, 16]}>
        <Col xs={12} sm={6}>
          <div style={{ textAlign: 'center' }}>
            <Statistic
              title="평균 품질률"
              value={stats.avgQualityRate.toFixed(1)}
              suffix="%"
              valueStyle={{
                color: stats.avgQualityRate >= 95 ? '#52c41a' :
                       stats.avgQualityRate >= 90 ? '#faad14' : '#ff4d4f',
                fontSize: 20
              }}
            />
          </div>
        </Col>

        <Col xs={12} sm={6}>
          <div style={{ textAlign: 'center' }}>
            <Statistic
              title="총 양품 생산"
              value={stats.totalGoodQty}
              suffix="개"
              valueStyle={{ color: '#52c41a', fontSize: 20 }}
            />
          </div>
        </Col>

        <Col xs={12} sm={6}>
          <div style={{ textAlign: 'center' }}>
            <Statistic
              title="총 불량 수량"
              value={stats.totalDefectQty}
              suffix="개"
              valueStyle={{ color: '#ff4d4f', fontSize: 20 }}
            />
          </div>
        </Col>

        <Col xs={12} sm={6}>
          <div style={{ textAlign: 'center' }}>
            <Statistic
              title="품질률 추세"
              value={Math.abs(stats.qualityTrend).toFixed(1)}
              suffix="%"
              prefix={stats.qualityTrend >= 0 ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
              valueStyle={{
                color: stats.qualityTrend >= 0 ? '#52c41a' : '#ff4d4f',
                fontSize: 20
              }}
            />
          </div>
        </Col>
      </Row>

      {/* 품질 목표 달성 상태 */}
      <div style={{
        marginTop: 24,
        padding: 16,
        background: stats.avgQualityRate >= 95 ? '#f6ffed' :
                    stats.avgQualityRate >= 90 ? '#fffbe6' : '#fff2f0',
        border: `1px solid ${stats.avgQualityRate >= 95 ? '#b7eb8f' :
                             stats.avgQualityRate >= 90 ? '#ffe58f' : '#ffccc7'}`,
        borderRadius: 4
      }}>
        <Text strong>
          {stats.avgQualityRate >= 95
            ? '✅ 우수: 품질 목표(95%) 달성'
            : stats.avgQualityRate >= 90
            ? '⚠️ 주의: 품질률 90% 이상 유지 필요'
            : '🔴 개선 필요: 품질률 향상이 시급합니다'}
        </Text>
        <div style={{ marginTop: 8, fontSize: 12, color: '#666' }}>
          현재 기간 평균 품질률: {stats.avgQualityRate.toFixed(1)}%
          {stats.avgQualityRate < 95 && ` (목표 95%까지 ${(95 - stats.avgQualityRate).toFixed(1)}% 부족)`}
        </div>
      </div>
    </div>
  );
};
