'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Typography, Space, Alert, Divider } from 'antd';
import { ClockCircleOutlined, ExclamationCircleOutlined } from '@ant-design/icons';
import { Machine } from '@/types';
import { ProductionRecordInput } from './ProductionRecordInput';
import { useProductionRecords } from '@/hooks/useProductionRecords';
import { format, isAfter, isBefore, setHours, setMinutes, setSeconds } from 'date-fns';

const { Title, Text } = Typography;

interface ShiftEndNotificationProps {
  machines: Machine[]; // 사용자가 담당하는 설비 목록
  onProductionRecordSubmit?: (machineId: string, data: { output_qty: number; defect_qty: number }) => void;
}

interface ShiftInfo {
  shift: 'A' | 'B';
  endTime: Date;
  nextShiftStart: Date;
}

export const ShiftEndNotification: React.FC<ShiftEndNotificationProps> = ({
  machines,
  onProductionRecordSubmit
}) => {
  const [currentShift, setCurrentShift] = useState<ShiftInfo | null>(null);
  const [showNotification, setShowNotification] = useState(false);
  const [showProductionInput, setShowProductionInput] = useState(false);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [pendingMachines, setPendingMachines] = useState<Machine[]>([]);
  const [estimatedOutputs, setEstimatedOutputs] = useState<Record<string, number>>({});

  const { createProductionRecord, calculateEstimatedOutput } = useProductionRecords();

  // 현재 교대 정보 계산
  const getCurrentShift = useCallback((): ShiftInfo | null => {
    const now = new Date();
    const today = new Date(now);
    
    // A조: 08:00 - 20:00
    const aShiftStart = setSeconds(setMinutes(setHours(today, 8), 0), 0);
    const aShiftEnd = setSeconds(setMinutes(setHours(today, 20), 0), 0);
    
    // B조: 20:00 - 08:00 (다음날)
    const bShiftStart = setSeconds(setMinutes(setHours(today, 20), 0), 0);
    const bShiftEnd = setSeconds(setMinutes(setHours(new Date(today.getTime() + 24 * 60 * 60 * 1000), 8), 0), 0);

    if (isAfter(now, aShiftStart) && isBefore(now, aShiftEnd)) {
      // A조 시간대
      return {
        shift: 'A',
        endTime: aShiftEnd,
        nextShiftStart: bShiftStart
      };
    } else {
      // B조 시간대 (20:00 이후 또는 08:00 이전)
      return {
        shift: 'B',
        endTime: bShiftEnd,
        nextShiftStart: aShiftStart
      };
    }
  }, []);

  // 교대 종료 시간 감지
  const checkShiftEnd = useCallback(() => {
    const shift = getCurrentShift();
    if (!shift) return;

    const now = new Date();
    const timeUntilShiftEnd = shift.endTime.getTime() - now.getTime();
    
    // 교대 종료 15분 전에 알림 표시
    const notificationThreshold = 15 * 60 * 1000; // 15분을 밀리초로 변환
    
    if (timeUntilShiftEnd > 0 && timeUntilShiftEnd <= notificationThreshold) {
      setCurrentShift(shift);
      setPendingMachines(machines);
      
      // 각 설비별 추정 생산량 계산
      const estimates: Record<string, number> = {};
      machines.forEach(machine => {
        // 임시로 8시간(480분) 가동 시간으로 가정하여 추정 생산량 계산
        const estimatedRuntime = 480; // 분
        estimates[machine.id] = calculateEstimatedOutput(machine.default_tact_time, estimatedRuntime);
      });
      setEstimatedOutputs(estimates);
      
      setShowNotification(true);
    }
  }, [machines, getCurrentShift, calculateEstimatedOutput]);

  // 주기적으로 교대 종료 시간 체크 (1분마다)
  useEffect(() => {
    const interval = setInterval(checkShiftEnd, 60 * 1000);
    
    // 컴포넌트 마운트 시 즉시 체크
    checkShiftEnd();
    
    return () => clearInterval(interval);
  }, [checkShiftEnd]);

  // 생산 실적 입력 완료 처리
  const handleProductionRecordSubmit = async (data: { output_qty: number; defect_qty: number }) => {
    if (!selectedMachine || !currentShift) return;

    try {
      await createProductionRecord({
        machine_id: selectedMachine.id,
        output_qty: data.output_qty,
        defect_qty: data.defect_qty,
        shift: currentShift.shift,
        date: format(new Date(), 'yyyy-MM-dd')
      });

      // 완료된 설비를 대기 목록에서 제거
      setPendingMachines(prev => prev.filter(m => m.id !== selectedMachine.id));
      
      // 부모 컴포넌트에 알림
      onProductionRecordSubmit?.(selectedMachine.id, data);
      
      setShowProductionInput(false);
      setSelectedMachine(null);
    } catch (error) {
      console.error('생산 실적 입력 오류:', error);
    }
  };

  // 설비 선택하여 생산 실적 입력
  const handleMachineSelect = (machine: Machine) => {
    setSelectedMachine(machine);
    setShowProductionInput(true);
  };

  // 나중에 입력하기
  const handlePostpone = () => {
    setShowNotification(false);
    // 10분 후 다시 알림
    setTimeout(() => {
      if (pendingMachines.length > 0) {
        setShowNotification(true);
      }
    }, 10 * 60 * 1000);
  };

  // 모든 설비 입력 완료 시 알림 닫기
  useEffect(() => {
    if (pendingMachines.length === 0 && showNotification) {
      setShowNotification(false);
    }
  }, [pendingMachines.length, showNotification]);

  if (!currentShift) return null;

  return (
    <>
      {/* 교대 종료 알림 모달 */}
      <Modal
        title={
          <Space>
            <ClockCircleOutlined style={{ color: '#faad14' }} />
            교대 종료 알림
          </Space>
        }
        open={showNotification}
        onCancel={() => setShowNotification(false)}
        footer={[
          <Button key="postpone" onClick={handlePostpone}>
            나중에 입력
          </Button>,
          <Button key="close" type="primary" onClick={() => setShowNotification(false)}>
            확인
          </Button>,
        ]}
        width={600}
        closable={false}
        maskClosable={false}
      >
        <Alert
          message={`${currentShift.shift}조 교대가 곧 종료됩니다`}
          description={`교대 종료 시간: ${format(currentShift.endTime, 'HH:mm')}`}
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
        />

        <Title level={5}>생산 실적 입력이 필요한 설비</Title>
        <Text type="secondary" style={{ display: 'block', marginBottom: 16 }}>
          아래 설비들의 생산 실적을 입력해주세요. 입력하지 않은 경우 Tact Time을 기반으로 추정값이 사용됩니다.
        </Text>

        <div style={{ maxHeight: 300, overflowY: 'auto' }}>
          {pendingMachines.map((machine, index) => (
            <div key={machine.id}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  backgroundColor: '#fafafa',
                  borderRadius: 6,
                  marginBottom: 8
                }}
              >
                <div>
                  <Text strong>{machine.name}</Text>
                  <br />
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    {machine.location} | 추정 생산량: {estimatedOutputs[machine.id]?.toLocaleString() || 0}개
                  </Text>
                </div>
                <Button
                  type="primary"
                  size="small"
                  onClick={() => handleMachineSelect(machine)}
                >
                  실적 입력
                </Button>
              </div>
              {index < pendingMachines.length - 1 && <Divider style={{ margin: '8px 0' }} />}
            </div>
          ))}
        </div>

        {pendingMachines.length === 0 && (
          <Alert
            message="모든 설비의 생산 실적 입력이 완료되었습니다"
            type="success"
            showIcon
          />
        )}
      </Modal>

      {/* 생산 실적 입력 모달 */}
      {selectedMachine && (
        <ProductionRecordInput
          visible={showProductionInput}
          onClose={() => {
            setShowProductionInput(false);
            setSelectedMachine(null);
          }}
          machine={selectedMachine}
          shift={currentShift.shift}
          date={format(new Date(), 'yyyy-MM-dd')}
          onSubmit={handleProductionRecordSubmit}
          estimatedOutput={estimatedOutputs[selectedMachine.id]}
        />
      )}
    </>
  );
};

export default ShiftEndNotification;