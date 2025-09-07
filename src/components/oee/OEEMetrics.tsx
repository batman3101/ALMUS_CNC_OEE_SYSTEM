'use client';

import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Tabs, DatePicker, Select, Space, Button, Spin } from 'antd';
import { ReloadOutlined, DownloadOutlined, FileExcelOutlined, FilePdfOutlined } from '@ant-design/icons';
import { OEEGauge } from './OEEGauge';
import { OEETrendChart } from './OEETrendChart';
import { DowntimeChart } from './DowntimeChart';
import { ProductionChart } from './ProductionChart';
import { ReportGenerator } from '@/components/reports';
import { OEECalculator, RealTimeOEECalculator } from '@/utils/oeeCalculator';
import { OEEMetrics as OEEMetricsType, MachineLog, ProductionRecord } from '@/types';
import { useSystemSettings } from '@/hooks/useSystemSettings';

const { RangePicker } = DatePicker;
// Removed deprecated TabPane import

interface OEEMetricsProps {
  machineId: string;
  machineName?: string;
  realTime?: boolean;
  showControls?: boolean;
  onDataRefresh?: () => void;
}

// 모의 데이터 생성 함수들
const generateMockOEEData = (): OEEMetricsType => ({
  availability: 0.85,
  performance: 0.92,
  quality: 0.96,
  oee: 0.75,
  actual_runtime: 510,
  planned_runtime: 600,
  ideal_runtime: 480,
  output_qty: 1200,
  defect_qty: 48
});

const generateMockTrendData = (formatDate: (date: Date) => string) => {
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    data.push({
      date: formatDate(date),
      availability: 0.8 + Math.random() * 0.15,
      performance: 0.85 + Math.random() * 0.1,
      quality: 0.9 + Math.random() * 0.08,
      oee: 0.65 + Math.random() * 0.2,
      shift: Math.random() > 0.5 ? 'A' as const : 'B' as const
    });
  }
  return data;
};

const generateMockDowntimeData = () => [
  { state: 'MAINTENANCE' as const, duration: 120, count: 3, percentage: 35.3 },
  { state: 'MODEL_CHANGE' as const, duration: 90, count: 2, percentage: 26.5 },
  { state: 'TOOL_CHANGE' as const, duration: 60, count: 8, percentage: 17.6 },
  { state: 'PROGRAM_CHANGE' as const, duration: 45, count: 4, percentage: 13.2 },
  { state: 'TEMPORARY_STOP' as const, duration: 25, count: 6, percentage: 7.4 }
];

const generateMockProductionData = (formatDate: (date: Date) => string) => {
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const outputQty = 1000 + Math.floor(Math.random() * 400);
    const defectQty = Math.floor(outputQty * (0.02 + Math.random() * 0.06));
    data.push({
      date: formatDate(date),
      output_qty: outputQty,
      defect_qty: defectQty,
      good_qty: outputQty - defectQty,
      defect_rate: defectQty / outputQty,
      target_qty: 1200,
      shift: Math.random() > 0.5 ? 'A' as const : 'B' as const
    });
  }
  return data;
};

