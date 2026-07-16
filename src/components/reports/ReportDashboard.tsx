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
  App,
  Alert
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
import { getReportTemplateRange } from '@/utils/reportRange';
import { calculateWeightedOEE } from '@/utils/weightedOee';

type ReportOEEMetrics = OEEMetrics & { record_id: string };

// OEE 미보고 행을 제외해도 생산실적 행과 다른 기록이 결합되지 않도록 record_id로 조인한다.
const filterReportData = (
  source: { oeeData: ReportOEEMetrics[]; productionData: ProductionRecord[] },
  machineIds: string[],
  range: [string, string] | null
): { oeeData: ReportOEEMetrics[]; productionData: ProductionRecord[] } => {
  const productionData: ProductionRecord[] = [];
  const oeeData: ReportOEEMetrics[] = [];
  const oeeByRecordId = new Map(source.oeeData.map(row => [row.record_id, row]));

  source.productionData.forEach(record => {
    const matchesMachine = machineIds.length === 0 || machineIds.includes(record.machine_id);
    const matchesDate = !range || (record.date >= range[0] && record.date <= range[1]);
    if (matchesMachine && matchesDate) {
      productionData.push(record);
      const matchingOee = oeeByRecordId.get(record.record_id);
      if (matchingOee) {
        oeeData.push(matchingOee);
      }
    }
  });

  return { oeeData, productionData };
};

const { RangePicker } = DatePicker;
const { Option } = Select;

interface PreviewStats {
  avgOEE: number | null;
  avgAvailability: number | null;
  avgPerformance: number | null;
  avgQuality: number | null;
  totalOutput: number;
  totalDefects: number;
  reportedRecords: number;
  totalRecords: number;
}

interface PreviewData {
  period: string;
  machines: Machine[];
  stats: PreviewStats;
  oeeData: OEEMetrics[];
  productionData: ProductionRecord[];
}

const calculateWeightedPreviewStats = (
  data: { oeeData: OEEMetrics[]; productionData: ProductionRecord[] }
): PreviewStats => {
  const reportedTotals = data.oeeData.reduce((sum, row) => ({
    planned: sum.planned + Math.max(0, row.planned_runtime || 0),
    actual: sum.actual + Math.max(0, row.actual_runtime || 0),
    ideal: sum.ideal + Math.max(0, row.ideal_runtime || 0),
    output: sum.output + Math.max(0, row.output_qty || 0),
    defects: sum.defects + Math.max(0, row.defect_qty || 0),
  }), { planned: 0, actual: 0, ideal: 0, output: 0, defects: 0 });
  const productionTotals = data.productionData.reduce((sum, row) => ({
    output: sum.output + Math.max(0, row.output_qty || 0),
    defects: sum.defects + Math.max(0, row.defect_qty || 0),
  }), { output: 0, defects: 0 });
  const weighted = calculateWeightedOEE({
    reportedRecords: data.oeeData.length,
    totalPlannedRuntime: reportedTotals.planned,
    totalActualRuntime: reportedTotals.actual,
    totalIdealRuntime: reportedTotals.ideal,
    totalOutput: reportedTotals.output,
    totalDefects: reportedTotals.defects,
  });

  return {
    avgOEE: weighted.oee,
    avgAvailability: weighted.availability,
    avgPerformance: weighted.performance,
    avgQuality: weighted.quality,
    totalOutput: productionTotals.output,
    totalDefects: productionTotals.defects,
    reportedRecords: data.oeeData.length,
    totalRecords: data.productionData.length,
  };
};

interface ReportDashboardProps {
  machines?: Machine[];
  className?: string;
  loading?: boolean;
  productionRecords?: ProductionRecord[];
  aggregatedData?: {
    totalProduction: number;
    totalDefects: number;
    totalGoodQuantity: number;
    avgOEE: number | null;
    avgAvailability: number | null;
    avgPerformance: number | null;
    avgQuality: number | null;
    recordCount: number;
    reportedCount: number;
    unreportedCount: number;
  };
  onRefreshRecords?: () => void;
  /** 보고서 기간 필터 (상위에서 소유 — 조회 기간과 동일) */
  dateRange?: [string, string] | null;
  onDateRangeChange?: (range: [string, string] | null) => void;
  loadedDateRange: [string, string];
  isDataComplete?: boolean;
  dataError?: string | null;
  selectedMachines?: string[];
  onSelectedMachinesChange?: (machineIds: string[]) => void;
}

