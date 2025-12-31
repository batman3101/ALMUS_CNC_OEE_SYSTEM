'use client';

import React from 'react';
import {
  Card,
  Button,
  Select,
  Space,
  Typography,
  List,
  Badge,
  App,
  Row,
  Col,
} from 'antd';
import { 
  PlayCircleOutlined, 
  PauseCircleOutlined,
  ToolOutlined,
  SettingOutlined,
  ReloadOutlined
} from '@ant-design/icons';
import { useRealtimeMachines } from '@/hooks/useRealtimeMachines';
import { MachineState } from '@/types';

const { Text } = Typography;
const { Option } = Select;

// 설비 상태 옵션 (데이터베이스 enum 값과 일치)
const machineStates: { value: MachineState; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'NORMAL_OPERATION', label: '정상가동', icon: <PlayCircleOutlined />, color: 'green' },
  { value: 'INSPECTION', label: '검사중', icon: <ToolOutlined />, color: 'orange' },
  { value: 'BREAKDOWN_REPAIR', label: '고장수리', icon: <ToolOutlined />, color: 'red' },
  { value: 'PM_MAINTENANCE', label: '예방정비', icon: <ToolOutlined />, color: 'orange' },
  { value: 'MODEL_CHANGE', label: '모델교체', icon: <SettingOutlined />, color: 'blue' },
  { value: 'PLANNED_STOP', label: '계획정지', icon: <PauseCircleOutlined />, color: 'gray' },
  { value: 'PROGRAM_CHANGE', label: '프로그램교체', icon: <SettingOutlined />, color: 'purple' },
  { value: 'TOOL_CHANGE', label: '공구교환', icon: <ToolOutlined />, color: 'cyan' },
  { value: 'TEMPORARY_STOP', label: '일시정지', icon: <PauseCircleOutlined />, color: 'red' }
];

export const RealtimeTestPanel: React.FC = () => {
  const { message } = App.useApp();
  const { 
    machines, 
    loading, 
    error, 
    refreshMachines, 
    updateMachineStatus 
  } = useRealtimeMachines();

  const handleStatusChange = async (machineId: string, newStatus: MachineState) => {
    console.log('Status change requested:', { machineId, newStatus });
    
    try {
      const success = await updateMachineStatus(machineId, newStatus, '실시간 테스트에서 변경');
      if (success) {
        message.success('설비 상태가 변경되었습니다.');
      } else {
        message.error(`설비 상태 변경에 실패했습니다: ${error || '알 수 없는 오류'}`);
      }
    } catch (err: unknown) {
      console.error('Status change error:', err);
      const errMessage = err instanceof Error ? err.message : '알 수 없는 오류';
      message.error(`오류가 발생했습니다: ${errMessage}`);
    }
  };

  const getStatusBadge = (status: MachineState) => {
    const statusInfo = machineStates.find(s => s.value === status);
    return statusInfo ? (
      <Badge 
        color={statusInfo.color} 
        text={
          <Space>
            {statusInfo.icon}
            {statusInfo.label}
          </Space>
        }
      />
    ) : status;
  };

  if (error) {
    return (
      <Card title="실시간 동기화 테스트" extra={
        <Button icon={<ReloadOutlined />} onClick={refreshMachines}>
          새로고침
        </Button>
      }>
        <div style={{ textAlign: 'center', color: 'red' }}>
          오류: {error}
        </div>
      </Card>
    );
  }

  return (
    <Card 
      title="실시간 동기화 테스트" 
      loading={loading}
      extra={
        <Space>
          <Text type="secondary">총 {machines.length}개 설비</Text>
          <Button 
            icon={<ReloadOutlined />} 
            onClick={refreshMachines}
            loading={loading}
          >
            새로고침
          </Button>
        </Space>
      }
    >
      <div style={{ marginBottom: 16 }}>
        <Text type="secondary">
          설비 상태를 변경하면 실시간으로 다른 브라우저 창에서도 즉시 반영됩니다.
        </Text>
      </div>

      <List
        dataSource={machines.slice(0, 10)} // 처음 10개만 표시
        renderItem={(machine) => (
          <List.Item>
            <Row gutter={16} style={{ width: '100%', alignItems: 'center' }}>
              <Col span={6}>
                <Text strong>{machine.name}</Text>
                <br />
                <Text type="secondary">{machine.location}</Text>
              </Col>
              <Col span={8}>
                {getStatusBadge(machine.current_state)}
              </Col>
              <Col span={10}>
                <Select
                  style={{ width: '100%' }}
                  value={machine.current_state}
                  onChange={(value) => handleStatusChange(machine.id, value)}
                  placeholder="상태 변경"
                >
                  {machineStates.map(state => (
                    <Option key={state.value} value={state.value}>
                      <Space>
                        {state.icon}
                        {state.label}
                      </Space>
                    </Option>
                  ))}
                </Select>
              </Col>
            </Row>
          </List.Item>
        )}
        locale={{ emptyText: '설비가 없습니다.' }}
      />
    </Card>
  );
};