export const OEEMetrics: React.FC<OEEMetricsProps> = ({
  machineId,
  machineName = '설비',
  realTime = false,
  showControls = true,
  onDataRefresh
}) => {
  const { formatDate, formatDateTime, getAntdDateFormat } = useSystemSettings();
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar');

  // 데이터 상태
  const [oeeMetrics, setOeeMetrics] = useState<OEEMetricsType>(generateMockOEEData());
  const [trendData, setTrendData] = useState(generateMockTrendData(formatDate));
  const [downtimeData, setDowntimeData] = useState(generateMockDowntimeData());
  const [productionData, setProductionData] = useState(generateMockProductionData(formatDate));

  // 데이터 새로고침
  const handleRefresh = async () => {
    setLoading(true);
    try {
      // 실제 구현에서는 API 호출
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      setOeeMetrics(generateMockOEEData());
      setTrendData(generateMockTrendData(formatDate));
      setDowntimeData(generateMockDowntimeData());
      setProductionData(generateMockProductionData(formatDate));
      
      if (onDataRefresh) {
        onDataRefresh();
      }
    } catch (error) {
      console.error('데이터 새로고침 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  // 실시간 데이터 업데이트 (실시간 모드일 때)
  useEffect(() => {
    if (!realTime) return;

    const interval = setInterval(() => {
      setOeeMetrics(generateMockOEEData());
    }, 30000); // 30초마다 업데이트

    return () => clearInterval(interval);
  }, [realTime]);

  // 데이터 내보내기
  const handleExport = () => {
    const exportData = {
      machineId,
      machineName,
      timestamp: formatDateTime(new Date()),
      oeeMetrics,
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
    a.download = `oee-metrics-${machineId}-${formatDate(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // 보고서 생성용 데이터 준비
  const getReportData = () => {
    const mockMachine = {
      id: machineId,
      name: machineName,
      location: 'Production Floor',
      model_type: 'CNC Machine',
      default_tact_time: 60,
      is_active: true,
      created_at: formatDateTime(new Date()),
      updated_at: formatDateTime(new Date())
    };

    const mockProductionRecords = productionData.map((prod, index) => ({
      record_id: `record_${index}`,
      machine_id: machineId,
      date: prod.date,
      shift: prod.shift,
      output_qty: prod.output_qty,
      defect_qty: prod.defect_qty,
      created_at: formatDateTime(new Date())
    }));

    return {
      machines: [mockMachine],
      oeeData: [oeeMetrics],
      productionData: mockProductionRecords
    };
  };

  return (
    <div>
      {/* 컨트롤 패널 */}
      {showControls && (
        <Card style={{ marginBottom: 16 }}>
          <Row justify="space-between" align="middle">
            <Col>
              <Space>
                <RangePicker
                  onChange={(dates, dateStrings) => {
                    setDateRange(dates ? [dateStrings[0], dateStrings[1]] : null);
                  }}
                  format={getAntdDateFormat()}
                  placeholder={['시작일', '종료일']}
                />
                <Select
                  value={period}
                  onChange={setPeriod}
                  options={[
                    { label: '일별', value: 'daily' },
                    { label: '주별', value: 'weekly' },
                    { label: '월별', value: 'monthly' }
                  ]}
                  style={{ width: 100 }}
                />
              </Space>
            </Col>
            
            <Col>
              <Space>
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
                  JSON 내보내기
                </Button>
              </Space>
            </Col>
          </Row>
        </Card>
      )}

      {/* 보고서 생성 */}
      <ReportGenerator
        {...getReportData()}
        className="mb-4"
      />

      {/* 메인 콘텐츠 */}
      <Spin spinning={loading}>
        <Tabs 
          activeKey={activeTab} 
          onChange={setActiveTab}
          items={[
            {
              key: 'overview',
              label: '개요',
              children: (
                <Row gutter={[16, 16]}>
                  <Col xs={24} lg={12}>
                    <OEEGauge
                      metrics={oeeMetrics}
                      title={`${machineName} OEE`}
                      size="large"
                      showDetails={true}
                    />
                  </Col>
                  
                  <Col xs={24} lg={12}>
                    <OEETrendChart
                      data={trendData}
                      title="최근 7일 OEE 추이"
                      height={400}
                      showControls={false}
                    />
                  </Col>
                </Row>
              )
            },
            {
              key: 'trend',
              label: '추이 분석',
              children: (
                <OEETrendChart
                  data={trendData}
                  title={`${machineName} OEE 추이 분석`}
                  height={500}
                  showControls={true}
                  onDateRangeChange={setDateRange}
                  onPeriodChange={setPeriod}
                />
              )
            },
            {
              key: 'downtime',
              label: '다운타임 분석',
              children: (
                <DowntimeChart
                  data={downtimeData}
                  title={`${machineName} 다운타임 원인 분석`}
                  height={500}
                  showTable={true}
                />
              )
            },
            {
              key: 'production',
              label: '생산 실적',
              children: (
                <ProductionChart
                  data={productionData}
                  title={`${machineName} 생산 실적`}
                  height={500}
                  chartType={chartType}
                  showControls={true}
                  onChartTypeChange={setChartType}
                />
              )
            },
            {
              key: 'details',
              label: '상세 지표',
              children: (
                <Row gutter={[16, 16]}>
                  <Col xs={24} md={8}>
                    <Card title="가동률 분석" size="small">
                      <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <div style={{ fontSize: 32, fontWeight: 'bold', color: '#1890ff' }}>
                          {(oeeMetrics.availability * 100).toFixed(1)}%
                        </div>
                        <div style={{ marginTop: 16 }}>
                          <div>실제 가동시간: {Math.round(oeeMetrics.actual_runtime)}분</div>
                          <div>계획 가동시간: {Math.round(oeeMetrics.planned_runtime)}분</div>
                          <div>손실 시간: {Math.round(oeeMetrics.planned_runtime - oeeMetrics.actual_runtime)}분</div>
                        </div>
                      </div>
                    </Card>
                  </Col>
                  
                  <Col xs={24} md={8}>
                    <Card title="성능 분석" size="small">
                      <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <div style={{ fontSize: 32, fontWeight: 'bold', color: '#52c41a' }}>
                          {(oeeMetrics.performance * 100).toFixed(1)}%
                        </div>
                        <div style={{ marginTop: 16 }}>
                          <div>이론 생산시간: {Math.round(oeeMetrics.ideal_runtime)}분</div>
                          <div>실제 가동시간: {Math.round(oeeMetrics.actual_runtime)}분</div>
                          <div>속도 손실: {Math.round(oeeMetrics.actual_runtime - oeeMetrics.ideal_runtime)}분</div>
                        </div>
                      </div>
                    </Card>
                  </Col>
                  
                  <Col xs={24} md={8}>
                    <Card title="품질 분석" size="small">
                      <div style={{ textAlign: 'center', padding: '20px 0' }}>
                        <div style={{ fontSize: 32, fontWeight: 'bold', color: '#faad14' }}>
                          {(oeeMetrics.quality * 100).toFixed(1)}%
                        </div>
                        <div style={{ marginTop: 16 }}>
                          <div>총 생산량: {oeeMetrics.output_qty.toLocaleString()}개</div>
                          <div>불량 수량: {oeeMetrics.defect_qty.toLocaleString()}개</div>
                          <div>양품 수량: {(oeeMetrics.output_qty - oeeMetrics.defect_qty).toLocaleString()}개</div>
                        </div>
                      </div>
                    </Card>
                  </Col>
                </Row>
              )
            }
          ]}
        />
      </Spin>
    </div>
  );
};