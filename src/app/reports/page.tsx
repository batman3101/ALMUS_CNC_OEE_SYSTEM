'use client';

import React, { useState, useEffect } from 'react';
import { Typography, message } from 'antd';
import { ReportDashboard } from '@/components/reports';
import { useReportsTranslation } from '@/hooks/useTranslation';
import { useRealtimeProductionRecords } from '@/hooks/useRealtimeProductionRecords';
import { Machine } from '@/types';

const { Title } = Typography;

export default function ReportsPage() {
  const { t } = useReportsTranslation();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);

  // 실시간 생산 기록 데이터 구독
  const {
    records: productionRecords,
    loading: recordsLoading,
    aggregatedData,
    refreshRecords
  } = useRealtimeProductionRecords();

  // 실제 설비 데이터 가져오기
  useEffect(() => {
    const fetchMachines = async () => {
      try {
        setLoading(true);
        const response = await fetch('/api/machines');
        if (response.ok) {
          const data = await response.json();
          setMachines(data.machines || []);
        } else {
          throw new Error('Failed to fetch machines');
        }
      } catch (error) {
        console.error('Error fetching machines:', error);
        message.error('설비 데이터를 불러오는데 실패했습니다');
      } finally {
        setLoading(false);
      }
    };

    fetchMachines();
  }, []);

  return (
    <div>
      {/* 페이지 제목 */}
      <div style={{ marginBottom: '24px' }}>
        <Title level={2}>
          {t('title')}
        </Title>
        <Typography.Paragraph type="secondary">
          {t('description')}
        </Typography.Paragraph>
      </div>

      {/* 보고서 대시보드 */}
      <ReportDashboard 
        machines={machines} 
        loading={loading || recordsLoading}
        productionRecords={productionRecords}
        aggregatedData={aggregatedData()}
        onRefreshRecords={refreshRecords}
      />
    </div>
  );
}