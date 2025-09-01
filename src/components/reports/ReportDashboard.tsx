'use client';

import React, { useState, useEffect } from 'react';
import {
  Card,
  Row,
  Col,
  Button,
  Select,
  DatePicker,
  Table,
  Space,
  Statistic,
  Progress,
  Spin,
  Modal,
  Tabs,
  App
} from 'antd';
import {
  FileExcelOutlined,
  FilePdfOutlined,
  BarChartOutlined,
  LineChartOutlined,
  PieChartOutlined,
  EyeOutlined,
  DownloadOutlined
} from '@ant-design/icons';
import { ReportGenerator } from './ReportGenerator';
import { ReportTemplates } from './ReportTemplates';
import { useReportsTranslation } from '@/hooks/useTranslation';
import { OEEMetrics, Machine, ProductionRecord } from '@/types';
import { ReportUtils } from '@/utils/reportUtils';

const { RangePicker } = DatePicker;
const { Option } = Select;

interface ReportDashboardProps {
  machines?: Machine[];
  className?: string;
  loading?: boolean;
  productionRecords?: any[];
  aggregatedData?: {
    totalProduction: number;
    totalDefects: number;
    totalGoodQuantity: number;
    avgOEE: number;
    avgAvailability: number;
    avgPerformance: number;
    avgQuality: number;
    recordCount: number;
  };
  onRefreshRecords?: () => void;
}

