'use client';

import React, { useState, useEffect } from 'react';
import { Row, Col, Card, Button, Space, Badge, Timeline, Alert, Tabs, Select } from 'antd';
import { 
  PlayCircleOutlined, 
  PauseCircleOutlined, 
  ToolOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
  WifiOutlined
} from '@ant-design/icons';
import { MachineStatusInput } from '@/components/machines';
import { OEEGauge } from '@/components/oee';
import { ProductionRecordInput } from '@/components/production';
import { Machine, OEEMetrics, MachineLog, MachineState } from '@/types';
import { useClientOnly } from '@/hooks/useClientOnly';
import { useRealtimeData } from '@/hooks/useRealtimeData';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';

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

const getStateText = (state: MachineState, t: any) => {
  const stateMap = {
    'NORMAL_OPERATION': t('dashboard:status.normal'),
    'MAINTENANCE': t('dashboard:status.maintenance'),
    'MODEL_CHANGE': t('dashboard:status.modelChange'),
    'PLANNED_STOP': t('dashboard:status.plannedStop'),
    'PROGRAM_CHANGE': t('dashboard:status.programChange'),
    'TOOL_CHANGE': t('dashboard:status.toolChange'),
    'TEMPORARY_STOP': t('dashboard:status.temporaryStop')
  };
  return stateMap[state] || state;
};

const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return hours > 0 ? `${hours}시간 ${mins}분` : `${mins}분`;
};

interface OperatorDashboardProps {
  onError?: (error: Error) => void;
}

export const OperatorDashboard: React.FC<OperatorDashboardProps> = ({ onError }) => {
  const isClient = useClientOnly();
  const { user } = useAuth();
  const { t } = useTranslation();
  const [selectedMachine, setSelectedMachine] = useState<string | null>(null);
  const [showStatusInput, setShowStatusInput] = useState(false);
  const [showProductionInput, setShowProductionInput] = useState(false);
  
  // 실시간 데이터 훅 사용
  const { 
    machines, 
    machineLogs, 
    oeeMetrics, 
    loading, 
    error, 
    refresh, 
    isConnected 
  } = useRealtimeData(user?.id, user?.role);

  // 폴백 데이터
  const [fallbackData] = useState({
    assignedMachines: generateMockAssignedMachines(),
    recentLogs: generateMockRecentLogs()
  });

  // 에러 핸들링
  useEffect(() => {
    if (error && onError) {
      onError(new Error(`OperatorDashboard: ${error}`));
    }
  }, [error, onError]);

  // 데이터 처리
  const processedData = React.useMemo(() => {
    try {
      if (machines.length === 0) {
        return fallbackData;
      }

    // 운영자의 담당 설비 필터링 (실제로는 user.assigned_machines 사용)
    const assignedMachineIds = user?.assigned_machines || machines.slice(0, 3).map(m => m.id);
    const assignedMachines = machines
      .filter(machine => assignedMachineIds.includes(machine.id))
      .map(machine => {
        const logs = machineLogs.filter(log => log.machine_id === machine.id);
        const currentLog = logs.find(log => !log.end_time);
        const currentDuration = currentLog 
          ? Math.floor((Date.now() - new Date(currentLog.start_time).getTime()) / (1000 * 60))
          : 0;

        return {
          ...machine,
          oee: oeeMetrics[machine.id]?.oee || 0,
          currentDuration
        };
      });

    // 최근 로그 (담당 설비만)
    const recentLogs = machineLogs
      .filter(log => assignedMachineIds.includes(log.machine_id))
      .slice(0, 10)
      .map(log => ({
        ...log,
        machineName: machines.find(m => m.id === log.machine_id)?.name || 'Unknown'
      }));

      return {
        assignedMachines,
        recentLogs
      };
    } catch (error) {
      console.error('Error processing operator dashboard data:', error);
      if (onError) {
        onError(error as Error);
      }
      return fallbackData;
    }
  }, [machines, machineLogs, oeeMetrics, user, fallbackData, onError]);

  // 상태 변경 핸들러
  const handleStatusChange = async (machineId: string, newState: MachineState) => {
    try {
      // 실제 구현에서는 Supabase에 상태 변경을 저장
      // 여기서는 간단히 로컬 상태만 업데이트
      console.log(`설비 ${machineId} 상태를 ${newState}로 변경`);
      setShowStatusInput(false);
      
      // 실시간 데이터가 자동으로 업데이트됨
    } catch (error) {
      console.error('상태 변경 실패:', error);
    }
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
              {t('dashboard:operatorDashboard.title')}
            </h1>
            <p style={{ margin: '4px 0 0 0', color: '#666' }}>
              {t('dashboard:operatorDashboard.description')}
              {isConnected && (
                <span style={{ marginLeft: 8, color: '#52c41a' }}>
                  <WifiOutlined /> {t('dashboard:adminDashboard.connectedRealtime')}
                </span>
              )}
            </p>
          </div>

        </div>
        <Space>
          <Button 
            icon={<ReloadOutlined />} 
            onClick={refresh}
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
          <Card title="담당 설비 현황" extra={<Badge count={processedData.assignedMachines.length} />}>
            <Row gutter={[16, 16]}>
              {processedData.assignedMachines.map(machine => (
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
                          {getStateText(machine.current_state!, t)}
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
                      items={processedData.recentLogs.slice(0, 8).map(log => ({
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
                              {getStateText(log.state, t)}
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
                    {selectedMachine && oeeMetrics[selectedMachine] && (
                      <OEEGauge
                        metrics={oeeMetrics[selectedMachine]}
                        title={processedData.assignedMachines.find(m => m.id === selectedMachine)?.name}
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
          machineName={processedData.assignedMachines.find(m => m.id === selectedMachine)?.name || ''}
          currentState={processedData.assignedMachines.find(m => m.id === selectedMachine)?.current_state}
          visible={showStatusInput}
          onClose={() => setShowStatusInput(false)}
          onStatusChange={handleStatusChange}
        />
      )}

      {/* 생산 실적 입력 모달 */}
      {showProductionInput && selectedMachine && (
        <ProductionRecordInput
          machineId={selectedMachine}
          machineName={processedData.assignedMachines.find(m => m.id === selectedMachine)?.name || ''}
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