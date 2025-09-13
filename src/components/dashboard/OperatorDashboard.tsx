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
import { useMachinesTranslation, useDashboardTranslation, useMultipleTranslation } from '@/hooks/useTranslation';

// Removed deprecated TabPane import


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

const getStateText = (state: MachineState, machinesT: any) => {
  const stateMap = {
    'NORMAL_OPERATION': machinesT('states.NORMAL_OPERATION'),
    'MAINTENANCE': machinesT('states.MAINTENANCE'),
    'PM_MAINTENANCE': machinesT('states.PM_MAINTENANCE'),
    'MODEL_CHANGE': machinesT('states.MODEL_CHANGE'),
    'PLANNED_STOP': machinesT('states.PLANNED_STOP'),
    'PROGRAM_CHANGE': machinesT('states.PROGRAM_CHANGE'),
    'TOOL_CHANGE': machinesT('states.TOOL_CHANGE'),
    'TEMPORARY_STOP': machinesT('states.TEMPORARY_STOP')
  };
  return stateMap[state] || state;
};

const formatDuration = (minutes: number, machinesT: any): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  if (hours > 0) {
    return `${hours}${machinesT('units.hours') || '시간'} ${mins}${machinesT('units.minutes') || '분'}`;
  }
  return `${mins}${machinesT('units.minutes') || '분'}`;
};

interface OperatorDashboardProps {
  onError?: (error: Error) => void;
}

export const OperatorDashboard: React.FC<OperatorDashboardProps> = ({ onError }) => {
  const isClient = useClientOnly();
  const { user } = useAuth();
  const { t: machinesT } = useMachinesTranslation();
  const { t: dashboardT } = useDashboardTranslation();
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


  // 에러 핸들링
  useEffect(() => {
    if (error && onError) {
      onError(new Error(`OperatorDashboard: ${error}`));
    }
  }, [error, onError]);

  // 데이터 처리
  const processedData = React.useMemo(() => {
    try {
      // 운영자의 담당 설비 필터링 (user.assigned_machines 사용)
      const assignedMachineIds = user?.assigned_machines || [];
      
      if (assignedMachineIds.length === 0 || machines.length === 0) {
        return {
          assignedMachines: [],
          recentLogs: []
        };
      }

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
      return {
        assignedMachines: [],
        recentLogs: []
      };
    }
  }, [machines, machineLogs, oeeMetrics, user, onError]);

  // 상태 변경 핸들러
  const handleStatusChange = async (machineId: string, newState: MachineState) => {
    try {
      console.log(`설비 ${machineId} 상태를 ${newState}로 변경 중...`);
      
      // API 호출하여 설비 상태 변경
      const response = await fetch(`/api/machines/${machineId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          current_state: newState,
          change_reason: '운영자 수동 변경'
        }),
      });

      const result = await response.json();
      
      if (!response.ok || !result.success) {
        throw new Error(result.message || '상태 변경에 실패했습니다');
      }

      console.log('설비 상태 변경 성공:', result.message);
      setShowStatusInput(false);
      
      // 실시간 데이터 강제 새로고침 (Realtime이 동작하지 않을 경우 대비)
      refresh();
      
    } catch (error: any) {
      console.error('상태 변경 실패:', error);
      // 에러 메시지를 사용자에게 표시 (message는 antd에서 import 필요)
      alert(`상태 변경 실패: ${error.message}`);
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
              {machinesT('operator.title')}
            </h1>
            <p style={{ margin: '4px 0 0 0', color: '#666' }}>
              {machinesT('operator.description')}
              {isConnected && (
                <span style={{ marginLeft: 8, color: '#52c41a' }}>
                  <WifiOutlined /> {machinesT('status.realtimeConnected')}
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
            {machinesT('status.refresh')}
          </Button>
        </Space>
      </div>

      {/* 교대 종료 알림 */}
      {isShiftEnd && (
        <Alert
          message={machinesT('operator.shiftEndAlert')}
          description={machinesT('operator.shiftEndDescription')}
          type="warning"
          showIcon
          action={
            <Button size="small" onClick={() => setShowProductionInput(true)}>
              {machinesT('operator.inputRecord')}
            </Button>
          }
          style={{ marginBottom: 16 }}
        />
      )}

      <Row gutter={[16, 16]}>
        {/* 담당 설비 현황 */}
        <Col xs={24} lg={16}>
          <Card title={machinesT('operator.assignedMachines')} extra={<Badge count={processedData.assignedMachines.length} />}>
            {loading ? (
              <div style={{ textAlign: 'center', padding: '40px 0' }}>
                <span>데이터를 불러오는 중...</span>
              </div>
            ) : processedData.assignedMachines.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '40px 0', color: '#999' }}>
                <span>배정된 설비가 없습니다</span>
              </div>
            ) : (
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
                          {getStateText(machine.current_state!, machinesT)}
                        </span>
                      </div>
                      
                      <div style={{ fontSize: 12, color: '#666', marginBottom: 8 }}>
                        {machinesT('labels.duration')}: {formatDuration(machine.currentDuration, machinesT)}
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
            )}
            
            {/* 상태 변경 버튼 */}
            <div style={{ marginTop: 16, textAlign: 'center' }}>
              <Space>
                <Button 
                  type="primary" 
                  onClick={() => setShowStatusInput(true)}
                  disabled={!selectedMachine}
                >
                  {machinesT('operator.changeState')}
                </Button>
                <Button 
                  onClick={() => setShowProductionInput(true)}
                  disabled={!selectedMachine}
                >
                  {machinesT('operator.inputProduction')}
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
                label: machinesT('operator.recentWork'),
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
                              {getStateText(log.state, machinesT)}
                            </div>
                            <div style={{ color: '#999' }}>
                              {(() => {
                                const date = new Date(log.start_time);
                                const month = date.getMonth() + 1;
                                const day = date.getDate();
                                const hour = date.getHours().toString().padStart(2, '0');
                                const minute = date.getMinutes().toString().padStart(2, '0');
                                return `${month}${machinesT('units.month') || '월'} ${day}${machinesT('units.day') || '일'} ${hour}:${minute}`;
                              })()}
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
                label: machinesT('operator.oeeStatus'),
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
                        {machinesT('operator.selectMachine')}
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
          machine={processedData.assignedMachines.find(m => m.id === selectedMachine) || null}
          visible={showStatusInput}
          onClose={() => setShowStatusInput(false)}
          onStatusChange={handleStatusChange}
          language={(machinesT.i18n?.language as 'ko' | 'vi') || 'ko'}
        />
      )}

      {/* 생산 실적 입력 모달 */}
      {showProductionInput && selectedMachine && (
        <ProductionRecordInput
          machine={processedData.assignedMachines.find(m => m.id === selectedMachine) || null}
          shift="A"
          date={new Date().toISOString().split('T')[0]}
          visible={showProductionInput}
          onClose={() => setShowProductionInput(false)}
          onSubmit={async (data) => {
            console.log('생산 실적 입력:', data);
            setShowProductionInput(false);
          }}
        />
      )}
    </div>
  );
};