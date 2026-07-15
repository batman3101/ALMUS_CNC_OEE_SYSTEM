'use client';

import React, { useState } from 'react';
import {
  Modal,
  Form,
  Select,
  DatePicker,
  Checkbox,
  Button,
  Space,
  Divider,
  Card,
  Row,
  Col,
  message
} from 'antd';
import { FileExcelOutlined, FilePdfOutlined } from '@ant-design/icons';
import { ReportTemplates, assertReportExportReady } from './ReportTemplates';
import { Machine, ProductionRecord } from '@/types';
import { OEEMetrics } from '@/types/reports';

const { RangePicker } = DatePicker;
const { Option } = Select;

// 설비/기간 선택으로 실제 보고서 데이터(OEE + 생산실적)를 필터링
// oeeData와 productionData는 항상 동일 인덱스로 1:1 매핑되어 전달되므로
// 생산실적을 기준으로 필터링하고 동일 인덱스의 OEE 항목을 함께 선택한다.
const filterByMachineAndDate = (
  productionData: ProductionRecord[],
  oeeData: OEEMetrics[],
  machineIds: string[],
  range: [string, string]
): { productionData: ProductionRecord[]; oeeData: OEEMetrics[] } => {
  const filteredProductionData: ProductionRecord[] = [];
  const filteredOeeData: OEEMetrics[] = [];

  productionData.forEach((record, index) => {
    const matchesMachine = machineIds.length === 0 || machineIds.includes(record.machine_id);
    const matchesDate = record.date >= range[0] && record.date <= range[1];
    if (matchesMachine && matchesDate) {
      filteredProductionData.push(record);
      if (oeeData[index]) {
        filteredOeeData.push(oeeData[index]);
      }
    }
  });

  return { productionData: filteredProductionData, oeeData: filteredOeeData };
};

interface ReportExportModalProps {
  visible: boolean;
  onCancel: () => void;
  exportType: 'pdf' | 'excel';
  machines?: Machine[];
  oeeData?: OEEMetrics[];
  productionData?: ProductionRecord[];
  loadedDateRange: [string, string];
  isDataComplete?: boolean;
}

interface ReportConfig {
  reportType: 'summary' | 'detailed' | 'trend' | 'downtime';
  dateRange: [string, string];
  selectedMachines: string[];
  includeCharts: boolean;
  includeOEE: boolean;
  includeProduction: boolean;
  groupBy: 'machine' | 'date' | 'shift';
}

