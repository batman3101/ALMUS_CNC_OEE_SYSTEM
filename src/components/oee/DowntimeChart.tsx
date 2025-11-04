'use client';

import React from 'react';
import { Bar } from 'react-chartjs-2';
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
import { Card, Typography, Table, Row, Col } from 'antd';
import { MachineState } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';

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

interface DowntimeData {
  state: MachineState;
  duration: number; // 분 단위
  count: number; // 발생 횟수
  percentage: number; // 전체 다운타임 대비 비율
}

interface DowntimeChartProps {
  data: DowntimeData[];
  title?: string;
  height?: number;
  showTable?: boolean;
}

// 설비 상태별 한글 이름 및 색상 매핑
const stateConfig: Record<MachineState, { label: string; color: string }> = {
  NORMAL_OPERATION: { label: '정상가동', color: '#13c2c2' },
  MAINTENANCE: { label: '점검중', color: '#1890ff' },
  PM_MAINTENANCE: { label: 'PM 점검', color: '#fa8c16' },
  INSPECTION: { label: '검사', color: '#1890ff' },
  BREAKDOWN_REPAIR: { label: '고장수리', color: '#ff4d4f' },
  MODEL_CHANGE: { label: '모델교체', color: '#722ed1' },
  PLANNED_STOP: { label: '계획정지', color: '#8c8c8c' },
  PROGRAM_CHANGE: { label: '프로그램교체', color: '#13c2c2' },
  TOOL_CHANGE: { label: '공구교환', color: '#52c41a' },
  TEMPORARY_STOP: { label: '일시정지', color: '#faad14' },
};

