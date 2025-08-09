'use client';

import React, { useState } from 'react';
import { Button, Space, Modal } from 'antd';
import { Machine, MachineState } from '@/types';
import { MachineList, MachineDetail, MachineStatusInput } from '@/components/machines';

// 임시 설비 데이터
const mockMachines: Machine[] = [
  {
    id: '1',
    name: 'CNC-001',
    location: 'A동 1층',
    model_type: 'MAZAK-VTC-200',
    default_tact_time: 120,
    is_active: true,
    current_state: 'NORMAL_OPERATION',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T08:00:00Z'
  },
  {
    id: '2',
    name: 'CNC-002',
    location: 'A동 1층',
    model_type: 'MAZAK-VTC-200',
    default_tact_time: 110,
    is_active: true,
    current_state: 'MAINTENANCE',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T10:00:00Z'
  },
  {
    id: '3',
    name: 'CNC-003',
    location: 'A동 2층',
    model_type: 'OKUMA-LB-300',
    default_tact_time: 90,
    is_active: true,
    current_state: 'TEMPORARY_STOP',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T14:30:00Z'
  },
  {
    id: '4',
    name: 'CNC-004',
    location: 'B동 1층',
    model_type: 'HAAS-VF-2',
    default_tact_time: 150,
    is_active: false,
    current_state: 'PLANNED_STOP',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T16:00:00Z'
  },
  {
    id: '5',
    name: 'CNC-005',
    location: 'B동 1층',
    model_type: 'HAAS-VF-2',
    default_tact_time: 140,
    is_active: true,
    current_state: 'TOOL_CHANGE',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T15:45:00Z'
  },
  {
    id: '6',
    name: 'CNC-006',
    location: 'B동 2층',
    model_type: 'DMG-MORI-CTX',
    default_tact_time: 200,
    is_active: true,
    current_state: 'MODEL_CHANGE',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-15T13:20:00Z'
  }
];

const MachinesPage: React.FC = () => {
  const [machines, setMachines] = useState<Machine[]>(mockMachines);
  const [selectedMachine, setSelectedMachine] = useState<Machine | null>(null);
  const [showStatusInput, setShowStatusInput] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [language] = useState<'ko' | 'vi'>('ko');

  const handleMachineClick = (machine: Machine) => {
    setSelectedMachine(machine);
    setShowDetail(true);
  };

  const handleStatusChange = (machine: Machine) => {
    setSelectedMachine(machine);
    setShowStatusInput(true);
  };

  const handleStatusUpdate = async (machineId: string, newState: MachineState) => {
    // 실제로는 API 호출
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    setMachines(prev => prev.map(machine => 
      machine.id === machineId 
        ? { ...machine, current_state: newState, updated_at: new Date().toISOString() }
        : machine
    ));
    
    if (selectedMachine?.id === machineId) {
      setSelectedMachine(prev => prev ? { ...prev, current_state: newState } : null);
    }
  };

  const handleRefresh = () => {
    // 실제로는 API에서 데이터 새로고침
    console.log('Refreshing machine data...');
  };

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: '24px' }}>
        <Space>
          <Button 
            type="primary" 
            onClick={() => setShowDetail(!showDetail)}
          >
            {showDetail ? '목록 보기' : '상세 보기 (CNC-001)'}
          </Button>
        </Space>
      </div>

      {showDetail && selectedMachine ? (
        <MachineDetail
          machine={selectedMachine}
          onStatusChange={handleStatusChange}
          onRefresh={handleRefresh}
          language={language}
        />
      ) : (
        <MachineList
          machines={machines}
          onMachineClick={handleMachineClick}
          language={language}
        />
      )}

      {/* 상태 변경 모달 */}
      {selectedMachine && (
        <MachineStatusInput
          machine={selectedMachine}
          visible={showStatusInput}
          onClose={() => setShowStatusInput(false)}
          onStatusChange={handleStatusUpdate}
          language={language}
        />
      )}

      {/* 상세 보기 모달 */}
      <Modal
        title="설비 상세 정보"
        open={showDetail && !showStatusInput}
        onCancel={() => setShowDetail(false)}
        footer={null}
        width="90%"
        style={{ top: 20 }}
      >
        {selectedMachine && (
          <MachineDetail
            machine={selectedMachine}
            onStatusChange={handleStatusChange}
            onRefresh={handleRefresh}
            language={language}
          />
        )}
      </Modal>
    </div>
  );
};

export default MachinesPage;