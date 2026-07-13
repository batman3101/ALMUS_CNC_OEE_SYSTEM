'use client';

import React, { useState, useMemo } from 'react';
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
  EyeOutlined,
} from '@ant-design/icons';
import { ReportGenerator } from './ReportGenerator';
import { useReportsTranslation } from '@/hooks/useTranslation';
import { Machine, ProductionRecord } from '@/types';
import { OEEMetrics } from '@/types/reports';
import { ReportUtils } from '@/utils/reportUtils';

// 설비/기간 필터를 실제 보고서 데이터(OEE + 생산실적)에 적용
// oeeData와 productionData는 항상 동일 인덱스로 1:1 매핑되어 생성되므로
// 생산실적을 기준으로 필터링하고 동일 인덱스의 OEE 항목을 함께 선택한다.
const filterReportData = (
  source: { oeeData: OEEMetrics[]; productionData: ProductionRecord[] },
  machineIds: string[],
  range: [string, string] | null
): { oeeData: OEEMetrics[]; productionData: ProductionRecord[] } => {
  const productionData: ProductionRecord[] = [];
  const oeeData: OEEMetrics[] = [];

  source.productionData.forEach((record, index) => {
    const matchesMachine = machineIds.length === 0 || machineIds.includes(record.machine_id);
    const matchesDate = !range || (record.date >= range[0] && record.date <= range[1]);
    if (matchesMachine && matchesDate) {
      productionData.push(record);
      if (source.oeeData[index]) {
        oeeData.push(source.oeeData[index]);
      }
    }
  });

  return { oeeData, productionData };
};

const { RangePicker } = DatePicker;
const { Option } = Select;

interface PreviewStats {
  avgOEE: number;
  avgAvailability: number;
  avgPerformance: number;
  avgQuality: number;
  totalOutput: number;
  totalDefects: number;
}

interface PreviewData {
  period: string;
  machines: Machine[];
  stats: PreviewStats;
  oeeData: OEEMetrics[];
  productionData: ProductionRecord[];
}

interface ReportDashboardProps {
  machines?: Machine[];
  className?: string;
  loading?: boolean;
  productionRecords?: ProductionRecord[];
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
  /** 보고서 기간 필터 (상위에서 소유 — 조회 기간과 동일) */
  dateRange?: [string, string] | null;
  onDateRangeChange?: (range: [string, string] | null) => void;
}

export const ReportDashboard: React.FC<ReportDashboardProps> = ({
  machines = [],
  className,
  loading: recordsLoading = false,
  productionRecords = [],
  aggregatedData,
  onRefreshRecords,
  dateRange = null,
  onDateRangeChange
}) => {
  const { t } = useReportsTranslation();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewType, setPreviewType] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [selectedMachines, setSelectedMachines] = useState<string[]>([]);

  // 보고서 데이터의 단일 소스: 상위에서 내려준 실시간 생산 기록
  // (이전에는 /api/production-records를 중복 호출했으나 제거함)
  const reportData = useMemo<{ oeeData: OEEMetrics[]; productionData: ProductionRecord[] }>(() => {
    // OEE 데이터 계산 (설비별 집계를 위해 machine_id를 함께 보관)
    const oeeData: OEEMetrics[] = productionRecords.map(record => ({
      machine_id: record.machine_id,
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

    return { oeeData, productionData: productionRecords };
  }, [productionRecords]);

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

      // 미리보기 데이터 준비 (템플릿 기간 + 선택된 설비로 실제 데이터 필터링)
      const templateRange: [string, string] = [startDate.toISOString().split('T')[0], endDate];
      const filtered = filterReportData(reportData, selectedMachines, templateRange);
      const previewContent = {
        period: `${templateRange[0]} ~ ${templateRange[1]}`,
        machines: selectedMachines.length > 0
          ? machines.filter(m => selectedMachines.includes(m.id))
          : machines,
        stats: calculateStats(),
        oeeData: filtered.oeeData,
        productionData: filtered.productionData
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

      const templateRange: [string, string] = [startDate.toISOString().split('T')[0], endDate];
      const filtered = filterReportData(reportData, selectedMachines, templateRange);

      const reportConfig = {
        machines: selectedMachines.length > 0
          ? machines.filter(m => selectedMachines.includes(m.id))
          : machines,
        oeeData: filtered.oeeData,
        productionData: filtered.productionData,
        reportType: 'summary' as const,
        dateRange: templateRange,
        selectedMachines: selectedMachines.length > 0 ? selectedMachines : machines.map(m => m.id),
        includeCharts: true,
        includeOEE: true,
        includeProduction: true,
        includeDowntime: true,
        groupBy: 'machine' as const
      };

      // jsPDF/xlsx/html2canvas는 실제로 보고서를 생성하는 시점에만 필요하므로
      // 초기 번들에 포함되지 않도록 클릭 시점에 동적으로 로드한다.
      const { ReportTemplates } = await import('./ReportTemplates');
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
  // 상단 통계 카드의 불량률: 생산량이 0이면 NaN이 아닌 0을 표시
  const defectRate = stats.totalOutput > 0 ? (stats.totalDefects / stats.totalOutput) * 100 : 0;
  // 사용자 정의 보고서(ReportGenerator)에 전달할 데이터: 선택된 설비 + 선택된 기간으로 필터링
  const filteredReportData = filterReportData(reportData, selectedMachines, dateRange);

  const quickReportButtons = [
    { key: 'daily', label: t('types.daily'), template: 'daily' as const },
    { key: 'weekly', label: t('types.weekly'), template: 'weekly' as const },
    { key: 'monthly', label: t('types.monthly'), template: 'monthly' as const }
  ];

  return (
    <div className={className}>
      <Spin spinning={loading || recordsLoading}>
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
                  // 선택한 기간은 상위로 올려 서버 조회 기간과 클라이언트 필터에 동시에 반영한다
                  onDateRangeChange?.(dates ? [dateStrings[0], dateStrings[1]] : null);
                }}
              />
            </Col>
            <Col xs={24} md={8}>
              <Button
                type="primary"
                block
                onClick={onRefreshRecords}
                loading={loading || recordsLoading}
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
                value={defectRate}
                precision={2}
                suffix="%"
                valueStyle={{
                  color: defectRate > 5 ? '#ff4d4f' : '#52c41a'
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
          oeeData={filteredReportData.oeeData}
          productionData={filteredReportData.productionData}
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