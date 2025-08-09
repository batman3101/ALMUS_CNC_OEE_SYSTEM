'use client';

import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Button, Space, Badge, Timeline, Alert, Tabs, Select } from 'antd';
import { 
  PlayCircleOutlined, 
  PauseCircleOutlined, 
  ToolOutlined,
  ClockCircleOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { MachineStatusInput } from '@/components/machines';
import { OEEGauge } from '@/components/oee';
import { ProductionRecordInput } from '@/components/production';
import { Machine, OEEMetrics, MachineLog, MachineState } from '@/types';
import { useClientOnly } from '@/hooks/useClientOnly';

// Removed deprecated TabPane import

// 모의 데이터 생성 함수들
const generateMockAssignedMachines = (): Array<Machine & { oee: number; currentDuration: number }> => [
  { 
    id: '1', 
    name: 'CNC-001', 
    location: 'A동 1층', 
    model_type: 'DMG MORI', 
    default_tact_time: 120, 
    is_active: true, 
    current_state: 'NORMAL_OPERATION', 
    created_at: '2024-01-01', 
    updated_at: '2024-01-01', 
    oee: 0.85,
    currentDuration: 145 // 분
  },
  { 
    id: '2', 
    name: 'CNC-002', 
    location: 'A동 1층', 
    model_type: 'MAZAK', 
    default_tact_time: 90, 
    is_active: true, 
    current_state: 'TOOL_CHANGE', 
    created_at: '2024-01-01', 
    updated_at: '2024-01-01', 
    oee: 0.72,
    currentDuration: 25
  },
  { 
    id: '3', 
    name: 'CNC-003', 
    location: 'A동 2층', 
    model_type: 'HAAS', 
    default_tact_time: 150, 
    is_active: true, 
    current_state: 'NORMAL_OPERATION', 
    created_at: '2024-01-01', 
    updated_at: '2024-01-01', 
    oee: 0.91,
    currentDuration: 320
  },
];

const generateMockRecentLogs = (): Array<MachineLog & { machineName: string }> => [
  {
    log_id: '1',
    machine_id: '1',
    state: 'NORMAL_OPERATION',
    start_time: new Date(Date.now() - 145 * 60 * 1000).toISOString(),
    operator_id: 'user1',
    created_at: new Date().toISOString(),
    machineName: 'CNC-001'
  },
  {
    log_id: '2',
    machine_id: '2',
    state: 'TOOL_CHANGE',
    start_time: new Date(Date.now() - 25 * 60 * 1000).toISOString(),
    operator_id: 'user1',
    created_at: new Date().toISOString(),
    machineName: 'CNC-002'
  },
  {
    log_id: '3',
    machine_id: '1',
    state: 'TEMPORARY_STOP',
    start_time: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
    end_time: new Date(Date.now() - 145 * 60 * 1000).toISOString(),
    duration: 35,
    operator_id: 'user1',
    created_at: new Date().toISOString(),
    machineName: 'CNC-001'
  },
];

const generateMockOEEMetrics = (): OEEMetrics => ({
  availability: 0.85,
  performance: 0.89,
  quality: 0.94,
  oee: 0.71,
  actual_runtime: 450,
  planned_runtime: 480,
  ideal_runtime: 400,
  output_qty: 1000,
  defect_qty: 25
});

const getStateIcon = (state: MachineState) => {
  switch (state) {
    case 'NORMAL_OPERATION':
      return <PlayCircleOutlined style={{ color: '#52c41a' }} />;
    case 'MAINTENANCE':
      return <ToolOutlined style={{ color: '#faad14' }} />;
    case 'TEMPORARY_STOP':
    case 'PLANNED_STOP':
      return <PauseCircleOutlined style={{ color: '#ff4d4f' }} />;
    default:
      return <ClockCircleOutlined style={{ color: '#1890ff' }} />;
  }
};

const getStateText = (state: MachineState) => {
  const stateMap = {
    'NORMAL_OPERATION': '정상가동',
    'MAINTENANCE': '점검중',
    'MODEL_CHANGE': '모델교체',
    'PLANNED_STOP': '계획정지',
    'PROGRAM_CHANGE': '프로그램교체',
    'TOOL_CHANGE': '공구교환',
    'TEMPORARY_STOP': '일시정지'
  };
  return stateMap[state] || state;
};

const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}시간 ${mins}분` : `${mins}분`;
};

interface OperatorDashboardProps {
  selectedRole?: 'admin' | 'operator' | 'engineer';
  onRoleChange?: (role: 'admin' | 'operator' | 'engineer') => void;
}

export const OperatorDashboard: React.FC<OperatorDashboardProps> = ({ selectedRole, onRoleChange }) => {
  const isClient = useClientOnly();
  const [loading, setLoading] = useState(false);
  const [assignedMachines, setAssignedMachines] = useState(generateMockAssignedMachines());
  const [recentLogs, setRecentLogs] = useState(generateMockRecentLogs());
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [showStatusInput, setShowStatusInput] = useState(false);
  const [showProductionInput, setShowProductionInput] = useState(false);

  // 데이터 새로고침
  const handleRefresh = async () => {
    setLoading(true);
    try {
      await new Promise(resolve => setTimeout(resolve, 1000));
      setAssignedMachines(generateMockAssignedMachines());
      setRecentLogs(generateMockRecentLogs());
    } catch (error) {
      console.error('데이터 새로고침 실패:', error);
    } finally {
      setLoading(false);
    }
  };

  // 실시간 시간 업데이트 (클라이언트에서만 실행)
  useEffect(() => {
    if (!isClient) return;
    
    const interval = setInterval(() => {
      setAssignedMachines(prev => prev.map(machine => ({
        ...machine,
        currentDuration: machine.currentDuration + 1
      })));
    }, 60000); // 1분마다 업데이트

    return () => clearInterval(interval);
  }, [isClient]);

  // 상태 변경 핸들러
  const handleStatusChange = (machineId: string, newState: MachineState) => {
    setAssignedMachines(prev => prev.map(machine => 
      machine.id === machineId 
        ? { ...machine, current_state: newState, currentDuration: 0 }
        : machine
    ));
    
    // 새 로그 추가
    const newLog: MachineLog & { machineName: string } = {
      log_id: Date.now().toString(),
      machine_id: machineId,
      state: newState,
      start_time: new Date().toISOString(),
      operator_id: 'current-user',
      created_at: new Date().toISOString(),
      machineName: assignedMachines.find(m => m.id === machineId)?.name || ''
    };
    
    setRecentLogs(prev => [newLog, ...prev.slice(0, 9)]);
    setShowStatusInput(false);
  };

  // 교대 종료 알림 체크
  const currentHour = new Date().getHours();
  const isShiftEnd = currentHour === 8 || currentHour === 20;

  return (
    <div>
      {/* 헤더 */}
      <div style={{ marginBottom: 24, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <div>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 'bold' }}>
              <PlayCircleOutlined style={{ marginRight: 8 }} />
              운영자 대시보드
            </h1>
            <p style={{ margin: '4px 0 0 0', color: '#666' }}>담당 설비 현황 및 작업 관리</p>
          </div>
          {/* 역할 선택기 */}
          {isClient && onRoleChange && (
            <div style={{ 
              background: 'white',
              padding: '8px 12px',
              borderRadius: 6,
              boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
              border: '1px solid #d9d9d9'
            }}>
              <Space>
                <span style={{ fontSize: 12, color: '#666' }}>역할 선택:</span>
                <Select
                  value={selectedRole || 'operator'}
                  onChange={onRoleChange}
                  size="small"
                  style={{ width: 100 }}
                  options={[
                    { label: '관리자', value: 'admin' },
                    { label: '운영자', value: 'operator' },
                    { label: '엔지니어', value: 'engineer' }
                  ]}
                />
              </Space>
            </div>
          )}
        </div>
        <Space>
          <Button 
            icon={<ReloadOutlined />} 
            onClick={handleRefresh}
            loading={loading}
          >
            새로고침
          </Button>
        </Space>
      </div>

      {/* 교대 종료 알림 */}
      {isShiftEnd && (
        <Alert
          message="교대 종료 시간입니다"
          description="생산 실적을 입력해주세요."
          type="warning"
          showIcon
          action={
            <Button size="small" onClick={() => setShowProductionInput(true)}>
              실적 입력
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Row gutter={[16, 16]}>
        {/* 담당 설비 현황 */}
        <Col xs={24} lg={16}>
          <Card title="담당 설비 현황" extra={<Badge count={assignedMachines.length} />}>
            <Row gutter={[16, 16]}>
              {assignedMachines.map(machine => (
                <Col xs={24} md={12} xl={8} key={machine.id}>
                  <Card 
                    size="small"
                    hoverable
                    onClick={() => setSelectedMachine(machine.id)}
                    style={{ 
                      border: selectedMachine === machine.id ? '2px solid #1890ff' : '1px solid #d9d9d9',
                      cursor: 'pointer'
                    }}
                  >
                    <div style={{ textAlign: 'center' }}>
                      <div style={{ fontSize: 16, fontWeight: 'bold', marginBottom: 8 }}>
                        {machine.name}
                      </div>
                      
                      <div style={{ marginBottom: 12 }}>
                        {getStateIcon(machine.current_state!)}
                        <span style={{ marginLeft: 8 }}>
                          {getStateText(machine.current_state!)}
                        </span>
                      </div>
                      
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                        지속 시간: {formatDuration(machine.currentDuration)}
                      </div>
                      
                      <div style={{ fontSize: 14, fontWeight: 'bold' }}>
                        OEE: <span style={{ 
                          color: machine.oee >= 0.85 ? '#52c41a' : 
                                 machine.oee >= 0.65 ? '#faad14' : '#ff4d4f' 
                        }}>
                          {(machine.oee * 100).toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </Card>
                </Col>
              ))}
            </Row>
            
            {/* 상태 변경 버튼 */}
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <Space>
                <Button 
                  type="primary" 
                  onClick={() => setShowStatusInput(true)}
                  disabled={!selectedMachine}
                >
                  상태 변경
                </Button>
                <Button 
                  onClick={() => setShowProductionInput(true)}
                  disabled={!selectedMachine}
                >
                  생산 실적 입력
                </Button>
              </Space>
            </div>
          </Card>
        </Col>

        {/* 사이드 패널 */}
        <Col xs={24} lg={8}>
          <Tabs 
            defaultActiveKey="logs"
            items={[
              {
                key: 'logs',
                label: '최근 작업',
                children: (
                  <Card size="small">
                    <Timeline 
                      size="small"
                      items={recentLogs.slice(0, 8).map(log => ({
                        key: log.log_id,
                        dot: getStateIcon(log.state),
                        color: log.state === 'NORMAL_OPERATION' ? 'green' : 
                               log.state === 'MAINTENANCE' ? 'orange' : 'red',
                        children: (
                          <div style={{ fontSize: 12 }}>
                            <div style={{ fontWeight: 'bold' }}>
                              {log.machineName}
                            </div>
                            <div style={{ color: '#666' }}>
                              {getStateText(log.state)}
                            </div>
                            <div style={{ color: '#999' }}>
                              {new Date(log.start_time).toLocaleString('ko-KR', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </div>
                          </div>
                        )
                      }))}
                    />
                  </Card>
                )
              },
              {
                key: 'oee',
                label: 'OEE 현황',
                children: (
                  <>
                    {selectedMachine && (
                      <OEEGauge
                        metrics={generateMockOEEMetrics()}
                        title={assignedMachines.find(m => m.id === selectedMachine)?.name}
                        size="small"
                        showDetails={false}
                      />
                    )}
                    {!selectedMachine && (
                      <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
                        설비를 선택해주세요
                      </div>
                    )}
                  </>
                )
              }
            ]}
          />
        </Col>
      </Row>

      {/* 상태 입력 모달 */}
      {showStatusInput && selectedMachine && (
        <MachineStatusInput
          machineId={selectedMachine}
          machineName={assignedMachines.find(m => m.id === selectedMachine)?.name || ''}
          currentState={assignedMachines.find(m => m.id === selectedMachine)?.current_state}
          visible={showStatusInput}
          onClose={() => setShowStatusInput(false)}
          onStatusChange={handleStatusChange}
        />
      )}

      {/* 생산 실적 입력 모달 */}
      {showProductionInput && selectedMachine && (
        <ProductionRecordInput
          machineId={selectedMachine}
          machineName={assignedMachines.find(m => m.id === selectedMachine)?.name || ''}
          visible={showProductionInput}
          onClose={() => setShowProductionInput(false)}
          onSubmit={(data) => {
            console.log('생산 실적 입력:', data);
            setShowProductionInput(false);
          }}
        />
      )}
    </div>
  );
};