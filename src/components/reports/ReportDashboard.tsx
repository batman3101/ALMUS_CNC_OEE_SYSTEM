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
  message,
  Spin
} from 'antd';
import {
  FileExcelOutlined,
  FilePdfOutlined,
  BarChartOutlined,
  LineChartOutlined,
  PieChartOutlined
} from '@ant-design/icons';
import { ReportGenerator } from './ReportGenerator';
import { ReportTemplates } from './ReportTemplates';
import { OEEMetrics, Machine, ProductionRecord } from '@/types';
import { ReportUtils } from '@/utils/reportUtils';

const { RangePicker } = DatePicker;
const { Option } = Select;

interface ReportDashboardProps {
  machines?: Machine[];
  className?: string;
}

export const ReportDashboard: React.FC<ReportDashboardProps> = ({
  machines = [],
  className
}) => {
  const [loading, setLoading] = useState(false);
  const [selectedMachines, setSelectedMachines] = useState<string[]>([]);
  const [dateRange, setDateRange] = useState<[string, string] | null>(null);
  const [reportData, setReportData] = useState<{
    oeeData: OEEMetrics[];
    productionData: ProductionRecord[];
  }>({
    oeeData: [],
    productionData: []
  });

  // 모의 데이터 생성
  const generateMockData = () => {
    const oeeData: OEEMetrics[] = [];
    const productionData: ProductionRecord[] = [];

    for (let i = 0; i < 10; i++) {
      oeeData.push({
        availability: 0.8 + Math.random() * 0.15,
        performance: 0.85 + Math.random() * 0.1,
        quality: 0.9 + Math.random() * 0.08,
        oee: 0.65 + Math.random() * 0.2,
        actual_runtime: 400 + Math.random() * 200,
        planned_runtime: 600,
        ideal_runtime: 480,
        output_qty: 1000 + Math.floor(Math.random() * 400),
        defect_qty: Math.floor(Math.random() * 50)
      });

      const date = new Date();
      date.setDate(date.getDate() - i);
      
      productionData.push({
        record_id: `record_${i}`,
        machine_id: machines[0]?.id || 'machine_1',
        date: date.toISOString().split('T')[0],
        shift: Math.random() > 0.5 ? 'A' : 'B',
        output_qty: 1000 + Math.floor(Math.random() * 400),
        defect_qty: Math.floor(Math.random() * 50),
        created_at: new Date().toISOString()
      });
    }

    return { oeeData, productionData };
  };

  useEffect(() => {
    setReportData(generateMockData());
  }, [machines]);

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

  // 통계 계산
  const calculateStats = () => {
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
    { key: 'daily', label: '일일 보고서', template: 'daily' as const },
    { key: 'weekly', label: '주간 보고서', template: 'weekly' as const },
    { key: 'monthly', label: '월간 보고서', template: 'monthly' as const }
  ];

  return (
    <div className={className}>
      <Spin spinning={loading}>
        {/* 필터 및 설정 */}
        <Card title="보고서 설정" className="mb-4">
          <Row gutter={16}>
            <Col xs={24} md={8}>
              <Select
                mode="multiple"
                placeholder="설비 선택 (전체 선택 시 비워두세요)"
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
                placeholder={['시작일', '종료일']}
                onChange={(dates, dateStrings) => {
                  setDateRange(dates ? [dateStrings[0], dateStrings[1]] : null);
                }}
              />
            </Col>
            <Col xs={24} md={8}>
              <Button type="primary" block>
                데이터 새로고침
              </Button>
            </Col>
          </Row>
        </Card>

        {/* 통계 요약 */}
        <Row gutter={16} className="mb-4">
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title="평균 OEE"
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
                title="평균 가동률"
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
                title="총 생산량"
                value={stats.totalOutput}
                formatter={(value) => ReportUtils.formatNumber(Number(value), 0)}
                suffix="개"
              />
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card>
              <Statistic
                title="불량률"
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
        <Card title="빠른 보고서 생성" className="mb-4">
          <Row gutter={16}>
            {quickReportButtons.map(button => (
              <Col xs={24} md={8} key={button.key} className="mb-2">
                <Card size="small" title={button.label}>
                  <Space>
                    <Button
                      icon={<FilePdfOutlined />}
                      onClick={() => handleQuickReport('pdf', button.template)}
                      size="small"
                    >
                      PDF
                    </Button>
                    <Button
                      icon={<FileExcelOutlined />}
                      onClick={() => handleQuickReport('excel', button.template)}
                      size="small"
                    >
                      Excel
                    </Button>
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
      </Spin>
    </div>
  );
};