export const DowntimeChart: React.FC<DowntimeChartProps> = ({
  data,
  title,
  height = 400,
  showTable = true
}) => {
  const { t } = useTranslation();
  
  // 데이터 로깅 (디버깅용)
  React.useEffect(() => {
    console.log('DowntimeChart 받은 데이터:', { 
      dataLength: data.length, 
      sampleData: data.slice(0, 3),
      title 
    });
  }, [data, title]);
  // 다운타임 데이터만 필터링 (정상가동 제외)
  const downtimeData = data.filter(item => item.state !== 'NORMAL_OPERATION');
  
  // 지속시간 기준으로 내림차순 정렬
  const sortedData = [...downtimeData].sort((a, b) => b.duration - a.duration);
  
  // 누적 비율 계산
  const totalDowntime = sortedData.reduce((sum, item) => sum + item.duration, 0);
  let cumulativePercentage = 0;
  const chartData = sortedData.map(item => {
    cumulativePercentage += (item.duration / totalDowntime) * 100;
    return {
      ...item,
      cumulativePercentage
    };
  });

  // 차트 데이터 구성
  const barChartData = {
    labels: chartData.map(item => stateConfig[item.state]?.label || item.state),
    datasets: [
      {
        type: 'bar' as const,
        label: t('dashboard:chart.downtimeByMinutes'),
        data: chartData.map(item => item.duration),
        backgroundColor: chartData.map(item => stateConfig[item.state]?.color || '#8c8c8c'),
        borderColor: chartData.map(item => stateConfig[item.state]?.color || '#8c8c8c'),
        borderWidth: 1,
        yAxisID: 'y',
      },
      {
        type: 'line' as const,
        label: t('dashboard:chart.cumulativeOccurrence'),
        data: chartData.map(item => item.cumulativePercentage),
        borderColor: '#ff7875',
        backgroundColor: 'rgba(255, 120, 117, 0.1)',
        borderWidth: 2,
        fill: false,
        tension: 0.4,
        yAxisID: 'y1',
        pointBackgroundColor: '#ff7875',
        pointBorderColor: '#ff7875',
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
            if (context.dataset.type === 'bar') {
              return `${context.dataset.label}: ${context.parsed.y}분`;
            } else {
              return `${context.dataset.label}: ${context.parsed.y.toFixed(1)}%`;
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
          text: t('dashboard:chart.downtimeCause'),
        },
      },
      y: {
        type: 'linear',
        display: true,
        position: 'left',
        title: {
          display: true,
          text: t('dashboard:chart.downtimeByMinutes'),
        },
        beginAtZero: true,
      },
      y1: {
        type: 'linear',
        display: true,
        position: 'right',
        title: {
          display: true,
          text: t('dashboard:chart.cumulativeOccurrence'),
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

  // 테이블 컬럼 정의
  const tableColumns = [
    {
      title: t('dashboard:chart.rank'),
      dataIndex: 'rank',
      key: 'rank',
      width: 60,
      render: (_: any, __: any, index: number) => index + 1,
    },
    {
      title: t('dashboard:chart.downtimeCause'),
      dataIndex: 'state',
      key: 'state',
      render: (state: MachineState) => (
        <span style={{ color: stateConfig[state]?.color || '#8c8c8c', fontWeight: 'bold' }}>
          {stateConfig[state]?.label || state}
        </span>
      ),
    },
    {
      title: t('dashboard:chart.durationMinutes'),
      dataIndex: 'duration',
      key: 'duration',
      align: 'right' as const,
      render: (duration: number) => duration.toLocaleString(),
    },
    {
      title: t('dashboard:chart.occurrenceCount'),
      dataIndex: 'count',
      key: 'count',
      align: 'right' as const,
      render: (count: number) => count.toLocaleString(),
    },
    {
      title: t('dashboard:chart.ratio'),
      dataIndex: 'percentage',
      key: 'percentage',
      align: 'right' as const,
      render: (percentage: number) => `${percentage.toFixed(1)}%`,
    },
    {
      title: t('dashboard:chart.cumulativeRatio'),
      key: 'cumulative',
      align: 'right' as const,
      render: (_: any, __: any, index: number) => {
        const cumulative = chartData[index]?.cumulativePercentage || 0;
        return `${cumulative.toFixed(1)}%`;
      },
    },
  ];

  return (
    <Card>
      <AntTitle level={4} style={{ marginBottom: 16 }}>
        {title}
      </AntTitle>

      {/* 파레토 차트 */}
      <div style={{ height, marginBottom: showTable ? 24 : 0 }}>
        <Bar data={barChartData} options={options} />
      </div>

      {/* 요약 통계 */}
      <Row gutter={[32, 16]} justify="center" style={{ marginBottom: showTable ? 24 : 0 }}>
        <Col>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: '#ff4d4f' }}>
              {totalDowntime.toLocaleString()}
            </div>
            <div style={{ fontSize: 12, color: '#666' }}>{t('dashboard:chart.totalDowntime')}</div>
          </div>
        </Col>
        
        <Col>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: '#faad14' }}>
              {downtimeData.reduce((sum, item) => sum + item.count, 0)}
            </div>
            <div style={{ fontSize: 12, color: '#666' }}>{t('dashboard:chart.totalOccurrences')}</div>
          </div>
        </Col>
        
        <Col>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1890ff' }}>
              {downtimeData.length > 0 ? (totalDowntime / downtimeData.reduce((sum, item) => sum + item.count, 0)).toFixed(1) : 0}
            </div>
            <div style={{ fontSize: 12, color: '#666' }}>{t('dashboard:chart.averageDuration')}</div>
          </div>
        </Col>
        
        <Col>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: '#52c41a' }}>
              {sortedData.length > 0 ? (stateConfig[sortedData[0].state]?.label || sortedData[0].state) : '-'}
            </div>
            <div style={{ fontSize: 12, color: '#666' }}>{t('dashboard:chart.mainCause')}</div>
          </div>
        </Col>
      </Row>

      {/* 상세 테이블 */}
      {showTable && (
        <div>
          <AntTitle level={5} style={{ marginBottom: 16 }}>
            {t('dashboard:chart.detailedAnalysis')}
          </AntTitle>
          <Table
            columns={tableColumns}
            dataSource={sortedData.map((item, index) => ({ ...item, key: index }))}
            pagination={false}
            size="small"
            variant="outlined"
          />
        </div>
      )}
    </Card>
  );
};