export const ReportExportModal: React.FC<ReportExportModalProps> = ({
  visible,
  onCancel,
  exportType,
  machines = [],
  oeeData = [],
  productionData = [],
  loadedDateRange,
  isDataComplete = true
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const reportConfig: ReportConfig = {
        reportType: values.reportType,
        dateRange: values.dateRange.map((date: { format: (str: string) => string }) => date.format('YYYY-MM-DD')) as [string, string],
        selectedMachines: values.selectedMachines || machines.map(m => m.id),
        includeCharts: values.includeCharts ?? true,
        includeOEE: values.includeOEE ?? true,
        includeProduction: values.includeProduction ?? true,
        groupBy: values.groupBy || 'machine'
      };

      assertReportExportReady({
        loadedRange: loadedDateRange,
        requestedRange: reportConfig.dateRange,
        isComplete: isDataComplete,
      });

      const { productionData: filteredProductionData, oeeData: filteredOeeData } = filterByMachineAndDate(
        productionData,
        oeeData,
        reportConfig.selectedMachines,
        reportConfig.dateRange
      );

      const reportData = {
        machines: machines.filter(m => reportConfig.selectedMachines.includes(m.id)),
        oeeData: filteredOeeData,
        productionData: filteredProductionData,
        ...reportConfig
      };

      // 차트 요소들 수집 - 다양한 selector 시도
      const chartElements: { [key: string]: HTMLCanvasElement | HTMLElement } = {};
      
      // 가능한 차트 selector들
      const chartSelectors = [
        '[data-chart="oee-gauge"] canvas',
        '[data-testid="oee-gauge"] canvas',
        '.oee-gauge canvas',
        'canvas[aria-label*="OEE"]',
        'canvas[aria-label*="게이지"]',
        '.chart-container canvas',
        '[class*="gauge"] canvas'
      ];

      const trendSelectors = [
        '[data-chart="trend-chart"] canvas',
        '[data-testid="trend-chart"] canvas',
        '.trend-chart canvas',
        'canvas[aria-label*="추이"]',
        'canvas[aria-label*="trend"]',
        '[class*="line-chart"] canvas'
      ];

      // OEE 게이지 차트 찾기
      if (reportConfig.includeCharts && reportConfig.includeOEE) {
        for (const selector of chartSelectors) {
          const element = document.querySelector(selector) as HTMLCanvasElement;
          if (element) {
            chartElements['oee-gauge'] = element;
            break;
          }
        }
      }

      // 추이 차트 찾기
      if (reportConfig.includeCharts) {
        for (const selector of trendSelectors) {
          const element = document.querySelector(selector) as HTMLCanvasElement;
          if (element) {
            chartElements['trend-chart'] = element;
            break;
          }
        }
      }

      // 모든 canvas 요소에서 차트 찾기 (마지막 시도)
      if (Object.keys(chartElements).length === 0 && reportConfig.includeCharts) {
        const allCanvas = document.querySelectorAll('canvas');
        allCanvas.forEach((canvas, index) => {
          if (canvas.width > 100 && canvas.height > 100) {
            chartElements[`chart-${index}`] = canvas;
          }
        });
      }

      console.log(`Found ${Object.keys(chartElements).length} chart elements for report`);

      // 차트가 있으면 고급 보고서, 없으면 기본 보고서 생성
      if (exportType === 'pdf') {
        if (Object.keys(chartElements).length > 0) {
          await ReportTemplates.generateAdvancedReport(reportData, exportType, chartElements);
        } else {
          await ReportTemplates.generatePDFReport(reportData);
        }
      } else {
        await ReportTemplates.generateExcelReport(reportData);
      }

      message.success(`${exportType.toUpperCase()} 보고서가 성공적으로 생성되었습니다.`);
      onCancel();
    } catch (error) {
      console.error('보고서 생성 실패:', error);
      message.error(error instanceof Error ? error.message : '보고서 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const reportTypeOptions = [
    { label: '요약 보고서', value: 'summary' },
    { label: '상세 보고서', value: 'detailed' },
    { label: '추이 분석', value: 'trend' }
  ];

  const groupByOptions = [
    { label: '설비별', value: 'machine' },
    { label: '날짜별', value: 'date' },
    { label: '교대별', value: 'shift' }
  ];

  return (
    <Modal
      title={
        <Space>
          {exportType === 'pdf' ? <FilePdfOutlined /> : <FileExcelOutlined />}
          {exportType.toUpperCase()} 보고서 생성
        </Space>
      }
      open={visible}
      onCancel={onCancel}
      width={600}
      footer={[
        <Button key="cancel" onClick={onCancel}>
          취소
        </Button>,
        <Button
          key="export"
          type="primary"
          loading={loading}
          onClick={handleExport}
          icon={exportType === 'pdf' ? <FilePdfOutlined /> : <FileExcelOutlined />}
        >
          {exportType.toUpperCase()} 생성
        </Button>
      ]}
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          reportType: 'summary',
          includeCharts: true,
          includeOEE: true,
          includeProduction: true,
          groupBy: 'machine'
        }}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item
              name="reportType"
              label="보고서 유형"
              rules={[{ required: true, message: '보고서 유형을 선택해주세요' }]}
            >
              <Select options={reportTypeOptions} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item
              name="groupBy"
              label="그룹화 기준"
              rules={[{ required: true, message: '그룹화 기준을 선택해주세요' }]}
            >
              <Select options={groupByOptions} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item
          name="dateRange"
          label="기간 선택"
          rules={[{ required: true, message: '기간을 선택해주세요' }]}
        >
          <RangePicker
            style={{ width: '100%' }}
            format="YYYY-MM-DD"
            placeholder={['시작일', '종료일']}
          />
        </Form.Item>

        <Form.Item
          name="selectedMachines"
          label="설비 선택"
        >
          <Select
            mode="multiple"
            placeholder="설비를 선택하세요 (전체 선택 시 비워두세요)"
            allowClear
          >
            {machines.map(machine => (
              <Option key={machine.id} value={machine.id}>
                {machine.name} ({machine.location})
              </Option>
            ))}
          </Select>
        </Form.Item>

        <Divider>포함할 내용</Divider>

        <Card size="small">
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="includeOEE" valuePropName="checked">
                <Checkbox>OEE 지표</Checkbox>
              </Form.Item>
              <Form.Item name="includeProduction" valuePropName="checked">
                <Checkbox>생산 실적</Checkbox>
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="includeCharts" valuePropName="checked">
                <Checkbox>차트 포함</Checkbox>
              </Form.Item>
            </Col>
          </Row>
        </Card>
      </Form>
    </Modal>
  );
};
