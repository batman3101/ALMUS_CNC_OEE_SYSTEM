'use client';

import React, { useState, useMemo } from 'react';
import { Card, Button, Space, Table, Empty, Spin, Checkbox, Tag, Pagination } from 'antd';
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';
import { BarChartOutlined, LineChartOutlined } from '@ant-design/icons';

interface MachineComparisonData {
  machine_name: string;
  location: string;
  oee: number;
  availability: number;
  performance: number;
  quality: number;
  output_qty: number;
  defect_qty: number;
  ranking?: number;
}

interface MachineComparisonChartProps {
  data: MachineComparisonData[];
  title?: string;
  height?: number;
  chartType?: 'bar' | 'line' | 'mixed';
  selectedMetrics?: ('oee' | 'availability' | 'performance' | 'quality')[];
  period?: 'day' | 'week' | 'month';
  showTable?: boolean;
  loading?: boolean;
  onChartTypeChange?: (type: 'bar' | 'line' | 'mixed') => void;
  onMetricsChange?: (metrics: ('oee' | 'availability' | 'performance' | 'quality')[]) => void;
}

// 색상 매핑
const METRIC_COLORS = {
  oee: '#1890ff',
  availability: '#52c41a',
  performance: '#faad14',
  quality: '#f5222d'
};

// 지표 라벨
const METRIC_LABELS = {
  oee: 'OEE',
  availability: '가용성',
  performance: '성능',
  quality: '품질'
};

