'use client';

import React, { useState, useEffect } from 'react';
import { Card, Typography, Breadcrumb } from 'antd';
import { HomeOutlined, FileTextOutlined } from '@ant-design/icons';
import { ReportDashboard } from '@/components/reports';
import { Machine } from '@/types';

const { Title } = Typography;

export default function ReportsPage() {
  const [machines, setMachines] = useState<Machine[]>([]);

  // 모의 설비 데이터 생성
  useEffect(() => {
    const mockMachines: Machine[] = [
      {
        id: 'machine_1',
        name: 'CNC-001',
        location: '1공장 A라인',
        model_type: 'Mazak VTC-800',
        default_tact_time: 60,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      },
      {
        id: 'machine_2',
        name: 'CNC-002',
        location: '1공장 B라인',
        model_type: 'DMG Mori NLX2500',
        default_tact_time: 45,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      },
      {
        id: 'machine_3',
        name: 'CNC-003',
        location: '2공장 A라인',
        model_type: 'Okuma Genos L250',
        default_tact_time: 75,
        is_active: true,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }
    ];

    setMachines(mockMachines);
  }, []);

  return (
    <div style={{ padding: '24px' }}>
      {/* 브레드크럼 */}
      <Breadcrumb 
        style={{ marginBottom: '16px' }}
        items={[
          {
            title: (
              <>
                <HomeOutlined />
                <span>홈</span>
              </>
            )
          },
          {
            title: (
              <>
                <FileTextOutlined />
                <span>보고서</span>
              </>
            )
          }
        ]}
      />

      {/* 페이지 제목 */}
      <Card style={{ marginBottom: '24px' }}>
        <Title level={2} style={{ margin: 0 }}>
          <FileTextOutlined style={{ marginRight: '8px' }} />
          보고서 생성 및 내보내기
        </Title>
        <p style={{ margin: '8px 0 0 0', color: '#666' }}>
          OEE 지표, 생산 실적, 다운타임 분석 등의 보고서를 PDF 또는 Excel 형식으로 생성할 수 있습니다.
        </p>
      </Card>

      {/* 보고서 대시보드 */}
      <ReportDashboard machines={machines} />
    </div>
  );
}