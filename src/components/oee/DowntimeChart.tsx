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
  ChartData,
} from 'chart.js';
import { Card, Typography, Table, Row, Col } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { MachineState, DowntimeData } from '@/types';
import { useTranslation } from '@/hooks/useTranslation';
import { useChartAnimation } from '@/hooks/useChartAnimation';
import { compareNullableNumber, compareText, type SortOrder } from '@/utils/tableSorters';

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

interface DowntimeChartProps {
  data: DowntimeData[];
  title?: string;
  height?: number;
  showTable?: boolean;
}

// 설비 상태별 색상 매핑
const stateColors: Record<MachineState, string> = {
  NORMAL_OPERATION: '#13c2c2',
  PM_MAINTENANCE: '#fa8c16',
  INSPECTION: '#1890ff',
  BREAKDOWN_REPAIR: '#ff4d4f',
  MODEL_CHANGE: '#722ed1',
  PLANNED_STOP: '#8c8c8c',
  PROGRAM_CHANGE: '#13c2c2',
  TOOL_CHANGE: '#52c41a',
  TEMPORARY_STOP: '#faad14',
};

export const DowntimeChart: React.FC<DowntimeChartProps> = ({
  data,
  title,
  height = 400,
  showTable = true
}) => {
  const { t } = useTranslation();
  const chartAnimation = useChartAnimation();

  // 상태 레이블 번역 함수
  const getStateLabel = (state: MachineState): string => {
    return t(`dashboard:downtimeReasons.${state}`) || state;
  };
  
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
  const totalCount = downtimeData.reduce((sum, item) => sum + item.count, 0);
  let cumulativePercentage = 0;
  /**
   * 파레토 순위와 누적비율을 **행 데이터에 실어 둔다.**
   *
   * 예전에는 표에서 `index + 1`(순위)과 `chartData[index]`(누적비율)로 화면 행 번호를 써서
   * 값을 찾았다. 두 배열의 순서가 같아 우연히 맞았을 뿐이고, 표에 정렬을 붙이면 **A 행의
   * 원인 이름에 B 행의 누적비율이 붙는다** — 순서가 아니라 숫자가 틀리는 종류의 오류다.
   *
   * 순위와 누적비율은 "지속시간 내림차순" 이라는 파레토 순서에서만 의미가 있으므로,
   * 사용자가 다른 컬럼으로 정렬해도 각 행의 값은 그대로 따라다녀야 한다.
   */
  const chartData = sortedData.map((item, index) => {
    cumulativePercentage += totalDowntime > 0 ? (item.duration / totalDowntime) * 100 : 0;
    return {
      ...item,
      rank: index + 1,
      cumulativePercentage
    };
  });

  // 차트 데이터 구성
  const barChartData = {
    labels: chartData.map(item => getStateLabel(item.state)),
    datasets: [
      {
        type: 'bar' as const,
        label: t('dashboard:chart.downtimeByMinutes'),
        data: chartData.map(item => item.duration),
        backgroundColor: chartData.map(item => stateColors[item.state] || '#8c8c8c'),
        borderColor: chartData.map(item => stateColors[item.state] || '#8c8c8c'),
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
    // display.chart_animation_enabled — 켜짐은 undefined(라이브러리 기본값)로 표현한다.
    animation: chartAnimation.chartJs,
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
              return `${context.dataset.label}: ${context.parsed.y}${t('dashboard:chart.minutes')}`;
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
  type DowntimeRow = (typeof chartData)[number] & { key: number };

  const tableColumns: ColumnsType<DowntimeRow> = [
    {
      title: t('dashboard:chart.rank'),
      dataIndex: 'rank',
      key: 'rank',
      width: 60,
      // 화면 행 번호가 아니라 파레토 순위다. 다른 컬럼으로 정렬해도 순위는 따라다닌다.
      sorter: (a: DowntimeRow, b: DowntimeRow, order?: SortOrder) =>
        compareNullableNumber(a.rank, b.rank, order),
      defaultSortOrder: 'ascend' as const,
    },
    {
      title: t('dashboard:chart.downtimeCause'),
      dataIndex: 'state',
      key: 'state',
      // 화면에 보이는 번역 라벨로 정렬한다 — 사용자가 읽는 글자와 정렬 순서가 같아야 한다.
      sorter: (a: DowntimeRow, b: DowntimeRow, order?: SortOrder) =>
        compareText(getStateLabel(a.state), getStateLabel(b.state), order),
      render: (state: MachineState) => (
        <span style={{ color: stateColors[state] || '#8c8c8c', fontWeight: 'bold' }}>
          {getStateLabel(state)}
        </span>
      ),
    },
    {
      title: t('dashboard:chart.durationMinutes'),
      dataIndex: 'duration',
      key: 'duration',
      align: 'right' as const,
      sorter: (a: DowntimeRow, b: DowntimeRow, order?: SortOrder) =>
        compareNullableNumber(a.duration, b.duration, order),
      render: (duration: number) => duration.toLocaleString(),
    },
    {
      title: t('dashboard:chart.occurrenceCount'),
      dataIndex: 'count',
      key: 'count',
      align: 'right' as const,
      sorter: (a: DowntimeRow, b: DowntimeRow, order?: SortOrder) =>
        compareNullableNumber(a.count, b.count, order),
      render: (count: number) => count.toLocaleString(),
    },
    {
      title: t('dashboard:chart.ratio'),
      dataIndex: 'percentage',
      key: 'percentage',
      align: 'right' as const,
      sorter: (a: DowntimeRow, b: DowntimeRow, order?: SortOrder) =>
        compareNullableNumber(a.percentage, b.percentage, order),
      render: (percentage: number) => `${percentage.toFixed(1)}%`,
    },
    {
      title: t('dashboard:chart.cumulativeRatio'),
      dataIndex: 'cumulativePercentage',
      key: 'cumulative',
      align: 'right' as const,
      sorter: (a: DowntimeRow, b: DowntimeRow, order?: SortOrder) =>
        compareNullableNumber(a.cumulativePercentage, b.cumulativePercentage, order),
      render: (cumulative: number) => `${(cumulative ?? 0).toFixed(1)}%`,
    },
  ];

  return (
    <Card>
      <AntTitle level={4} style={{ marginBottom: 16 }}>
        {title}
      </AntTitle>

      {/* 파레토 차트 */}
      <div style={{ height, marginBottom: showTable ? 24 : 0 }}>
        <Bar data={barChartData as ChartData<'bar', number[], string>} options={options} />
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
              {totalCount}
            </div>
            <div style={{ fontSize: 12, color: '#666' }}>{t('dashboard:chart.totalOccurrences')}</div>
          </div>
        </Col>

        <Col>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1890ff' }}>
              {totalCount > 0 ? (totalDowntime / totalCount).toFixed(1) : 0}
            </div>
            <div style={{ fontSize: 12, color: '#666' }}>{t('dashboard:chart.averageDuration')}</div>
          </div>
        </Col>
        
        <Col>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 'bold', color: '#52c41a' }}>
              {sortedData.length > 0 ? getStateLabel(sortedData[0].state) : '-'}
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
            dataSource={chartData.map((item, index) => ({ ...item, key: index }))}
            pagination={false}
            size="small"
          />
        </div>
      )}
    </Card>
  );
};