export const MachineComparisonChart: React.FC<MachineComparisonChartProps> = ({
  data = [],
  title = '설비간 성능 비교',
  height = 400,
  chartType = 'bar',
  selectedMetrics = ['oee', 'availability', 'performance', 'quality'],
  showTable = false,
  loading = false,
  onChartTypeChange,
  onMetricsChange
}) => {
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [localSelectedMetrics, setLocalSelectedMetrics] = useState<('oee' | 'availability' | 'performance' | 'quality')[]>(selectedMetrics);

  // 데이터 페이지네이션 처리
  const processedData = useMemo(() => {
    if (data.length === 0) return [];

    const sortedData = [...data];
    
    // OEE 기준 내림차순 정렬
    sortedData.sort((a, b) => b.oee - a.oee);

    // 페이지네이션 적용
    const startIndex = (currentPage - 1) * pageSize;
    const endIndex = startIndex + pageSize;
    
    return sortedData.slice(startIndex, endIndex);
  }, [data, currentPage, pageSize]);

  // 통계 계산
  const stats = useMemo(() => {
    if (data.length === 0) return null;

    const metrics = localSelectedMetrics.reduce((acc, metric) => {
      const values = data.map(d => d[metric]);
      acc[metric] = {
        avg: values.reduce((sum, val) => sum + val, 0) / values.length,
        max: Math.max(...values),
        min: Math.min(...values)
      };
      return acc;
    }, {} as Record<string, { avg: number; max: number; min: number }>);

    return metrics;
  }, [data, localSelectedMetrics]);

  // 지표 변경 핸들러
  const handleMetricsChange = (values: string[]) => {
    const typedValues = values as ('oee' | 'availability' | 'performance' | 'quality')[];
    setLocalSelectedMetrics(typedValues);
    onMetricsChange?.(typedValues);
  };

  // 커스텀 툴팁
  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ color: string; dataKey: string; value: number }>; label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white p-3 border border-gray-200 shadow-lg rounded">
          <p className="font-semibold">{label}</p>
          {payload.map((entry, index: number) => (
            <p key={index} style={{ color: entry.color }}>
              {METRIC_LABELS[entry.dataKey as keyof typeof METRIC_LABELS]}: {entry.value.toFixed(1)}%
            </p>
          ))}
        </div>
      );
    }
    return null;
  };

  // 차트 렌더링
  const renderChart = () => {
    if (chartType === 'bar') {
      return (
        <BarChart data={processedData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="machine_name" angle={-45} textAnchor="end" height={80} />
          <YAxis domain={[0, 100]} />
          <RechartsTooltip content={<CustomTooltip />} />
          <Legend />
          {localSelectedMetrics.map(metric => (
            <Bar
              key={metric}
              dataKey={metric}
              fill={METRIC_COLORS[metric]}
              name={METRIC_LABELS[metric]}
              radius={[2, 2, 0, 0]}
            />
          ))}
        </BarChart>
      );
    } else {
      return (
        <LineChart data={processedData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="machine_name" angle={-45} textAnchor="end" height={80} />
          <YAxis domain={[0, 100]} />
          <RechartsTooltip content={<CustomTooltip />} />
          <Legend />
          {localSelectedMetrics.map(metric => (
            <Line
              key={metric}
              type="monotone"
              dataKey={metric}
              stroke={METRIC_COLORS[metric]}
              strokeWidth={2}
              dot={{ r: 4 }}
              name={METRIC_LABELS[metric]}
            />
          ))}
        </LineChart>
      );
    }
  };

  // 테이블 컬럼
  const tableColumns = [
    {
      title: '순위',
      dataIndex: 'ranking',
      key: 'ranking',
      width: 60,
      render: (_: unknown, __: unknown, index: number) => (
        <Tag color={index < 3 ? 'gold' : 'default'}>{index + 1}</Tag>
      )
    },
    {
      title: '설비명',
      dataIndex: 'machine_name',
      key: 'machine_name',
      width: 100
    },
    {
      title: '위치',
      dataIndex: 'location',
      key: 'location',
      width: 80
    },
    {
      title: 'OEE (%)',
      dataIndex: 'oee',
      key: 'oee',
      width: 80,
      render: (value: number) => (
        <span style={{ color: value >= 85 ? '#52c41a' : value >= 65 ? '#faad14' : '#ff4d4f' }}>
          {value.toFixed(1)}
        </span>
      ),
      sorter: (a: MachineComparisonData, b: MachineComparisonData) => a.oee - b.oee
    },
    {
      title: '가용성 (%)',
      dataIndex: 'availability',
      key: 'availability',
      width: 90,
      render: (value: number) => `${value.toFixed(1)}`,
      sorter: (a: MachineComparisonData, b: MachineComparisonData) => a.availability - b.availability
    },
    {
      title: '성능 (%)',
      dataIndex: 'performance',
      key: 'performance',
      width: 80,
      render: (value: number) => `${value.toFixed(1)}`,
      sorter: (a: MachineComparisonData, b: MachineComparisonData) => a.performance - b.performance
    },
    {
      title: '품질 (%)',
      dataIndex: 'quality',
      key: 'quality',
      width: 80,
      render: (value: number) => `${value.toFixed(1)}`,
      sorter: (a: MachineComparisonData, b: MachineComparisonData) => a.quality - b.quality
    },
    {
      title: '생산량',
      dataIndex: 'output_qty',
      key: 'output_qty',
      width: 80,
      render: (value: number) => value.toLocaleString()
    }
  ];

  if (loading) {
    return (
      <Card title={title}>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: height }}>
          <Spin size="large" tip="데이터 로딩 중..." />
        </div>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card title={title}>
        <Empty 
          description="비교할 설비 데이터가 없습니다"
          style={{ height: height, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
        />
      </Card>
    );
  }

  return (
    <Card 
      title={title}
      extra={
        <Space>
          <Button
            icon={chartType === 'bar' ? <BarChartOutlined /> : <LineChartOutlined />}
            onClick={() => onChartTypeChange?.(chartType === 'bar' ? 'line' : 'bar')}
          >
            {chartType === 'bar' ? '막대' : '선'}
          </Button>
        </Space>
      }
    >
      {/* 지표 선택 */}
      <div style={{ marginBottom: 16, padding: '12px', backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: '6px' }}>
        <span style={{ marginRight: 8, fontWeight: 500, color: '#ffffff' }}>표시 지표:</span>
        <Checkbox.Group
          value={localSelectedMetrics}
          onChange={handleMetricsChange}
        >
          <Space>
            {Object.entries(METRIC_LABELS).map(([key, label]) => (
              <Checkbox 
                key={key} 
                value={key} 
                style={{ 
                  color: '#ffffff'
                }}
              >
                <span style={{ color: METRIC_COLORS[key as keyof typeof METRIC_COLORS] }}>
                  {label}
                </span>
              </Checkbox>
            ))}
          </Space>
        </Checkbox.Group>
      </div>

      {/* 통계 요약 */}
      {stats && (
        <div style={{ marginBottom: 16, padding: 12, backgroundColor: 'rgba(255, 255, 255, 0.05)', borderRadius: 6 }}>
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            {localSelectedMetrics.map(metric => (
              <div key={metric}>
                <span style={{ fontSize: 12, color: '#999' }}>{METRIC_LABELS[metric]}</span>
                <div style={{ fontSize: 14, color: '#ffffff' }}>
                  평균: <span style={{ color: METRIC_COLORS[metric] }}>{stats[metric].avg.toFixed(1)}%</span>
                  {' | '}
                  최고: <span style={{ color: '#52c41a' }}>{stats[metric].max.toFixed(1)}%</span>
                  {' | '}
                  최저: <span style={{ color: '#ff4d4f' }}>{stats[metric].min.toFixed(1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 차트 */}
      <div style={{ height: height, marginBottom: showTable ? 16 : 0 }}>
        <ResponsiveContainer width="100%" height="100%">
          {renderChart()}
        </ResponsiveContainer>
      </div>

      {/* 페이지네이션 */}
      {data.length > 0 && (
        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
          <Pagination
            current={currentPage}
            total={data.length}
            pageSize={pageSize}
            showSizeChanger
            showQuickJumper
            showTotal={(total, range) => `${range[0]}-${range[1]} / 총 ${total}개 설비`}
            pageSizeOptions={['5', '10', '20', '50']}
            onChange={(page, size) => {
              setCurrentPage(page);
              if (size !== pageSize) {
                setPageSize(size);
                setCurrentPage(1);
              }
            }}
            style={{ color: '#ffffff' }}
          />
        </div>
      )}

      {/* 데이터 테이블 */}
      {showTable && (
        <Table
          columns={tableColumns}
          dataSource={processedData}
          rowKey="machine_name"
          pagination={false}
          size="small"
          scroll={{ x: 700 }}
          style={{ marginTop: 16 }}
        />
      )}
    </Card>
  );
};