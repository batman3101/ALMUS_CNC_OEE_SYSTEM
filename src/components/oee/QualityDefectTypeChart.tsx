'use client';

import React from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  ResponsiveContainer,
  TooltipProps,
} from 'recharts';
import { Card, Typography, Row, Col, Empty, Spin, Table } from 'antd';
import { useDashboardTranslation } from '@/hooks/useTranslation';

const { Title: AntTitle } = Typography;

interface QualityDefectTypeData {
  type: string;
  count: number;
  percentage: number;
}

interface QualityDefectTypeChartProps {
  data: QualityDefectTypeData[];
  title?: string;
  height?: number;
  loading?: boolean;
  error?: string;
  showTable?: boolean;
}

// 파이 차트 색상 팔레트 (Ant Design 색상 사용)
const COLORS = [
  '#ff4d4f', // Red
  '#faad14', // Orange
  '#1890ff', // Blue
  '#52c41a', // Green
  '#722ed1', // Purple
  '#eb2f96', // Pink
  '#13c2c2', // Cyan
  '#fa8c16', // Volcano
  '#a0d911', // Lime
  '#f759ab', // Magenta
];

// 커스텀 툴팁 컴포넌트
const CustomTooltip: React.FC<TooltipProps<number, string>> = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload as QualityDefectTypeData;
    return (
      <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
        <p className="font-medium text-gray-800 mb-2">{data.type}</p>
        <div className="space-y-1">
          <p className="text-sm">
            불량 수량: <span className="font-medium">{data.count.toLocaleString()}개</span>
          </p>
          <p className="text-sm">
            비율: <span className="font-medium">{data.percentage.toFixed(1)}%</span>
          </p>
        </div>
      </div>
    );
  }
  return null;
};

// 파이 차트 레이블 렌더링 함수
const renderLabel = (entry: QualityDefectTypeData) => {
  return `${entry.percentage.toFixed(1)}%`;
};

// 커스텀 범례 컴포넌트
const CustomLegend: React.FC<{ payload?: any[] }> = ({ payload }) => {
  if (!payload) return null;

  return (
    <div className="flex flex-wrap justify-center gap-4 mt-4">
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center">
          <div
            className="w-3 h-3 rounded-full mr-2"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-sm text-gray-700">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

export const QualityDefectTypeChart: React.FC<QualityDefectTypeChartProps> = ({
  data,
  title = '불량 유형별 분석',
  height = 400,
  loading = false,
  error,
  showTable = true
}) => {
  const { t } = useDashboardTranslation();
  
  // 데이터 로깅 (디버깅용)
  React.useEffect(() => {
    console.log('QualityDefectTypeChart 받은 데이터:', { 
      dataLength: data.length, 
      sampleData: data.slice(0, 3),
      title 
    });
  }, [data, title]);

  // 통계 계산
  const statistics = React.useMemo(() => {
    if (data.length === 0) {
      return {
        totalCount: 0,
        typeCount: 0,
        topDefectType: null,
      };
    }

    const totalCount = data.reduce((sum, item) => sum + item.count, 0);
    const topDefectType = data.reduce((max, current) => 
      current.count > max.count ? current : max
    );
    
    return {
      totalCount,
      typeCount: data.length,
      topDefectType,
    };
  }, [data]);

  // 테이블 컬럼 정의
  const tableColumns = [
    {
      title: '불량 유형',
      dataIndex: 'type',
      key: 'type',
      render: (text: string, record: QualityDefectTypeData, index: number) => (
        <div className="flex items-center">
          <div
            className="w-3 h-3 rounded-full mr-2"
            style={{ backgroundColor: COLORS[index % COLORS.length] }}
          />
          <span className="font-medium">{text}</span>
        </div>
      ),
    },
    {
      title: '수량',
      dataIndex: 'count',
      key: 'count',
      render: (value: number) => (
        <span className="font-medium">{value.toLocaleString()}개</span>
      ),
      sorter: (a: QualityDefectTypeData, b: QualityDefectTypeData) => a.count - b.count,
    },
    {
      title: '비율',
      dataIndex: 'percentage',
      key: 'percentage',
      render: (value: number) => (
        <span className="font-medium text-blue-600">{value.toFixed(1)}%</span>
      ),
      sorter: (a: QualityDefectTypeData, b: QualityDefectTypeData) => a.percentage - b.percentage,
    },
  ];

  // 로딩 상태
  if (loading) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <Spin size="large" />
          <p style={{ marginTop: 16, color: '#666' }}>데이터를 불러오는 중...</p>
        </div>
      </Card>
    );
  }

  // 에러 상태
  if (error) {
    return (
      <Card>
        <div style={{ textAlign: 'center', padding: '40px' }}>
          <p style={{ color: '#ff4d4f', marginBottom: 16 }}>데이터 로드 중 오류가 발생했습니다</p>
          <p style={{ color: '#666', fontSize: '14px' }}>{error}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      {/* 제목 */}
      <div style={{ marginBottom: 16 }}>
        <AntTitle level={4} style={{ margin: 0 }}>
          {title}
        </AntTitle>
      </div>

      {/* 차트와 테이블을 좌우로 배치 (데이터가 있는 경우) */}
      {data.length === 0 ? (
        <div style={{ height }}>
          <Empty
            description="표시할 데이터가 없습니다"
            style={{ 
              display: 'flex', 
              flexDirection: 'column', 
              justifyContent: 'center', 
              alignItems: 'center',
              height: '100%'
            }}
          />
        </div>
      ) : (
        <Row gutter={[24, 24]}>
          {/* 파이 차트 */}
          <Col xs={24} lg={showTable ? 14 : 24}>
            <div style={{ height }}>
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={data}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={renderLabel}
                    outerRadius={Math.min(height * 0.3, 120)}
                    innerRadius={Math.min(height * 0.15, 60)}
                    paddingAngle={2}
                    dataKey="count"
                  >
                    {data.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={COLORS[index % COLORS.length]}
                        stroke="#fff"
                        strokeWidth={2}
                      />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                  <Legend content={<CustomLegend />} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </Col>

          {/* 데이터 테이블 */}
          {showTable && (
            <Col xs={24} lg={10}>
              <div style={{ height }}>
                <Table
                  dataSource={data.map((item, index) => ({ ...item, key: index }))}
                  columns={tableColumns}
                  pagination={false}
                  size="small"
                  scroll={{ y: height - 100 }}
                  className="overflow-hidden"
                />
              </div>
            </Col>
          )}
        </Row>
      )}

      {/* 통계 요약 */}
      {data.length > 0 && (
        <div style={{ marginTop: 24, padding: '16px 0', borderTop: '1px solid #f0f0f0' }}>
          <Row gutter={[32, 16]} justify="center">
            <Col>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#1890ff' }}>
                  {statistics.totalCount.toLocaleString()}
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>총 불량 수량</div>
              </div>
            </Col>
            
            <Col>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#52c41a' }}>
                  {statistics.typeCount}
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>불량 유형 수</div>
              </div>
            </Col>
            
            <Col>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 16, fontWeight: 'bold', color: '#ff4d4f' }}>
                  {statistics.topDefectType?.type || 'N/A'}
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>최다 불량 유형</div>
              </div>
            </Col>
            
            <Col>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 'bold', color: '#faad14' }}>
                  {statistics.topDefectType?.percentage.toFixed(1) || 0}%
                </div>
                <div style={{ fontSize: 12, color: '#666' }}>최대 비율</div>
              </div>
            </Col>
          </Row>
        </div>
      )}
    </Card>
  );
};