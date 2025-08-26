'use client';

import React, { useState, useEffect } from 'react';
import { Typography } from 'antd';
import { useMachinesTranslation, useCommonTranslation } from '@/hooks/useTranslation';
import MachineList from '@/components/machines/MachineList';
import MachineDetailModal from '@/components/machines/MachineDetailModal';
import { ProtectedRoute } from '@/components/auth';
import { useMachines } from '@/hooks/useMachines';
import { Machine } from '@/types';

const { Title, Paragraph } = Typography;

export default function MachinesPage() {
  const { t } = useMachinesTranslation();
  const { t: tCommon } = useCommonTranslation();
  const { machines, loading, error, refetch } = useMachines();
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [detailModalVisible, setDetailModalVisible] = useState(false);

  const handleMachineClick = (machine: Machine) => {
    setSelectedMachine(machine);
    setDetailModalVisible(true);
  };

  const handleDetailModalClose = () => {
    setDetailModalVisible(false);
    setSelectedMachine(null);
  };

  const handleMachineUpdated = () => {
    refetch(); // 설비 목록 새로고침
  };

  return (
    <ProtectedRoute>
      <div>
        <div style={{ marginBottom: '24px' }}>
          <Title level={2}>
            {tCommon('nav.machines')}
          </Title>
          <Paragraph type="secondary">
            {t('description')}
          </Paragraph>
        </div>

        <MachineList 
          machines={machines}
          loading={loading}
          onMachineClick={handleMachineClick}
        />

        {/* 설비 상세 정보 모달 */}
        <MachineDetailModal
          machine={selectedMachine}
          visible={detailModalVisible}
          onClose={handleDetailModalClose}
          onMachineUpdated={handleMachineUpdated}
        />
      </div>
    </ProtectedRoute>
  );
}