'use client';

import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Tabs, Select, DatePicker, Button, Space, Table, Statistic } from 'antd';
import { 
  BarChartOutlined, 
  DownloadOutlined,
  FilterOutlined,
  ReloadOutlined,
  RiseOutlined,
  FallOutlined,
  WifiOutlined
} from '@ant-design/icons';
import { OEEGauge, IndependentOEETrendChart, DowntimeChart, ProductionChart } from '@/components/oee';
import { OEEMetrics } from '@/types';
import { useClientOnly } from '@/hooks/useClientOnly';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import { useEngineerData } from '@/hooks/useEngineerData';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';

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
  onError?: (error: Error) => void;
}

export const EngineerDashboard: React.FC<EngineerDashboardProps> = ({ onError }) => {
  const isClient = useClientOnly();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [activeTab, setActiveTab] = useState('overview');
  const [selectedPeriod, setSelectedPeriod] = useState<'week' | 'month' | 'quarter'>('month');
  const [selectedMachines, setSelectedMachines] = useState<string[]>(['all']);
  const [chartType, setChartType] = useState<'bar' | 'line'>('line');
  
  // 실시간 데이터 훅 사용
  const { 
    machines, 
    machineLogs, 
    productionRecords, 
    oeeMetrics, 
    loading: realtimeLoading, 
    error: realtimeError, 
    refresh, 
    isConnected 
  } = useRealtimeData(user?.id, user?.role);

  // 엔지니어 분석 데이터 훅 사용
  const {
    oeeData,
    downtimeData,
    productionData,
    loading: engineerDataLoading,
    error: engineerDataError,
    refreshData: refreshEngineerData
  } = useEngineerData(selectedPeriod, selectedMachines[0] !== 'all' ? selectedMachines[0] : undefined);

  // 데이터 변경 추적을 위한 로깅
  React.useEffect(() => {
    console.log('🎛️ EngineerDashboard - 현재 상태:', {
      selectedPeriod,
      selectedMachine: selectedMachines[0] !== 'all' ? selectedMachines[0] : 'all',
      oeeDataLength: oeeData.length,
      downtimeDataLength: downtimeData.length,
      productionDataLength: productionData.length,
      loading: engineerDataLoading,
      error: engineerDataError
    });
    
    if (oeeData.length > 0) {
      console.log('📊 OEE 데이터 샘플:', oeeData.slice(0, 3));
    }
    if (downtimeData.length > 0) {
      console.log('⏰ 다운타임 데이터 샘플:', downtimeData.slice(0, 3));
    }
  }, [selectedPeriod, oeeData, downtimeData, productionData, engineerDataLoading, engineerDataError, selectedMachines]);

  const loading = realtimeLoading || engineerDataLoading;
  const error = realtimeError || engineerDataError;

  // 폴백 데이터
  const [fallbackData] = useState({
    overallMetrics: generateMockOverallMetrics(),
    analysisData: generateMockAnalysisData(),
    trendData: generateMockTrendData(),
    downtimeData: generateMockDowntimeData(),
    productionData: generateMockProductionData()
  });

  // 에러 핸들링
  useEffect(() => {
    if (error && onError) {
      onError(new Error(`EngineerDashboard: ${error}`));
    }
  }, [error, onError]);

  // 기간 변경시 엔지니어 데이터 새로고침
  useEffect(() => {
    refreshEngineerData();
  }, [selectedPeriod, refreshEngineerData]);

  // 데이터 처리 및 분석
  const processedData = React.useMemo(() => {
    try {
      if (machines.length === 0) {
        return fallbackData;
      }

    // 전체 OEE 계산
    const totalOEE = Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.oee, 0) / Math.max(Object.keys(oeeMetrics).length, 1);
    const totalAvailability = Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.availability, 0) / Math.max(Object.keys(oeeMetrics).length, 1);
    const totalPerformance = Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.performance, 0) / Math.max(Object.keys(oeeMetrics).length, 1);
    const totalQuality = Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.quality, 0) / Math.max(Object.keys(oeeMetrics).length, 1);
    
    const overallMetrics: OEEMetrics = {
      availability: totalAvailability,
      performance: totalPerformance,
      quality: totalQuality,
      oee: totalOEE,
      actual_runtime: Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.actual_runtime, 0),
      planned_runtime: Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.planned_runtime, 0),
      ideal_runtime: Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.ideal_runtime, 0),
      output_qty: Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.output_qty, 0),
      defect_qty: Object.values(oeeMetrics).reduce((sum, metrics) => sum + metrics.defect_qty, 0)
    };

    // 설비별 분석 데이터
    const analysisData = machines.map(machine => {
      const metrics = oeeMetrics[machine.id];
      const logs = machineLogs.filter(log => log.machine_id === machine.id);
      const downtimeHours = logs
        .filter(log => log.state !== 'NORMAL_OPERATION' && log.duration)
        .reduce((sum, log) => sum + (log.duration || 0), 0) / 60;

      return {
        key: machine.id,
        machine: machine.name,
        location: machine.location,
        avgOEE: metrics?.oee || 0,
        availability: metrics?.availability || 0,
        performance: metrics?.performance || 0,
        quality: metrics?.quality || 0,
        downtimeHours: Math.round(downtimeHours),
        defectRate: metrics ? (metrics.defect_qty / Math.max(metrics.output_qty, 1)) : 0,
        trend: Math.random() > 0.5 ? 'up' as const : 'down' as const,
        trendValue: Math.random() * 10
      };
    });

    // 다운타임 분석
    const downtimeAnalysis = machineLogs
      .filter(log => log.state !== 'NORMAL_OPERATION' && log.duration)
      .reduce((acc, log) => {
        const existing = acc.find(item => item.state === log.state);
        if (existing) {
          existing.duration += log.duration || 0;
          existing.count += 1;
        } else {
          acc.push({
            state: log.state,
            duration: log.duration || 0,
            count: 1,
            percentage: 0
          });
        }
        return acc;
      }, [] as Array<{ state: string; duration: number; count: number; percentage: number }>);

    const totalDowntime = downtimeAnalysis.reduce((sum, item) => sum + item.duration, 0);
    downtimeAnalysis.forEach(item => {
      item.percentage = totalDowntime > 0 ? (item.duration / totalDowntime) * 100 : 0;
    });

      return {
        overallMetrics,
        analysisData,
        trendData: oeeData.length > 0 ? oeeData : fallbackData.trendData, // 실제 API 데이터 우선 사용
        downtimeData: downtimeData.length > 0 ? downtimeData : downtimeAnalysis.slice(0, 5),
        productionData: productionData.length > 0 ? productionData : fallbackData.productionData // 실제 API 데이터 우선 사용
      };
    } catch (error) {
      console.error('Error processing engineer dashboard data:', error);
      if (onError) {
        onError(error as Error);
      }
      return fallbackData;
    }
  }, [machines, machineLogs, oeeMetrics, oeeData, downtimeData, productionData, fallbackData, onError]);

  // 데이터 내보내기
  const handleExport = () => {
    const exportData = {
      timestamp: new Date().toISOString(),
      period: selectedPeriod,
      machines: selectedMachines,
      ...processedData
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
      title: t('dashboard:table.machineName'),
      dataIndex: 'machine',
      key: 'machine',
      width: 100,
      fixed: 'left' as const,
    },
    {
      title: t('dashboard:table.location'),
      dataIndex: 'location',
      key: 'location',
      width: 120,
    },
    {
      title: t('dashboard:table.oee'),
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
      title: t('dashboard:table.availability'),
      dataIndex: 'availability',
      key: 'availability',
      width: 100,
      render: (value: number) => `${(value * 100).toFixed(1)}%`,
      sorter: (a: { availability: number }, b: { availability: number }) => a.availability - b.availability,
    },
    {
      title: t('dashboard:table.performance'),
      dataIndex: 'performance',
      key: 'performance',
      width: 100,
      render: (value: number) => `${(value * 100).toFixed(1)}%`,
      sorter: (a: { performance: number }, b: { performance: number }) => a.performance - b.performance,
    },
    {
      title: t('dashboard:table.quality'),
      dataIndex: 'quality',
      key: 'quality',
      width: 100,
      render: (value: number) => `${(value * 100).toFixed(1)}%`,
      sorter: (a: { quality: number }, b: { quality: number }) => a.quality - b.quality,
    },
    {
      title: t('dashboard:table.downtimeHours'),
      dataIndex: 'downtimeHours',
      key: 'downtimeHours',
      width: 120,
      render: (value: number) => `${value}h`,
      sorter: (a: { downtimeHours: number }, b: { downtimeHours: number }) => a.downtimeHours - b.downtimeHours,
    },
    {
      title: t('dashboard:table.defectRate'),
      dataIndex: 'defectRate',
      key: 'defectRate',
      width: 100,
      render: (value: number) => `${(value * 100).toFixed(2)}%`,
      sorter: (a: { defectRate: number }, b: { defectRate: number }) => a.defectRate - b.defectRate,
    },
    {
      title: t('dashboard:table.trend'),
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
              {t('dashboard:engineerDashboard.title')}
            </h1>
            <p style={{ margin: '4px 0 0 0', color: '#666' }}>
              {t('dashboard:engineerDashboard.description')}
              {isConnected && (
                <span style={{ marginLeft: 8, color: '#52c41a' }}>
                  <WifiOutlined /> {t('dashboard:adminDashboard.connectedRealtime')}
                </span>
              )}
            </p>
          </div>

        </div>
        <Space>
          <Select
            value={selectedPeriod}
            onChange={(value) => {
              console.log('🔄 기간 변경 요청:', value);
              setSelectedPeriod(value);
            }}
            options={[
              { label: t('dashboard:filters.thisWeek'), value: 'week' },
              { label: t('dashboard:engineerDashboard.timeFilter.recent1Month'), value: 'month' },
              { label: t('dashboard:filters.thisMonth') + ' x3', value: 'quarter' }
            ]}
            style={{ width: 120 }}
          />
          <Button icon={<FilterOutlined />}>
            {t('dashboard:engineerDashboard.timeFilter.filter')}
          </Button>
          <Button 
            icon={<ReloadOutlined />} 
            onClick={() => {
              refresh();
              refreshEngineerData();
            }}
            loading={loading}
          >
            {t('dashboard:adminDashboard.refresh')}
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
              title={t('dashboard:engineerDashboard.averageOee')}
              value={(processedData.overallMetrics.oee * 100).toFixed(1)}
              suffix="%"
              valueStyle={{ 
                color: processedData.overallMetrics.oee >= 0.85 ? '#52c41a' : 
                       processedData.overallMetrics.oee >= 0.65 ? '#faad14' : '#ff4d4f' 
              }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title={t('dashboard:engineerDashboard.averageAvailability')}
              value={(processedData.overallMetrics.availability * 100).toFixed(1)}
              suffix="%"
              valueStyle={{ color: '#1890ff' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title={t('dashboard:engineerDashboard.averagePerformance')}
              value={(processedData.overallMetrics.performance * 100).toFixed(1)}
              suffix="%"
              valueStyle={{ color: '#52c41a' }}
            />
          </Card>
        </Col>
        <Col xs={12} sm={6}>
          <Card>
            <Statistic
              title={t('dashboard:engineerDashboard.averageQuality')}
              value={(processedData.overallMetrics.quality * 100).toFixed(1)}
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
            label: t('dashboard:engineerDashboard.analysis.collision'),
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={8}>
                  <OEEGauge
                    metrics={processedData.overallMetrics}
                    title={t('dashboard:engineerDashboard.charts.overallOeeStatus')}
                    size="large"
                    showDetails={true}
                  />
                </Col>
                <Col xs={24} lg={16}>
                  <IndependentOEETrendChart
                    title={t('dashboard:engineerDashboard.charts.oeeTrendAnalysis')}
                    height={400}
                  />
                </Col>
              </Row>
            )
          },
          {
            key: 'machines',
            label: t('dashboard:engineerDashboard.analysis.performance'),
            children: (
              <Card title={t('dashboard:table.machinePerformanceAnalysis')} extra={
                <Space>
                  <Select
                    mode="multiple"
                    value={selectedMachines}
                    onChange={setSelectedMachines}
                    placeholder={t('dashboard:filters.machine')}
                    style={{ minWidth: 200 }}
                    options={[
                      { label: t('dashboard:table.all'), value: 'all' },
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
                  dataSource={processedData.analysisData}
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
            label: t('dashboard:engineerDashboard.analysis.downtime'),
            children: (
              <DowntimeChart
                data={processedData.downtimeData}
                title={t('dashboard:chart.downtimeRootCauseAnalysis')}
                height={500}
                showTable={true}
              />
            )
          },
          {
            key: 'productivity',
            label: t('dashboard:engineerDashboard.analysis.productivity'),
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24}>
                  <ProductionChart
                    data={processedData.productionData}
                    title={t('dashboard:chart.productivityTrendAnalysis')}
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
            label: t('dashboard:engineerDashboard.analysis.quality'),
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24} lg={12}>
                  <Card title={t('dashboard:chart.defectRateTrend')}>
                    <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                      {t('dashboard:chart.qualityAnalysisChart')}
                    </div>
                  </Card>
                </Col>
                <Col xs={24} lg={12}>
                  <Card title={t('dashboard:chart.defectTypeAnalysis')}>
                    <div style={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999' }}>
                      {t('dashboard:chart.defectTypeChart')}
                    </div>
                  </Card>
                </Col>
              </Row>
            )
          },
          {
            key: 'comparison',
            label: t('dashboard:engineerDashboard.analysis.comparison'),
            children: (
              <Row gutter={[16, 16]}>
                <Col xs={24}>
                  <Card title={t('dashboard:chart.machinePerformanceComparison')} extra={
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