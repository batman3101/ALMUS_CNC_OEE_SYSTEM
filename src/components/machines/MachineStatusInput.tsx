'use client';

import React, { useState } from 'react';
import { 
  Modal, 
  Select, 
  Button, 
  Space, 
  Typography, 
  Alert,
  message,
  Spin,
  Tag,
  Divider
} from 'antd';
import { 
  PlayCircleOutlined, 
  PauseCircleOutlined, 
  ToolOutlined,
  WarningOutlined,
  ClockCircleOutlined,
  SettingOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';
import { Machine, MachineState } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import { ko, vi } from 'date-fns/locale';
import { useMachinesTranslation } from '@/hooks/useTranslation';

const { Title, Text } = Typography;
const { Option } = Select;
const { confirm } = Modal;

interface MachineStatusInputProps {
  machine: Machine | null;
  visible: boolean;
  onClose: () => void;
  onStatusChange: (machineId: string, newState: MachineState) => Promise<void>;
  language?: 'ko' | 'vi';
}

// 설비 상태별 설정 - t 함수를 사용하도록 수정
const getStateConfig = (state: MachineState, t: any) => {
  const configs = {
    NORMAL_OPERATION: {
      color: 'success',
      icon: <PlayCircleOutlined />,
      text: t('status.normalOperation'),
      description: '설비가 정상적으로 생산 중입니다' 
    },
    PM_MAINTENANCE: {
      color: 'warning',
      icon: <ToolOutlined />,
      text: t('status.maintenance'),
      description: '계획된 예방정비 작업 중입니다'
    },
    MAINTENANCE: {
      color: 'warning',
      icon: <ToolOutlined />,
      text: t('status.maintenance'),
      description: '설비 점검 작업 중입니다'
    },
    MODEL_CHANGE: {
      color: 'processing',
      icon: <SettingOutlined />,
      text: t('status.modelChange'),
      description: '생산 모델 변경 작업 중입니다'
    },
    PLANNED_STOP: {
      color: 'default',
      icon: <PauseCircleOutlined />,
      text: t('status.plannedStop'),
      description: '계획된 생산 중단 상태입니다'
    },
    PROGRAM_CHANGE: {
      color: 'processing',
      icon: <SettingOutlined />,
      text: t('status.programChange'),
      description: 'CNC 프로그램 변경 작업 중입니다'
    },
    TOOL_CHANGE: {
      color: 'processing',
      icon: <ToolOutlined />,
      text: t('status.toolChange'),
      description: '공구 교체 작업 중입니다'
    },
    TEMPORARY_STOP: {
      color: 'error',
      icon: <WarningOutlined />,
      text: t('status.temporaryStop'),
      description: '예상치 못한 일시 정지 상태입니다'
    }
  };
  
  return configs[state];
};

const MachineStatusInput: React.FC<MachineStatusInputProps> = ({
  machine,
  visible,
  onClose,
  onStatusChange,
  language = 'ko'
}) => {
  const { t } = useMachinesTranslation();
  const [selectedState, setSelectedState] = useState<MachineState | undefined>();
  const [loading, setLoading] = useState(false);

  // 현재 상태 정보
  const currentStateConfig = machine?.current_state 
    ? getStateConfig(machine.current_state, t)
    : null;

  // 현재 상태 지속 시간 (임시 계산)
  const getCurrentStateDuration = () => {
    if (!machine?.current_state) return null;
    
    // 실제로는 machine_logs에서 현재 상태의 start_time을 가져와야 함
    const now = new Date();
    const mockStartTime = new Date(now.getTime() - Math.random() * 8 * 60 * 60 * 1000);
    
    return formatDistanceToNow(mockStartTime, {
      addSuffix: true,
      locale: language === 'ko' ? ko : vi
    });
  };

  // 상태 변경 처리
  const handleStatusChange = async () => {
    if (!selectedState) {
      message.warning(t('statusChange.selectWarning'));
      return;
    }

    if (selectedState === machine?.current_state) {
      message.info(t('statusChange.sameState'));
      return;
    }

    const newStateConfig = getStateConfig(selectedState, t);
    const currentStateText = currentStateConfig?.text || t('statusChange.unknown');

    // 상태 변경 확인 모달
    confirm({
      title: t('statusChange.confirmTitle'),
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>
            <strong>{machine?.name || t('statusChange.noMachineInfo')}</strong>{t('statusChange.confirmMessage')}
          </p>
          <div style={{ margin: '16px 0' }}>
            <Space direction="vertical" size="small">
              <div>
                <Text type="secondary">
                  {t('statusChange.currentStateLabel')}
                </Text>
                <Tag color={currentStateConfig?.color as any} style={{ marginLeft: 8 }}>
                  {currentStateConfig?.icon} {currentStateConfig?.text}
                </Tag>
              </div>
              <div>
                <Text type="secondary">
                  {t('statusChange.newStateLabel')}
                </Text>
                <Tag color={newStateConfig.color as any} style={{ marginLeft: 8 }}>
                  {newStateConfig.icon} {newStateConfig.text}
                </Tag>
              </div>
            </Space>
          </div>
          <Alert
            message={t('statusChange.warningMessage')}
            type="info"
            showIcon
            style={{ marginTop: 12 }}
          />
        </div>
      ),
      okText: t('statusChange.change'),
      cancelText: t('statusChange.cancel'),
      onOk: async () => {
        setLoading(true);
        try {
          await onStatusChange(machine?.id || '', selectedState);
          message.success(t('statusChange.successMessage'));
          onClose();
        } catch (error) {
          message.error(t('statusChange.errorMessage'));
        } finally {
          setLoading(false);
        }
      }
    });
  };

  const handleCancel = () => {
    setSelectedState(undefined);
    onClose();
  };

  return (
    <Modal
      title={
        <Space>
          <SettingOutlined />
          {t('statusChange.title')}
        </Space>
      }
      open={visible}
      onCancel={handleCancel}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          {t('statusChange.cancel')}
        </Button>,
        <Button 
          key="submit" 
          type="primary" 
          loading={loading}
          onClick={handleStatusChange}
          disabled={!selectedState}
        >
          {t('statusChange.change')}
        </Button>
      ]}
      width={600}
    >
      <Spin spinning={loading}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* 설비 정보 */}
          <div>
            <Title level={4} style={{ margin: 0, marginBottom: 8 }}>
              {machine?.name || t('statusChange.noMachineInfo')}
            </Title>
            <Space>
              <Text type="secondary">{machine?.location || t('statusChange.noLocationInfo')}</Text>
              <Divider type="vertical" />
              <Text type="secondary">{machine?.model_type || t('statusChange.noModelInfo')}</Text>
            </Space>
          </div>

          {/* 현재 상태 */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('statusChange.currentState')}
            </Text>
            {currentStateConfig ? (
              <Space direction="vertical" size="small">
                <Tag 
                  color={currentStateConfig.color as any}
                  icon={currentStateConfig.icon}
                  style={{ padding: '4px 12px', fontSize: '14px' }}
                >
                  {currentStateConfig.text}
                </Tag>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  {currentStateConfig.description}
                </Text>
                {getCurrentStateDuration() && (
                  <Space size="small">
                    <ClockCircleOutlined style={{ color: '#8c8c8c' }} />
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      {getCurrentStateDuration()}
                    </Text>
                  </Space>
                )}
              </Space>
            ) : (
              <Text type="secondary">
                {t('statusChange.noStateInfo')}
              </Text>
            )}
          </div>

          {/* 새로운 상태 선택 */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {t('statusChange.changeState')}
            </Text>
            <Select
              placeholder={t('statusChange.selectPlaceholder')}
              value={selectedState}
              onChange={setSelectedState}
              style={{ width: '100%' }}
              size="large"
            >
              {['NORMAL_OPERATION', 'MAINTENANCE', 'PM_MAINTENANCE', 'MODEL_CHANGE', 'PLANNED_STOP', 'PROGRAM_CHANGE', 'TOOL_CHANGE', 'TEMPORARY_STOP'].map(state => {
                const config = getStateConfig(state as MachineState, t);
                return (
                  <Option key={state} value={state}>
                    <Space>
                      {config.icon}
                      <span>{config.text}</span>
                    </Space>
                  </Option>
                );
              })}
            </Select>
            
            {selectedState && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  {getStateConfig(selectedState, t).description}
                </Text>
              </div>
            )}
          </div>

          {/* 주의사항 */}
          <Alert
            message={t('statusChange.notes')}
            description={`• ${t('statusChange.note1')}\n• ${t('statusChange.note2')}\n• ${t('statusChange.note3')}`}
            type="warning"
            showIcon
            style={{ whiteSpace: 'pre-line' }}
          />
        </Space>
      </Spin>
    </Modal>
  );
};

export default MachineStatusInput;