'use client';

import React, { useState, useEffect } from 'react';
import { Card, Descriptions, Tag, Statistic, Row, Col, Button, Space } from 'antd';
import { FileTextOutlined, BarChartOutlined, PrinterOutlined } from '@ant-design/icons';
import { ReportTemplates } from './ReportTemplates';
import { OEEMetrics, Machine, ProductionRecord } from '@/types';

interface ReportPreviewProps {
  reportData: {
    machines: Machine[];
    oeeData: OEEMetrics[];
    productionData: ProductionRecord[];
    reportType: 'summary' | 'detailed' | 'trend' | 'downtime';
    dateRange: [string, string];
    selectedMachines: string[];
    includeCharts: boolean;
    includeOEE: boolean;
    includeProduction: boolean;
    includeDowntime: boolean;
    groupBy: 'machine' | 'date' | 'shift';
  };
  onGenerate?: (format: 'pdf' | 'excel') => void;
}

export const ReportPreview: React.FC<ReportPreviewProps> = ({
  reportData,
  onGenerate
}) => {
  const [previewData, setPreviewData] = useState<any>(null);

  useEffect(() => {
    const preview = ReportTemplates.generatePreviewData(reportData);
    setPreviewData(preview);
  }, [reportData]);

  if (!previewData) {
    return <Card loading />;
  }

  const reportTypeLabels = {
    summary: '요약 보고서',
    detailed: '상세 보고서',
    trend: '추이 분석',
    downtime: '다운타임 분석'
  };

  const groupByLabels = {
    machine: '설비별',
    date: '날짜별',
    shift: '교대별'
  };

  return (
    <Card title="보고서 미리보기" extra={
      <Space>
        <Button 
          type="primary" 
          icon={<PrinterOutlined />}
          onClick={() => onGenerate?.('pdf')}
        >
          PDF 생성
        </Button>
        <Button 
          icon={<FileTextOutlined />}
          onClick={() => onGenerate?.('excel')}
        >
          Excel 생성
        </Button>
      </Space>
    }>
      <Row gutter={[16, 16]}>
        {/* 보고서 기본 정보 */}
        <Col span={24}>
          <Descriptions title="보고서 정보" variant="outlined" size="small">
            <Descriptions.Item label="보고서 유형">
              <Tag color="blue">{reportTypeLabels[reportData.reportType]}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label="기간">
              {reportData.dateRange[0]} ~ {reportData.dateRange[1]}
            </Descriptions.Item>
            <Descriptions.Item label="그룹화">
              {groupByLabels[reportData.groupBy]}
            </Descriptions.Item>
            <Descriptions.Item label="대상 설비">
              {reportData.selectedMachines.length > 0 
                ? `${reportData.selectedMachines.length}대 선택`
                : `전체 ${reportData.machines.length}대`
              }
            </Descriptions.Item>
            <Descriptions.Item label="예상 페이지">
              약 {previewData.pageCount}페이지
            </Descriptions.Item>
            <Descriptions.Item label="포함 차트">
              {previewData.chartCount}개
            </Descriptions.Item>
          </Descriptions>
        </Col>

        {/* 데이터 통계 */}
        <Col span={24}>
          <Card title="데이터 통계" size="small">
            <Row gutter={16}>
              <Col span={6}>
                <Statistic
                  title="설비 수"
                  value={reportData.machines.length}
                  suffix="대"
                  prefix={<BarChartOutlined />}
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="OEE 데이터"
                  value={reportData.oeeData.length}
                  suffix="건"
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="생산 실적"
                  value={reportData.productionData.length}
                  suffix="건"
                />
              </Col>
              <Col span={6}>
                <Statistic
                  title="차트 수"
                  value={previewData.chartCount}
                  suffix="개"
                />
              </Col>
            </Row>
          </Card>
        </Col>

        {/* 포함 내용 */}
        <Col span={24}>
          <Card title="포함 내용" size="small">
            <Space wrap>
              {reportData.includeOEE && <Tag color="green">OEE 지표</Tag>}
              {reportData.includeProduction && <Tag color="blue">생산 실적</Tag>}
              {reportData.includeDowntime && <Tag color="orange">다운타임 분석</Tag>}
              {reportData.includeCharts && <Tag color="purple">차트 포함</Tag>}
            </Space>
          </Card>
        </Col>

        {/* OEE 요약 (데이터가 있는 경우) */}
        {reportData.includeOEE && reportData.oeeData.length > 0 && (
          <Col span={24}>
            <Card title="OEE 요약" size="small">
              <Row gutter={16}>
                <Col span={6}>
                  <Statistic
                    title="평균 OEE"
                    value={(reportData.oeeData.reduce((sum, oee) => sum + oee.oee, 0) / reportData.oeeData.length * 100).toFixed(1)}
                    suffix="%"
                    precision={1}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="최고 OEE"
                    value={(Math.max(...reportData.oeeData.map(oee => oee.oee)) * 100).toFixed(1)}
                    suffix="%"
                    precision={1}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="최저 OEE"
                    value={(Math.min(...reportData.oeeData.map(oee => oee.oee)) * 100).toFixed(1)}
                    suffix="%"
                    precision={1}
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="우수 등급"
                    value={reportData.oeeData.filter(oee => oee.oee >= 0.85).length}
                    suffix={`/ ${reportData.oeeData.length}`}
                  />
                </Col>
              </Row>
            </Card>
          </Col>
        )}

        {/* 생산 실적 요약 (데이터가 있는 경우) */}
        {reportData.includeProduction && reportData.productionData.length > 0 && (
          <Col span={24}>
            <Card title="생산 실적 요약" size="small">
              <Row gutter={16}>
                <Col span={6}>
                  <Statistic
                    title="총 생산량"
                    value={reportData.productionData.reduce((sum, prod) => sum + prod.output_qty, 0)}
                    suffix="개"
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="불량 수량"
                    value={reportData.productionData.reduce((sum, prod) => sum + prod.defect_qty, 0)}
                    suffix="개"
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="불량률"
                    value={(() => {
                      const totalOutput = reportData.productionData.reduce((sum, prod) => sum + prod.output_qty, 0);
                      const totalDefects = reportData.productionData.reduce((sum, prod) => sum + prod.defect_qty, 0);
                      return totalOutput > 0 ? (totalDefects / totalOutput * 100).toFixed(2) : '0.00';
                    })()}
                    suffix="%"
                  />
                </Col>
                <Col span={6}>
                  <Statistic
                    title="양품률"
                    value={(() => {
                      const totalOutput = reportData.productionData.reduce((sum, prod) => sum + prod.output_qty, 0);
                      const totalDefects = reportData.productionData.reduce((sum, prod) => sum + prod.defect_qty, 0);
                      return totalOutput > 0 ? ((totalOutput - totalDefects) / totalOutput * 100).toFixed(2) : '0.00';
                    })()}
                    suffix="%"
                  />
                </Col>
              </Row>
            </Card>
          </Col>
        )}
      </Row>
    </Card>
  );
};