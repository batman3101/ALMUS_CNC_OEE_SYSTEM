'use client';

import React, { useState, useEffect } from 'react';
import { Typography } from 'antd';
import { useTranslation } from '@/hooks/useTranslation';
import MachineList from '@/components/machines/MachineList';
import { ProtectedRoute } from '@/components/auth';
import { Machine } from '@/types';

const { Title, Paragraph } = Typography;

export default function MachinesPage() {
  const { t } = useTranslation();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // 임시 더미 데이터 - 실제로는 API 호출로 대체
    const mockMachines: Machine[] = [
      {
        id: 'machine_1',
        name: 'CNC-001',
        location: '1공장 A라인',
        model_type: 'Mazak VTC-800',
        default_tact_time: 60,
        is_active: true,
        current_state: 'NORMAL_OPERATION',
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
        current_state: 'MAINTENANCE',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      },
      {
        id: 'machine_3',
        name: 'CNC-003',
        location: '2공장 A라인',
        model_type: 'Okuma Genos L250',
        default_tact_time: 75,
        is_active: false,
        current_state: 'PLANNED_STOP',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
      }
    ];
    
    setMachines(mockMachines);
    setLoading(false);
  }, []);

  const handleMachineClick = (machine: Machine) => {
    console.log('Machine clicked:', machine);
    // 상세 페이지로 이동 또는 모달 표시
  };

  return (
    <ProtectedRoute>
      <div>
        <div style={{ marginBottom: '24px' }}>
          <Title level={2}>
            {t('machines.title')}
          </Title>
          <Paragraph type="secondary">
            {t('machines.description')}
          </Paragraph>
        </div>

        <MachineList 
          machines={machines}
          loading={loading}
          onMachineClick={handleMachineClick}
        />
      </div>
    </ProtectedRoute>
  );
}