'use client';

import React, { useState } from 'react';
import { Button, Card, Space, Typography, message } from 'antd';
import { PlusOutlined, ClockCircleOutlined } from '@ant-design/icons';
import { Machine } from '@/types';
import ProductionRecordInput from './ProductionRecordInput';
import { ShiftEndNotification } from './ShiftEndNotification';
import { useShiftNotification } from '@/hooks/useShiftNotification';
import { useProductionRecords } from '@/hooks/useProductionRecords';
import { getCurrentShiftInfo, formatShiftTime } from '@/utils/shiftUtils';
import { format } from 'date-fns';

const { Title, Text } = Typography;

interface ProductionManagerProps {
  machines: Machine[];
  currentUser?: {
    id: string;
    role: 'admin' | 'operator' | 'engineer';
  };
}

export const ProductionManager: React.FC<ProductionManagerProps> = ({
  machines,
  currentUser
}) => {
  const [showManualInput, setShowManualInput] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);

  const { createProductionRecord } = useProductionRecords();
  const shiftNotification = useShiftNotification({ 
    machines,
    enabled: currentUser?.role === 'operator' // 운영자만 교대 알림 활성화
  });

  const currentShift = getCurrentShiftInfo();

  // 수동 생산 실적 입력
  const handleManualInput = (machine: Machine) => {
    setSelectedMachine(machine);
    setShowManualInput(true);
  };

  // 생산 실적 입력 완료
  const handleProductionRecordSubmit = async (data: { output_qty: number; defect_qty: number }) => {
    if (!selectedMachine) return;

    try {
      await createProductionRecord({
        machine_id: selectedMachine.id,
        output_qty: data.output_qty,
        defect_qty: data.defect_qty,
        shift: currentShift.shift,
        date: format(new Date(), 'yyyy-MM-dd')
      });

      message.success(`${selectedMachine.name}의 생산 실적이 입력되었습니다`);
      
      // 교대 알림에서 해당 설비 완료 처리
      shiftNotification.markMachineCompleted(selectedMachine.id);
      
      setShowManualInput(false);
      setSelectedMachine(null);
    } catch {
      message.error('생산 실적 입력 중 오류가 발생했습니다');
    }
  };

  return (
    <div>
      <Card>
        <div style={{ marginBottom: 24 }}>
          <Title level={4}>생산 실적 관리</Title>
          <Space direction="vertical" size="small">
            <Text>
              <ClockCircleOutlined style={{ marginRight: 8 }} />
              현재 교대: {formatShiftTime(currentShift)}
            </Text>
            <Text type="secondary">
              교대 종료까지: {shiftNotification.minutesUntilEnd}분
            </Text>
          </Space>
        </div>

        <div style={{ marginBottom: 16 }}>
          <Title level={5}>담당 설비 목록</Title>
          <Space wrap>
            {machines.map(machine => (
              <Button
                key={machine.id}
                icon={<PlusOutlined />}
                onClick={() => handleManualInput(machine)}
                style={{ marginBottom: 8 }}
              >
                {machine.name} 실적 입력
              </Button>
            ))}
          </Space>
        </div>

        {shiftNotification.showNotification && (
          <div style={{ marginTop: 16, padding: 16, backgroundColor: '#fff7e6', borderRadius: 6, border: '1px solid #ffd591' }}>
            <Text strong style={{ color: '#fa8c16' }}>
              ⚠️ 교대 종료 알림이 활성화되었습니다
            </Text>
            <br />
            <Text type="secondary">
              {shiftNotification.pendingMachines.length}개 설비의 생산 실적 입력이 필요합니다.
            </Text>
          </div>
        )}
      </Card>

      {/* 교대 종료 자동 알림 시스템 */}
      <ShiftEndNotification
        machines={shiftNotification.pendingMachines}
        onProductionRecordSubmit={(machineId) => {
          shiftNotification.markMachineCompleted(machineId);
          message.success('생산 실적이 입력되었습니다');
        }}
      />

      {/* 수동 생산 실적 입력 모달 */}
      {selectedMachine && (
        <ProductionRecordInput
          visible={showManualInput}
          onClose={() => {
            setShowManualInput(false);
            setSelectedMachine(null);
          }}
          machine={selectedMachine}
          shift={currentShift.shift}
          date={format(new Date(), 'yyyy-MM-dd')}
          onSubmit={handleProductionRecordSubmit}
        />
      )}
    </div>
  );
};

export default ProductionManager;