'use client';

import React, { useState } from 'react';
import { Row, Col, Card, Tabs, Select, DatePicker, Button, Space, Table, Statistic } from 'antd';
import { 
  BarChartOutlined, 
  DownloadOutlined,
  FilterOutlined,
  ReloadOutlined,
  RiseOutlined,
  FallOutlined
} from '@ant-design/icons';
import { OEEGauge, OEETrendChart, DowntimeChart, ProductionChart } from '@/components/oee';
import { OEEMetrics } from '@/types';
import { useClientOnly } from '@/hooks/useClientOnly';

// Removed deprecated TabPane import
const { RangePicker } = DatePicker;

// 모의 데이터 생성 함수들 (고정값 사용으로 하이드레이션 오류 방지)
const generateMockAnalysisData = () => {
  const machines = ['CNC-001', 'CNC-002', 'CNC-003', 'CNC-004', 'CNC-005'];
  const fixedData = [
    { location: 'A동 1층', avgOEE: 0.85, availability: 0.89, performance: 0.92, quality: 0.96, downtimeHours: 15, defectRate: 0.02, trend: 'up', trendValue: 5.2 },
    { location: 'A동 1층', avgOEE: 0.72, availability: 0.78, performance: 0.88, quality: 0.94, downtimeHours: 28, defectRate: 0.04, trend: 'down', trendValue: 2.1 },
    { location: 'A동 2층', avgOEE: 0.91, availability: 0.94, performance: 0.95, quality: 0.98, downtimeHours: 12, defectRate: 0.01, trend: 'up', trendValue: 7.8 },
    { location: 'B동 1층', avgOEE: 0.58, availability: 0.65, performance: 0.82, quality: 0.91, downtimeHours: 45, defectRate: 0.06, trend: 'down', trendValue: 3.5 },
    { location: 'B동 2층', avgOEE: 0.78, availability: 0.83, performance: 0.90, quality: 0.95, downtimeHours: 22, defectRate: 0.03, trend: 'up', trendValue: 4.1 }
  ];
  
  return machines.map((name, index) => ({
    key: name,
    machine: name,
    ...fixedData[index]
  }));
};

const generateMockTrendData = () => {
  // 30일간의 고정된 패턴 데이터
  const basePattern = [
    0.82, 0.78, 0.85, 0.79, 0.83, 0.81, 0.84, 0.77, 0.86, 0.80,
    0.75, 0.88, 0.82, 0.79, 0.87, 0.74, 0.89, 0.83, 0.76, 0.85,
    0.81, 0.78, 0.84, 0.80, 0.86, 0.82, 0.77, 0.88, 0.79, 0.85
  ];
  
  const data = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayIndex = 29 - i;
    const baseOEE = basePattern[dayIndex];
    
    data.push({
      date: date.toISOString().split('T')[0],
      availability: baseOEE + 0.05,
      performance: baseOEE + 0.08,
      quality: baseOEE + 0.12,
      oee: baseOEE,
      shift: dayIndex % 2 === 0 ? 'A' as const : 'B' as const
    });
  }
  return data;
};

const generateMockDowntimeData = () => [
  { state: 'MAINTENANCE' as const, duration: 1200, count: 15, percentage: 42.3 },
  { state: 'MODEL_CHANGE' as const, duration: 800, count: 8, percentage: 28.2 },
  { state: 'TOOL_CHANGE' as const, duration: 450, count: 32, percentage: 15.9 },
  { state: 'PROGRAM_CHANGE' as const, duration: 280, count: 12, percentage: 9.9 },
  { state: 'TEMPORARY_STOP' as const, duration: 110, count: 18, percentage: 3.7 }
];

const generateMockProductionData = () => {
  // 30일간의 고정된 생산 데이터 패턴
  const baseOutputs = [
    9200, 8800, 9500, 8600, 9100, 8900, 9300, 8500, 9400, 8700,
    8300, 9600, 9000, 8400, 9700, 8200, 9800, 9100, 8100, 9500,
    8900, 8600, 9200, 8800, 9400, 9000, 8500, 9600, 8700, 9300
  ];
  
  const data = [];
  for (let i = 29; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dayIndex = 29 - i;
    const outputQty = baseOutputs[dayIndex];
    const defectRate = 0.02 + (dayIndex % 5) * 0.01; // 2-6% 범위
    const defectQty = Math.floor(outputQty * defectRate);
    
    data.push({
      date: date.toISOString().split('T')[0],
      output_qty: outputQty,
      defect_qty: defectQty,
      good_qty: outputQty - defectQty,
      defect_rate: defectRate,
      target_qty: 10000,
      shift: dayIndex % 2 === 0 ? 'A' as const : 'B' as const
    });
  }
  return data;
};

const generateMockOverallMetrics = (): OEEMetrics => ({
  availability: 0.82,
  performance: 0.89,
  quality: 0.94,
  oee: 0.69,
  actual_runtime: 18720,
  planned_runtime: 22800,
  ideal_runtime: 16800,
  output_qty: 45600,
  defect_qty: 2736
});

