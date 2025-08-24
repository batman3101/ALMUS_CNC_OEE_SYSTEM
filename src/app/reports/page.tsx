'use client';

import React, { useState, useEffect } from 'react';
import { Card, Typography, message } from 'antd';
import { ReportDashboard } from '@/components/reports';
import { Machine } from '@/types';

const { Title } = Typography;

export default function ReportsPage() {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);

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
          통계 리포트
        </Title>
        <Typography.Paragraph type="secondary">
          OEE 지표, 생산 실적, 다운타임 분석 등의 보고서를 PDF 또는 Excel 형식으로 생성할 수 있습니다.
        </Typography.Paragraph>
      </div>

      {/* 보고서 대시보드 */}
      <ReportDashboard machines={machines} loading={loading} />
    </div>
  );
}