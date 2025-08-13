'use client';

import React, { useState } from 'react';
import { Card, Button, Space, message } from 'antd';
import { FileExcelOutlined, FilePdfOutlined, DownloadOutlined } from '@ant-design/icons';
import { ReportExportModal } from './ReportExportModal';
import { ReportTemplates } from './ReportTemplates';
import { OEEMetrics, Machine, ProductionRecord } from '@/types';

interface ReportGeneratorProps {
  machines?: Machine[];
  oeeData?: OEEMetrics[];
  productionData?: ProductionRecord[];
  className?: string;
}

export const ReportGenerator: React.FC<ReportGeneratorProps> = ({
  machines = [],
  oeeData = [],
  productionData = [],
  className
}) => {
  const [exportModalVisible, setExportModalVisible] = useState(false);
  const [exportType, setExportType] = useState<'pdf' | 'excel'>('pdf');
  const [loading, setLoading] = useState(false);

  const handleExportClick = (type: 'pdf' | 'excel') => {
    setExportType(type);
    setExportModalVisible(true);
  };

  const handleQuickExport = async (type: 'pdf' | 'excel') => {
    setLoading(true);
    try {
      await ReportTemplates.generateQuickReport(machines, oeeData, productionData, type);
      message.success(`${type.toUpperCase()} 보고서가 성공적으로 생성되었습니다.`);
    } catch (error) {
      console.error('보고서 생성 실패:', error);
      message.error('보고서 생성 중 오류가 발생했습니다.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={className}>
      <Card title="보고서 생성" size="small">
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <h4>빠른 내보내기</h4>
            <Space>
              <Button
                icon={<FilePdfOutlined />}
                onClick={() => handleQuickExport('pdf')}
                loading={loading}
              >
                PDF 보고서
              </Button>
              <Button
                icon={<FileExcelOutlined />}
                onClick={() => handleQuickExport('excel')}
                loading={loading}
              >
                Excel 보고서
              </Button>
            </Space>
          </div>

          <div>
            <h4>사용자 정의 보고서</h4>
            <Space>
              <Button
                icon={<FilePdfOutlined />}
                onClick={() => handleExportClick('pdf')}
                type="primary"
              >
                PDF 사용자 정의
              </Button>
              <Button
                icon={<FileExcelOutlined />}
                onClick={() => handleExportClick('excel')}
                type="primary"
              >
                Excel 사용자 정의
              </Button>
            </Space>
          </div>
        </Space>
      </Card>

      <ReportExportModal
        visible={exportModalVisible}
        onCancel={() => setExportModalVisible(false)}
        exportType={exportType}
        machines={machines}
        oeeData={oeeData}
        productionData={productionData}
      />
    </div>
  );
};