interface EngineerDashboardProps {
  selectedRole?: 'admin' | 'operator' | 'engineer';
  onRoleChange?: (role: 'admin' | 'operator' | 'engineer') => void;
}

export const EngineerDashboard: React.FC<EngineerDashboardProps> = ({ selectedRole, onRoleChange }) => {
  const isClient = useClientOnly();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedPeriod, setSelectedPeriod] = useState<'week' | 'month' | 'quarter'>('month');
  const [selectedMachines, setSelectedMachines] = useState<string[]>(['all']);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');
  
  // 데이터 상태
  const [overallMetrics, setOverallMetrics] = useState<OEEMetrics>(generateMockOverallMetrics());
  const [analysisData, setAnalysisData] = useState(generateMockAnalysisData());
  const [trendData, setTrendData] = useState(generateMockTrendData());
  const [downtimeData, setDowntimeData] = useState(generateMockDowntimeData());
  const [productionData, setProductionData] = useState(generateMockProductionData());

  // 데이터 새로고침
  const handleRefresh = async () => {
    setLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      setOverallMetrics(generateMockOverallMetrics());
      setAnalysisData(generateMockAnalysisData());
      setTrendData(generateMockTrendData());
      setDowntimeData(generateMockDowntimeData());
      setProductionData(generateMockProductionData());
    } catch (error) {
      console.error('데이터 새로고침 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  // 데이터 내보내기
  const handleExport = () => {
    const exportData = {
      timestamp: new Date().toISOString(),
      period: selectedPeriod,
      machines: selectedMachines,
      overallMetrics,
      analysisData,
      trendData,
      downtimeData,
      productionData
    };

    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `engineer-analysis-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 분석 테이블 컬럼
  const analysisColumns = [
    {
      title: '설비명',
      dataIndex: 'machine',
      key: 'machine',
      width: 100,
      fixed: 'left' as const,
    },
    {
      title: '위치',
      dataIndex: 'location',
      key: 'location',
      width: 120,
    },
    {
      title: 'OEE',
      dataIndex: 'avgOEE',
      key: 'avgOEE',
      width: 100,
      render: (value: number) => (
        <span style={{ 
          color: value >= 0.85 ? '#52c41a' : value >= 0.65 ? '#faad14' : '#ff4d4f',
          fontWeight: 'bold'
        }}>
          {(value * 100).toFixed(1)}%
        </span>
      ),
      sorter: (a: { avgOEE: number }, b: { avgOEE: number }) => a.avgOEE - b.avgOEE,
    },
    {
      title: '가동률',
      dataIndex: 'availability',
      key: 'availability',
      width: 100,
      render: (value: number) => `${(value * 100).toFixed(1)}%`,
      sorter: (a: { availability: number }, b: { availability: number }) => a.availability - b.availability,
    },
    {
      title: '성능',
      dataIndex: 'performance',
      key: 'performance',
      width: 100,
      render: (value: number) => `${(value * 100).toFixed(1)}%`,
      sorter: (a: { performance: number }, b: { performance: number }) => a.performance - b.performance,
    },
    {
      title: '품질',
      dataIndex: 'quality',
      key: 'quality',
      width: 100,
      render: (value: number) => `${(value * 100).toFixed(1)}%`,
      sorter: (a: { quality: number }, b: { quality: number }) => a.quality - b.quality,
    },
    {
      title: '다운타임(시간)',
      dataIndex: 'downtimeHours',
      key: 'downtimeHours',
      width: 120,
      render: (value: number) => `${value}h`,
      sorter: (a: { downtimeHours: number }, b: { downtimeHours: number }) => a.downtimeHours - b.downtimeHours,
    },
    {
      title: '불량률',
      dataIndex: 'defectRate',
      key: 'defectRate',
      width: 100,
      render: (value: number) => `${(value * 100).toFixed(2)}%`,
      sorter: (a: { defectRate: number }, b: { defectRate: number }) => a.defectRate - b.defectRate,
    },
    {
      title: '추세',
      dataIndex: 'trend',
      key: 'trend',
      width: 100,
      render: (trend: string, record: { trendValue: number }) => (
        <span style={{ color: trend === 'up' ? '#52c41a' : '#ff4d4f' }}>
          {trend === 'up' ? <RiseOutlined /> : <FallOutlined />}
          {record.trendValue.toFixed(1)}%
        </span>
      ),
    },
  ];

  return (
    <div>
      {/* 헤더 */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 'bold' }}>
              <BarChartOutlined style={{ marginRight: 8 }} />
              엔지니어 대시보드
            </h1>
            <p style={{ margin: '4px 0 0 0', color: '#666' }}>설비 성능 분석 및 개선 지표</p>
          </div>
          {/* 역할 선택기 */}
          {isClient && onRoleChange && (
            <div style={{ 
              background: 'white',
              padding: '8px 12px',
              borderRadius: 6,
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              border: '1px solid #d9d9d9'
            }}>
              <Space>
                <span style={{ fontSize: 12, color: '#666' }}>역할 선택:</span>
                <Select
                  value={selectedRole || 'engineer'}
                  onChange={onRoleChange}
                  size="small"
                  style={{ width: 100 }}
                  options={[
                    { label: '관리자', value: 'admin' },
                    { label: '운영자', value: 'operator' },
                    { label: '엔지니어', value: 'engineer' }
                  ]}
                />
              </Space>
            </div>
          )}
        </div>
        <Space>
          <Select
            value={selectedPeriod}
            onChange={setSelectedPeriod}
            options={[
              { label: '최근 1주', value: 'week' },
              { label: '최근 1개월', value: 'month' },
              { label: '최근 3개월', value: 'quarter' }
            ]}
            style={{ width: 120 }}
          />
          <Button icon={<FilterOutlined />}>
            필터
          </Button>
          <Button 
            icon={<ReloadOutlined />} 
            onClick={handleRefresh}
            loading={loading}
          >
            새로고침
          </Button>
          <Button 
            icon={<DownloadOutlined />}
            onClick={handleExport}
          >
            내보내기
          </Button>
        </Space>
      </div>

      {/* 주요 지표 요약 */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="평균 OEE"
              value={(overallMetrics.oee * 100).toFixed(1)}
              suffix="%"
              valueStyle={{ 
                color: overallMetrics.oee >= 0.85 ? '#52c41a' : 
                       overallMetrics.oee >= 0.65 ? '#faad14' : '#ff4d4f' 
              }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="평균 가동률"
              value={(overallMetrics.availability * 100).toFixed(1)}
              suffix="%"
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="평균 성능"
              value={(overallMetrics.performance * 100).toFixed(1)}
              suffix="%"
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title="평균 품질"
              value={(overallMetrics.quality * 100).toFixed(1)}
              suffix="%"
              valueStyle={{ color: '#faad14' }}
            />
          </Card>
        </Col>
      </Row>

      {/* 메인 분석 탭 */}
      <Tabs 
        activeKey={activeTab} 
        onChange={setActiveTab}
        items={[
          {
            key: 'overview',
            label: '종합 분석',
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={8}>
                  <OEEGauge
                    metrics={overallMetrics}
                    title="전체 OEE 현황"
                    size="large"
                    showDetails={true}
                  />
                </Col>
                <Col xs={24} lg={16}>
                  <OEETrendChart
                    data={trendData}
                    title="OEE 추이 분석"
                    height={400}
                    showControls={true}
                  />
                </Col>
              </Row>
            )
          },
          {
            key: 'machines',
            label: '설비별 분석',
            children: (
              <Card title="설비별 성능 분석" extra={
                <Space>
                  <Select
                    mode="multiple"
                    value={selectedMachines}
                    onChange={setSelectedMachines}
                    placeholder="설비 선택"
                    style={{ minWidth: 200 }}
                    options={[
                      { label: '전체', value: 'all' },
                      { label: 'CNC-001', value: 'CNC-001' },
                      { label: 'CNC-002', value: 'CNC-002' },
                      { label: 'CNC-003', value: 'CNC-003' },
                      { label: 'CNC-004', value: 'CNC-004' },
                      { label: 'CNC-005', value: 'CNC-005' },
                    ]}
                  />
                </Space>
              }>
                <Table
                  columns={analysisColumns}
                  dataSource={analysisData}
                  pagination={{ pageSize: 10 }}
                  scroll={{ x: 1000 }}
                  size="small"
                  loading={loading}
                />
              </Card>
            )
          },
          {
            key: 'downtime',
            label: '다운타임 분석',
            children: (
              <DowntimeChart
                data={downtimeData}
                title="다운타임 원인 분석"
                height={500}
                showTable={true}
              />
            )
          },
          {
            key: 'productivity',
            label: '생산성 분석',
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24}>
                  <ProductionChart
                    data={productionData}
                    title="생산성 추이 분석"
                    height={400}
                    chartType={chartType}
                    showControls={true}
                    onChartTypeChange={setChartType}
                  />
                </Col>
              </Row>
            )
          },
          {
            key: 'quality',
            label: '품질 분석',
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={12}>
                  <Card title="불량률 추이">
                    <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                      품질 분석 차트 (구현 예정)
                    </div>
                  </Card>
                </Col>
                <Col xs={24} lg={12}>
                  <Card title="불량 유형별 분석">
                    <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                      불량 유형 차트 (구현 예정)
                    </div>
                  </Card>
                </Col>
              </Row>
            )
          },
          {
            key: 'comparison',
            label: '비교 분석',
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24}>
                  <Card title="설비간 성능 비교" extra={
                    <Space>
                      <RangePicker />
                      <Select
                        value={chartType}
                        onChange={setChartType}
                        options={[
                          { label: '막대 차트', value: 'bar' },
                          { label: '선 차트', value: 'line' }
                        ]}
                      />
                    </Space>
                  }>
                    <div style={{ height: 400, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                      설비간 비교 차트 (구현 예정)
                    </div>
                  </Card>
                </Col>
              </Row>
            )
          }
        ]}
      />
    </div>
  );
};