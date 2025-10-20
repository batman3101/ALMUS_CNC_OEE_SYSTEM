'use client';

import React, { useState } from 'react';
import { Card, Button, Space, App } from 'antd';
import { FileExcelOutlined, FilePdfOutlined, DownloadOutlined } from '@ant-design/icons';
import { ReportExportModal } from './ReportExportModal';
import { ReportTemplates } from './ReportTemplates';
import { useReportsTranslation } from '@/hooks/useTranslation';
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
  const { t } = useReportsTranslation();
  const { message } = App.useApp();
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
      // 차트 요소들 수집 시도
      const chartElements: { [key: string]: HTMLCanvasElement | HTMLElement } = {};
      
      if (type === 'pdf') {
        // 가능한 차트 찾기
        const allCanvas = document.querySelectorAll('canvas');
        allCanvas.forEach((canvas, index) => {
          if (canvas.width > 100 && canvas.height > 100) {
            chartElements[`chart-${index}`] = canvas;
          }
        });

        console.log(`Quick report: Found ${Object.keys(chartElements).length} chart elements`);
      }

      if (type === 'pdf' && Object.keys(chartElements).length > 0) {
        // 차트가 있으면 고급 보고서로 생성
        const reportData = {
          machines,
          oeeData,
          productionData,
          reportType: 'summary' as const,
          dateRange: [
            new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
            new Date().toISOString().split('T')[0]
          ] as [string, string],
          selectedMachines: machines.map(m => m.id),
          includeCharts: true,
          includeOEE: true,
          includeProduction: true,
          includeDowntime: true,
          groupBy: 'machine' as const
        };
        
        await ReportTemplates.generateAdvancedReport(reportData, type, chartElements);
      } else {
        await ReportTemplates.generateQuickReport(machines, oeeData, productionData, type);
      }
      
      message.success(`${type.toUpperCase()} 보고서가 성공적으로 생성되었습니다.`);
    } catch (error: any) {
      console.error('보고서 생성 실패:', error);
      const errorMessage = error?.message || '알 수 없는 오류가 발생했습니다.';
      message.error(`보고서 생성 중 오류가 발생했습니다: ${errorMessage}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className={className}>
      <Card title={t('reportGeneration')} size="small">
        <Space direction="vertical" style={{ width: '100%' }}>
          <div>
            <h4>{t('quickExport')}</h4>
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
            <h4>{t('customReport')}</h4>
            <Space>
              <Button
                icon={<FilePdfOutlined />}
                onClick={() => handleExportClick('pdf')}
                type="primary"
              >
                {t('buttons.pdfCustom')}
              </Button>
              <Button
                icon={<FileExcelOutlined />}
                onClick={() => handleExportClick('excel')}
                type="primary"
              >
                {t('buttons.excelCustom')}
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