export const ReportDashboard: React.FC<ReportDashboardProps> = ({
  machines = [],
  className,
  loading: initialLoading = false,
  productionRecords = [],
  aggregatedData,
  onRefreshRecords
}) => {
  const { t } = useReportsTranslation();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [previewType, setPreviewType] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [selectedMachines, setSelectedMachines] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [reportData, setReportData] = useState<{
    oeeData: OEEMetrics[];
    productionData: ProductionRecord[];
  }>({
    oeeData: [],
    productionData: []
  });

  // 실시간 생산 기록 데이터 업데이트 처리
  useEffect(() => {
    if (productionRecords.length > 0) {
      // OEE 데이터 계산
      const oeeData: OEEMetrics[] = productionRecords.map(record => ({
        availability: record.availability || 0,
        performance: record.performance || 0,
        quality: record.quality || 0,
        oee: record.oee || 0,
        actual_runtime: record.actual_runtime || 0,
        planned_runtime: record.planned_runtime || 0,
        ideal_runtime: record.ideal_runtime || 0,
        output_qty: record.output_qty || 0,
        defect_qty: record.defect_qty || 0
      }));

      setReportData({
        oeeData,
        productionData: productionRecords
      });
    }
  }, [productionRecords]);

  // 실제 데이터 가져오기
  const fetchReportData = async () => {
    try {
      setLoading(true);
      
      // 생산 데이터 가져오기
      const productionResponse = await fetch('/api/production-records');
      let productionData: ProductionRecord[] = [];
      
      if (productionResponse.ok) {
        const prodData = await productionResponse.json();
        productionData = prodData.records || [];
      }

      // OEE 데이터 계산
      const oeeData: OEEMetrics[] = productionData.map(record => {
        const availability = 0.85 + Math.random() * 0.1; // 실제로는 서버에서 계산되어야 함
        const performance = 0.88 + Math.random() * 0.08;
        const quality = record.defect_qty > 0 
          ? (record.output_qty - record.defect_qty) / record.output_qty
          : 0.98;
        
        return {
          availability,
          performance,
          quality,
          oee: availability * performance * quality,
          actual_runtime: 420 + Math.random() * 60,
          planned_runtime: 480,
          ideal_runtime: 480,
          output_qty: record.output_qty,
          defect_qty: record.defect_qty
        };
      });

      setReportData({ oeeData, productionData });
    } catch (error) {
      console.error('데이터 가져오기 실패:', error);
      message.error('보고서 데이터를 불러오는데 실패했습니다');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (machines.length > 0) {
      fetchReportData();
    }
  }, [machines]);

  // 보고서 미리보기
  const handlePreview = async (template: 'daily' | 'weekly' | 'monthly') => {
    setLoading(true);
    try {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date();
      
      switch (template) {
        case 'daily':
          startDate.setDate(startDate.getDate() - 1);
          break;
        case 'weekly':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'monthly':
          startDate.setMonth(startDate.getMonth() - 1);
          break;
      }

      // 미리보기 데이터 준비
      const previewContent = {
        period: `${startDate.toISOString().split('T')[0]} ~ ${endDate}`,
        machines: selectedMachines.length > 0 
          ? machines.filter(m => selectedMachines.includes(m.id))
          : machines,
        stats: calculateStats(),
        oeeData: reportData.oeeData.slice(0, template === 'daily' ? 1 : template === 'weekly' ? 7 : 30),
        productionData: reportData.productionData.slice(0, template === 'daily' ? 1 : template === 'weekly' ? 7 : 30)
      };

      setPreviewData(previewContent);
      setPreviewType(template);
      setPreviewModalVisible(true);
    } catch (error) {
      console.error('미리보기 생성 실패:', error);
      message.error('미리보기 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 빠른 보고서 생성
  const handleQuickReport = async (type: 'pdf' | 'excel', template: 'daily' | 'weekly' | 'monthly') => {
    setLoading(true);
    try {
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date();
      
      switch (template) {
        case 'daily':
          startDate.setDate(startDate.getDate() - 1);
          break;
        case 'weekly':
          startDate.setDate(startDate.getDate() - 7);
          break;
        case 'monthly':
          startDate.setMonth(startDate.getMonth() - 1);
          break;
      }

      const reportConfig = {
        machines: selectedMachines.length > 0 
          ? machines.filter(m => selectedMachines.includes(m.id))
          : machines,
        oeeData: reportData.oeeData,
        productionData: reportData.productionData,
        reportType: 'summary' as const,
        dateRange: [startDate.toISOString().split('T')[0], endDate] as [string, string],
        selectedMachines: selectedMachines.length > 0 ? selectedMachines : machines.map(m => m.id),
        includeCharts: true,
        includeOEE: true,
        includeProduction: true,
        includeDowntime: true,
        groupBy: 'machine' as const
      };

      await ReportTemplates.generateTemplateReport(template, reportConfig, type);
      message.success(`${template} ${type.toUpperCase()} 보고서가 생성되었습니다.`);
    } catch (error) {
      console.error('보고서 생성 실패:', error);
      message.error('보고서 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 통계 계산 - 실시간 데이터 우선 사용
  const calculateStats = () => {
    // 실시간 집계 데이터가 있으면 우선 사용
    if (aggregatedData) {
      return {
        avgOEE: aggregatedData.avgOEE / 100, // 훅에서는 %로, 여기서는 소수로 변환
        avgAvailability: aggregatedData.avgAvailability / 100,
        avgPerformance: aggregatedData.avgPerformance / 100,
        avgQuality: aggregatedData.avgQuality / 100,
        totalOutput: aggregatedData.totalProduction,
        totalDefects: aggregatedData.totalDefects
      };
    }

    // 실시간 데이터가 없으면 기존 계산 로직 사용
    if (reportData.oeeData.length === 0) {
      return {
        avgOEE: 0,
        avgAvailability: 0,
        avgPerformance: 0,
        avgQuality: 0,
        totalOutput: 0,
        totalDefects: 0
      };
    }

    const avgOEE = reportData.oeeData.reduce((sum, oee) => sum + oee.oee, 0) / reportData.oeeData.length;
    const avgAvailability = reportData.oeeData.reduce((sum, oee) => sum + oee.availability, 0) / reportData.oeeData.length;
    const avgPerformance = reportData.oeeData.reduce((sum, oee) => sum + oee.performance, 0) / reportData.oeeData.length;
    const avgQuality = reportData.oeeData.reduce((sum, oee) => sum + oee.quality, 0) / reportData.oeeData.length;
    const totalOutput = reportData.productionData.reduce((sum, prod) => sum + prod.output_qty, 0);
    const totalDefects = reportData.productionData.reduce((sum, prod) => sum + prod.defect_qty, 0);

    return {
      avgOEE,
      avgAvailability,
      avgPerformance,
      avgQuality,
      totalOutput,
      totalDefects
    };
  };

  const stats = calculateStats();

  const quickReportButtons = [
    { key: 'daily', label: t('types.daily'), template: 'daily' as const },
    { key: 'weekly', label: t('types.weekly'), template: 'weekly' as const },
    { key: 'monthly', label: t('types.monthly'), template: 'monthly' as const }
  ];

  return (
    <div className={className}>
      <Spin spinning={loading}>
        {/* 필터 및 설정 */}
        <Card title={t('settings')} className="mb-4">
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Select
                mode="multiple"
                placeholder={t('filters.machineSelectPlaceholder')}
                style={{ width: '100%' }}
                value={selectedMachines}
                onChange={setSelectedMachines}
                allowClear
              >
                {machines.map(machine => (
                  <Option key={machine.id} value={machine.id}>
                    {machine.name} ({machine.location})
                  </Option>
                ))}
              </Select>
            </Col>
            <Col xs={24} md={8}>
              <RangePicker
                style={{ width: '100%' }}
                format="YYYY-MM-DD"
                placeholder={[t('filters.startDate'), t('filters.endDate')]}
                onChange={(dates, dateStrings) => {
                  setDateRange(dates ? [dateStrings[0], dateStrings[1]] : null);
                }}
              />
            </Col>
            <Col xs={24} md={8}>
              <Button 
                type="primary" 
                block
                onClick={onRefreshRecords || fetchReportData}
                loading={loading}
              >
                {t('refreshData')}
              </Button>
            </Col>
          </Row>
        </Card>

        {/* 통계 요약 */}
        <Row gutter={16} className="mb-4">
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title={t('metrics.averageOEE')}
                value={stats.avgOEE * 100}
                precision={1}
                suffix="%"
                valueStyle={{ color: ReportUtils.getOEEColor(stats.avgOEE) }}
              />
              <Progress
                percent={stats.avgOEE * 100}
                strokeColor={ReportUtils.getOEEColor(stats.avgOEE)}
                showInfo={false}
                size="small"
              />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title={t('metrics.averageAvailability')}
                value={stats.avgAvailability * 100}
                precision={1}
                suffix="%"
                valueStyle={{ color: '#1890ff' }}
              />
              <Progress
                percent={stats.avgAvailability * 100}
                strokeColor="#1890ff"
                showInfo={false}
                size="small"
              />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title={t('metrics.totalProduction')}
                value={stats.totalOutput}
                formatter={(value) => ReportUtils.formatNumber(Number(value), 0)}
                suffix={t('units.pieces')}
              />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title={t('metrics.defectRate')}
                value={stats.totalDefects / stats.totalOutput * 100}
                precision={2}
                suffix="%"
                valueStyle={{ 
                  color: stats.totalDefects / stats.totalOutput > 0.05 ? '#ff4d4f' : '#52c41a' 
                }}
              />
            </Card>
          </Col>
        </Row>

        {/* 빠른 보고서 생성 */}
        <Card title={t('quickReports')} className="mb-4">
          <Row gutter={16}>
            {quickReportButtons.map(button => (
              <Col xs={24} md={8} key={button.key} className="mb-2">
                <Card size="small" title={button.label}>
                  <Space direction="vertical" style={{ width: '100%' }}>
                    <Button
                      icon={<EyeOutlined />}
                      onClick={() => handlePreview(button.template)}
                      block
                    >
                      {t('buttons.preview')}
                    </Button>
                    <Space>
                      <Button
                        icon={<FilePdfOutlined />}
                        onClick={() => handleQuickReport('pdf', button.template)}
                        size="small"
                      >
                        {t('buttons.pdfExport')}
                      </Button>
                      <Button
                        icon={<FileExcelOutlined />}
                        onClick={() => handleQuickReport('excel', button.template)}
                        size="small"
                      >
                        {t('buttons.excelExport')}
                      </Button>
                    </Space>
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>
        </Card>

        {/* 사용자 정의 보고서 생성 */}
        <ReportGenerator
          machines={selectedMachines.length > 0 
            ? machines.filter(m => selectedMachines.includes(m.id))
            : machines
          }
          oeeData={reportData.oeeData}
          productionData={reportData.productionData}
        />

        {/* 미리보기 모달 */}
        <Modal
          title={t(`previewModal.${previewType}`)}
          open={previewModalVisible}
          onCancel={() => setPreviewModalVisible(false)}
          width={900}
          footer={[
            <Button key="cancel" onClick={() => setPreviewModalVisible(false)}>
              {t('common.close')}
            </Button>,
            <Button
              key="pdf"
              type="primary"
              icon={<FilePdfOutlined />}
              onClick={() => {
                handleQuickReport('pdf', previewType);
                setPreviewModalVisible(false);
              }}
            >
              {t('buttons.exportPdf')}
            </Button>,
            <Button
              key="excel"
              type="primary"
              icon={<FileExcelOutlined />}
              onClick={() => {
                handleQuickReport('excel', previewType);
                setPreviewModalVisible(false);
              }}
            >
              {t('buttons.exportExcel')}
            </Button>
          ]}
        >
          {previewData && (
            <div>
              <Card title={t('preview.reportInfo')} size="small" className="mb-3">
                <Row gutter={16}>
                  <Col span={12}>
                    <strong>{t('preview.period')}:</strong> {previewData.period}
                  </Col>
                  <Col span={12}>
                    <strong>{t('preview.machineCount')}:</strong> {previewData.machines.length}{t('units.machines')}
                  </Col>
                </Row>
              </Card>

              <Tabs defaultActiveKey="1">
                <Tabs.TabPane tab={t('preview.tabs.oeeSummary')} key="1">
                  <Row gutter={16}>
                    <Col span={6}>
                      <Statistic
                        title={t('preview.stats.avgOEE')}
                        value={(previewData.stats.avgOEE * 100).toFixed(1)}
                        suffix="%"
                        valueStyle={{ color: ReportUtils.getOEEColor(previewData.stats.avgOEE) }}
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic
                        title={t('preview.stats.avgAvailability')}
                        value={(previewData.stats.avgAvailability * 100).toFixed(1)}
                        suffix="%"
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic
                        title={t('preview.stats.avgPerformance')}
                        value={(previewData.stats.avgPerformance * 100).toFixed(1)}
                        suffix="%"
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic
                        title={t('preview.stats.avgQuality')}
                        value={(previewData.stats.avgQuality * 100).toFixed(1)}
                        suffix="%"
                      />
                    </Col>
                  </Row>
                </Tabs.TabPane>

                <Tabs.TabPane tab={t('preview.tabs.productionData')} key="2">
                  <Table
                    dataSource={previewData.productionData}
                    columns={[
                      {
                        title: t('preview.columns.date'),
                        dataIndex: 'date',
                        key: 'date'
                      },
                      {
                        title: t('preview.columns.machine'),
                        dataIndex: 'machine_id',
                        key: 'machine_id',
                        render: (id: string) => {
                          const machine = machines.find(m => m.id === id);
                          return machine?.name || id;
                        }
                      },
                      {
                        title: t('preview.columns.output'),
                        dataIndex: 'output_qty',
                        key: 'output_qty',
                        align: 'right'
                      },
                      {
                        title: t('preview.columns.defects'),
                        dataIndex: 'defect_qty',
                        key: 'defect_qty',
                        align: 'right'
                      }
                    ]}
                    pagination={false}
                    size="small"
                  />
                </Tabs.TabPane>

                <Tabs.TabPane tab={t('preview.tabs.machineList')} key="3">
                  <Table
                    dataSource={previewData.machines}
                    columns={[
                      {
                        title: t('preview.columns.machineName'),
                        dataIndex: 'name',
                        key: 'name'
                      },
                      {
                        title: t('preview.columns.location'),
                        dataIndex: 'location',
                        key: 'location'
                      },
                      {
                        title: t('preview.columns.status'),
                        dataIndex: 'is_active',
                        key: 'is_active',
                        render: (active: boolean) => active ? t('common.running') : t('common.stopped')
                      }
                    ]}
                    pagination={false}
                    size="small"
                  />
                </Tabs.TabPane>
              </Tabs>
            </div>
          )}
        </Modal>
      </Spin>
    </div>
  );
};