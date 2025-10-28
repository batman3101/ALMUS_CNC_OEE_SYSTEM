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

// 실제 Supabase API 함수들
const fetchOEEMetrics = async (machineId: string): Promise<OEEMetricsType | null> => {
  try {
    const response = await fetch(`/api/machines/${machineId}/oee-metrics`);
    if (!response.ok) return null;
    const data = await response.json();
    return data.oee_metrics || null;
  } catch (error) {
    console.error('Failed to fetch OEE metrics:', error);
    return null;
  }
};

const fetchDowntimeAnalysis = async (machineId: string) => {
  try {
    const response = await fetch(`/api/machines/${machineId}/downtime-analysis`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.downtime_analysis || [];
  } catch (error) {
    console.error('Failed to fetch downtime analysis:', error);
    return [];
  }
};

const fetchTrendData = async (machineId: string) => {
  try {
    const response = await fetch(`/api/machines/${machineId}/trend-data?days=7`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.trend_data || [];
  } catch (error) {
    console.error('Failed to fetch trend data:', error);
    return [];
  }
};

const fetchProductionData = async (machineId: string) => {
  try {
    const response = await fetch(`/api/machines/${machineId}/production?days=7`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.production_records || [];
  } catch (error) {
    console.error('Failed to fetch production data:', error);
    return [];
  }
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
  const [oeeMetrics, setOeeMetrics] = useState<OEEMetricsType>({
    availability: 0,
    performance: 0,
    quality: 0,
    oee: 0,
    actual_runtime: 0,
    planned_runtime: 0,
    ideal_runtime: 0,
    output_qty: 0,
    defect_qty: 0
  });
  const [trendData, setTrendData] = useState<any[]>([]);
  const [downtimeData, setDowntimeData] = useState<any[]>([]);
  const [productionData, setProductionData] = useState<any[]>([]);

  // 데이터 새로고침
  const handleRefresh = async () => {
    setLoading(true);
    try {
      // 실제 Supabase API 호출
      const [metrics, trend, downtime, production] = await Promise.all([
        fetchOEEMetrics(machineId),
        fetchTrendData(machineId),
        fetchDowntimeAnalysis(machineId),
        fetchProductionData(machineId)
      ]);

      if (metrics) setOeeMetrics(metrics);
      setTrendData(trend);
      setDowntimeData(downtime);
      setProductionData(production);

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

    const interval = setInterval(async () => {
      const metrics = await fetchOEEMetrics(machineId);
      if (metrics) setOeeMetrics(metrics);
    }, 30000); // 30초마다 업데이트

    return () => clearInterval(interval);
  }, [realTime, machineId]);

  // 초기 데이터 로딩
  useEffect(() => {
    handleRefresh();
  }, [machineId]);

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

  // 보고서 생성용 데이터 준비 (실제 데이터 기반)
  const getReportData = () => {
    // 실제 설비 데이터
    const machineData = {
      id: machineId,
      name: machineName,
      location: 'Production Floor',
      model_type: 'CNC Machine',
      default_tact_time: 60,
      is_active: true,
      created_at: formatDateTime(new Date()),
      updated_at: formatDateTime(new Date())
    };

    // 실제 생산 기록 데이터
    const formattedProductionRecords = productionData.map((prod, index) => ({
      record_id: `record_${index}`,
      machine_id: machineId,
      date: prod.date,
      shift: prod.shift,
      output_qty: prod.output_qty,
      defect_qty: prod.defect_qty,
      created_at: formatDateTime(new Date())
    }));

    return {
      machines: [machineData],
      oeeData: [oeeMetrics],
      productionData: formattedProductionRecords
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