export const ReportDashboard: React.FC<ReportDashboardProps> = ({
  machines = [],
  className,
  loading: recordsLoading = false,
  productionRecords = [],
  aggregatedData,
  onRefreshRecords,
  dateRange = null,
  onDateRangeChange,
  loadedDateRange,
  isDataComplete = true,
  dataError = null,
  selectedMachines = [],
  onSelectedMachinesChange,
}) => {
  const { t } = useReportsTranslation();
  const { message } = App.useApp();
  const [loading, setLoading] = useState(false);
  const [previewModalVisible, setPreviewModalVisible] = useState(false);
  const [previewData, setPreviewData] = useState<PreviewData | null>(null);
  const [previewType, setPreviewType] = useState<'daily' | 'weekly' | 'monthly'>('daily');

  const assertRangeAvailable = (range: [string, string]) => {
    if (range[0] < loadedDateRange[0] || range[1] > loadedDateRange[1]) {
      throw new Error('선택한 보고서 기간이 현재 조회된 기간을 벗어났습니다. 먼저 기간 필터로 데이터를 조회하세요.');
    }
    if (!isDataComplete) {
      throw new Error('전체 데이터가 로드되지 않아 보고서를 만들 수 없습니다. 기간 또는 설비 범위를 줄여주세요.');
    }
    if (dataError) throw new Error(dataError);
  };

  // 보고서 데이터의 단일 소스: 상위에서 내려준 실시간 생산 기록
  // (이전에는 /api/production-records를 중복 호출했으나 제거함)
  const reportData = useMemo<{ oeeData: ReportOEEMetrics[]; productionData: ProductionRecord[] }>(() => {
    // OEE 데이터 계산 (설비별 집계를 위해 machine_id를 함께 보관)
    const oeeData: ReportOEEMetrics[] = productionRecords.filter(record =>
      record.planned_runtime != null &&
      record.actual_runtime != null &&
      record.ideal_runtime != null &&
      record.availability != null &&
      record.performance != null &&
      record.quality != null &&
      record.oee != null
    ).map(record => ({
      record_id: record.record_id,
      machine_id: record.machine_id,
      availability: record.availability as number,
      performance: record.performance as number,
      quality: record.quality as number,
      oee: record.oee as number,
      actual_runtime: record.actual_runtime as number,
      planned_runtime: record.planned_runtime as number,
      ideal_runtime: record.ideal_runtime as number,
      output_qty: record.output_qty || 0,
      defect_qty: record.defect_qty || 0
    }));

    return { oeeData, productionData: productionRecords };
  }, [productionRecords]);

  // 보고서 미리보기
  const handlePreview = async (template: 'daily' | 'weekly' | 'monthly') => {
    setLoading(true);
    try {
      // 현지 달력 날짜 기준, 양끝 포함. (UTC 변환으로 인한 하루 밀림과
      // "일간=2일 / 주간=8일" 오프바이원을 제거한다 — utils/reportRange.ts 참고)
      const templateRange = getReportTemplateRange(template);
      assertRangeAvailable(templateRange);

      // 미리보기 데이터 준비 (템플릿 기간 + 선택된 설비로 실제 데이터 필터링)
      const filtered = filterReportData(reportData, selectedMachines, templateRange);
      const previewContent = {
        period: `${templateRange[0]} ~ ${templateRange[1]}`,
        machines: selectedMachines.length > 0
          ? machines.filter(m => selectedMachines.includes(m.id))
          : machines,
        // 통계는 표/내보내기와 동일한 범위(필터된 데이터)에서 계산한다
        stats: calculateStats(filtered, templateRange),
        oeeData: filtered.oeeData,
        productionData: filtered.productionData
      };

      setPreviewData(previewContent);
      setPreviewType(template);
      setPreviewModalVisible(true);
    } catch (error) {
      console.error('미리보기 생성 실패:', error);
      message.error(error instanceof Error ? error.message : '미리보기 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 빠른 보고서 생성
  const handleQuickReport = async (type: 'pdf' | 'excel', template: 'daily' | 'weekly' | 'monthly') => {
    setLoading(true);
    try {
      // 미리보기와 정확히 같은 범위를 쓴다 (미리보기와 내보내기가 다른 기간을 담지 않도록)
      const templateRange = getReportTemplateRange(template);
      assertRangeAvailable(templateRange);
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
        groupBy: 'machine' as const
      };

      // jsPDF/xlsx/html2canvas는 실제로 보고서를 생성하는 시점에만 필요하므로
      // 초기 번들에 포함되지 않도록 클릭 시점에 동적으로 로드한다.
      const { ReportTemplates } = await import('./ReportTemplates');
      await ReportTemplates.generateTemplateReport(template, reportConfig, type);
      message.success(`${template} ${type.toUpperCase()} 보고서가 생성되었습니다.`);
    } catch (error) {
      console.error('보고서 생성 실패:', error);
      message.error(error instanceof Error ? error.message : '보고서 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  // 서버 집계(aggregatedData)는 "전체 설비 × 페이지 조회 기간" 기준으로만 계산된 값이다.
  // 설비를 고르거나 다른 기간(빠른 보고서 템플릿)을 보는 순간 범위가 어긋나므로 그대로 쓰면 안 된다.
  const matchesAggregatedScope = (range: [string, string] | null): boolean => {
    if (range === null && dateRange === null) return true;
    if (range === null || dateRange === null) return false;
    return range[0] === dateRange[0] && range[1] === dateRange[1];
  };

  // 통계 계산 - 요약 카드/미리보기/내보내기가 항상 같은 범위를 말하도록 대상 데이터를 인자로 받는다.
  const calculateStats = (
    data: { oeeData: OEEMetrics[]; productionData: ProductionRecord[] },
    range: [string, string] | null
  ): PreviewStats => {
    // 범위가 서버 집계와 정확히 일치할 때만 집계 데이터를 사용한다 (%를 소수로 변환)
    if (aggregatedData && matchesAggregatedScope(range)) {
      return {
        avgOEE: aggregatedData.avgOEE === null ? null : aggregatedData.avgOEE / 100, // 훅에서는 %로, 여기서는 소수로 변환
        avgAvailability: aggregatedData.avgAvailability === null ? null : aggregatedData.avgAvailability / 100,
        avgPerformance: aggregatedData.avgPerformance === null ? null : aggregatedData.avgPerformance / 100,
        avgQuality: aggregatedData.avgQuality === null ? null : aggregatedData.avgQuality / 100,
        totalOutput: aggregatedData.totalProduction,
        totalDefects: aggregatedData.totalDefects,
        reportedRecords: aggregatedData.reportedCount,
        totalRecords: aggregatedData.recordCount,
      };
    }

    // 그 외에는 필터된 행에서 직접 계산한다 (행의 oee/availability 등은 0..1 비율)
    return calculateWeightedPreviewStats(data);
  };

  // 사용자 정의 보고서(ReportGenerator)에 전달할 데이터: 선택된 설비 + 선택된 기간으로 필터링
  const filteredReportData = filterReportData(reportData, selectedMachines, dateRange);
  // 상단 통계 카드도 아래 표/보고서와 동일한 범위(선택된 설비 + 선택된 기간)를 요약한다
  const stats = calculateStats(filteredReportData, dateRange);
  // 상단 통계 카드의 불량률: 생산량이 0이면 NaN이 아닌 0을 표시
  const defectRate = stats.totalOutput > 0 ? (stats.totalDefects / stats.totalOutput) * 100 : 0;

  const quickReportButtons = [
    { key: 'daily', label: t('types.daily'), template: 'daily' as const },
    { key: 'weekly', label: t('types.weekly'), template: 'weekly' as const },
    { key: 'monthly', label: t('types.monthly'), template: 'monthly' as const }
  ];

  return (
    <div className={className}>
      <Spin spinning={loading || recordsLoading}>
        {(dataError || !isDataComplete) && (
          <Alert
            type="error"
            showIcon
            className="mb-4"
            message={dataError || '보고서 원본 데이터가 안전 조회 한도를 초과했습니다.'}
            description="부분 데이터로 보고서를 생성하지 않습니다. 기간 또는 설비 범위를 줄인 뒤 다시 조회하세요."
          />
        )}
        {/* 필터 및 설정 */}
        <Card title={t('settings')} className="mb-4">
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Select
                placeholder={t('filters.machineSelectPlaceholder')}
                style={{ width: '100%' }}
                value={selectedMachines[0]}
                onChange={(machineId?: string) => onSelectedMachinesChange?.(machineId ? [machineId] : [])}
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

        {stats.totalRecords > stats.reportedRecords && (
          <Alert
            type="warning"
            showIcon
            className="mb-4"
            message={t('coverage.title', {
              reported: stats.reportedRecords,
              total: stats.totalRecords,
            })}
            description={t('coverage.description')}
          />
        )}

        {/* 통계 요약 */}
        {isDataComplete && !dataError && <Row gutter={16} className="mb-4">
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title={t('metrics.averageOEE')}
                value={stats.avgOEE === null ? '—' : stats.avgOEE * 100}
                precision={1}
                suffix={stats.avgOEE === null ? undefined : '%'}
                valueStyle={{ color: stats.avgOEE === null ? '#8c8c8c' : ReportUtils.getOEEColor(stats.avgOEE) }}
              />
              {stats.avgOEE !== null && (
                <Progress
                  percent={stats.avgOEE * 100}
                  strokeColor={ReportUtils.getOEEColor(stats.avgOEE)}
                  showInfo={false}
                  size="small"
                />
              )}
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title={t('metrics.averageAvailability')}
                value={stats.avgAvailability === null ? '—' : stats.avgAvailability * 100}
                precision={1}
                suffix={stats.avgAvailability === null ? undefined : '%'}
                valueStyle={{ color: stats.avgAvailability === null ? '#8c8c8c' : '#1890ff' }}
              />
              {stats.avgAvailability !== null && (
                <Progress
                  percent={stats.avgAvailability * 100}
                  strokeColor="#1890ff"
                  showInfo={false}
                  size="small"
                />
              )}
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
        </Row>}

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
          loadedDateRange={loadedDateRange}
          isDataComplete={isDataComplete && !dataError}
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
                    {/* 단위 접미사를 코드에서 붙이면 공백/어순을 로케일이 제어할 수 없다 ('800대' vs '800 máy') */}
                    <strong>{t('preview.machineCount')}:</strong> {t('preview.machineCountValue', { count: previewData.machines.length })}
                  </Col>
                </Row>
              </Card>

              <Tabs defaultActiveKey="1">
                <Tabs.TabPane tab={t('preview.tabs.oeeSummary')} key="1">
                  <Row gutter={16}>
                    <Col span={6}>
                      <Statistic
                        title={t('preview.stats.avgOEE')}
                        value={previewData.stats.avgOEE === null
                          ? '—'
                          : (previewData.stats.avgOEE * 100).toFixed(1)}
                        suffix={previewData.stats.avgOEE === null ? undefined : '%'}
                        valueStyle={{
                          color: previewData.stats.avgOEE === null
                            ? '#8c8c8c'
                            : ReportUtils.getOEEColor(previewData.stats.avgOEE)
                        }}
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic
                        title={t('preview.stats.avgAvailability')}
                        value={previewData.stats.avgAvailability === null
                          ? '—'
                          : (previewData.stats.avgAvailability * 100).toFixed(1)}
                        suffix={previewData.stats.avgAvailability === null ? undefined : '%'}
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic
                        title={t('preview.stats.avgPerformance')}
                        value={previewData.stats.avgPerformance === null
                          ? '—'
                          : (previewData.stats.avgPerformance * 100).toFixed(1)}
                        suffix={previewData.stats.avgPerformance === null ? undefined : '%'}
                      />
                    </Col>
                    <Col span={6}>
                      <Statistic
                        title={t('preview.stats.avgQuality')}
                        value={previewData.stats.avgQuality === null
                          ? '—'
                          : (previewData.stats.avgQuality * 100).toFixed(1)}
                        suffix={previewData.stats.avgQuality === null ? undefined : '%'}
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
                    pagination={{ pageSize: 100, showSizeChanger: true }}
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
