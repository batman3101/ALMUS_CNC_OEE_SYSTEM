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
import { ReportTemplates } from './ReportTemplates';
import { OEEMetrics, Machine, ProductionRecord } from '@/types';

const { RangePicker } = DatePicker;
const { Option } = Select;

interface ReportExportModalProps {
  visible: boolean;
  onCancel: () => void;
  exportType: 'pdf' | 'excel';
  machines?: Machine[];
  oeeData?: OEEMetrics[];
  productionData?: ProductionRecord[];
}

interface ReportConfig {
  reportType: 'summary' | 'detailed' | 'trend' | 'downtime';
  dateRange: [string, string];
  selectedMachines: string[];
  includeCharts: boolean;
  includeOEE: boolean;
  includeProduction: boolean;
  includeDowntime: boolean;
  groupBy: 'machine' | 'date' | 'shift';
}

export const ReportExportModal: React.FC<ReportExportModalProps> = ({
  visible,
  onCancel,
  exportType,
  machines = [],
  oeeData = [],
  productionData = []
}) => {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);

  const handleExport = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);

      const reportConfig: ReportConfig = {
        reportType: values.reportType,
        dateRange: values.dateRange.map((date: any) => date.format('YYYY-MM-DD')) as [string, string],
        selectedMachines: values.selectedMachines || machines.map(m => m.id),
        includeCharts: values.includeCharts ?? true,
        includeOEE: values.includeOEE ?? true,
        includeProduction: values.includeProduction ?? true,
        includeDowntime: values.includeDowntime ?? true,
        groupBy: values.groupBy || 'machine'
      };

      const reportData = {
        machines: machines.filter(m => reportConfig.selectedMachines.includes(m.id)),
        oeeData,
        productionData,
        ...reportConfig
      };

      // 차트 요소들 수집 (실제 구현에서는 ref를 통해 접근)
      const chartElements: { [key: string]: HTMLCanvasElement | HTMLElement } = {};
      
      // OEE 게이지 차트
      const oeeGaugeElement = document.querySelector('[data-chart="oee-gauge"] canvas') as HTMLCanvasElement;
      if (oeeGaugeElement && reportConfig.includeCharts && reportConfig.includeOEE) {
        chartElements['oee-gauge'] = oeeGaugeElement;
      }

      // 추이 차트
      const trendChartElement = document.querySelector('[data-chart="trend-chart"] canvas') as HTMLCanvasElement;
      if (trendChartElement && reportConfig.includeCharts) {
        chartElements['trend-chart'] = trendChartElement;
      }

      // 다운타임 차트
      const downtimeChartElement = document.querySelector('[data-chart="downtime-chart"] canvas') as HTMLCanvasElement;
      if (downtimeChartElement && reportConfig.includeCharts && reportConfig.includeDowntime) {
        chartElements['downtime-chart'] = downtimeChartElement;
      }

      if (Object.keys(chartElements).length > 0) {
        await ReportTemplates.generateAdvancedReport(reportData, exportType, chartElements);
      } else {
        if (exportType === 'pdf') {
          await ReportTemplates.generatePDFReport(reportData);
        } else {
          await ReportTemplates.generateExcelReport(reportData);
        }
      }

      message.success(`${exportType.toUpperCase()} 보고서가 성공적으로 생성되었습니다.`);
      onCancel();
    } catch (error) {
      console.error('보고서 생성 실패:', error);
      message.error('보고서 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  const reportTypeOptions = [
    { label: '요약 보고서', value: 'summary' },
    { label: '상세 보고서', value: 'detailed' },
    { label: '추이 분석', value: 'trend' },
    { label: '다운타임 분석', value: 'downtime' }
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
          includeDowntime: true,
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
              <Form.Item name="includeDowntime" valuePropName="checked">
                <Checkbox>다운타임 분석</Checkbox>
              </Form.Item>
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