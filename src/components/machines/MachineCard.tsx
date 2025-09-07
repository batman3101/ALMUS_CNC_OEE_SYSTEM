'use client';

import React from 'react';
import { Card, Tag, Typography, Space, Tooltip } from 'antd';
import { 
  PlayCircleOutlined, 
  PauseCircleOutlined, 
  ToolOutlined,
  WarningOutlined,
  ClockCircleOutlined,
  EnvironmentOutlined,
  SettingOutlined
} from '@ant-design/icons';
import { Machine, MachineState } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import { ko, vi } from 'date-fns/locale';
import { useMachinesTranslation } from '@/hooks/useTranslation';

const { Text, Title } = Typography;

interface MachineCardProps {
  machine: Machine;
  onClick?: (machine: Machine) => void;
  language?: 'ko' | 'vi';
}

// 설비 상태별 색상 및 아이콘 매핑
const getStateConfig = (state: MachineState, t: any) => {
  const configs = {
    NORMAL_OPERATION: {
      color: 'success',
      icon: <PlayCircleOutlined />,
      text: t('status.normalOperation')
    },
    MAINTENANCE: {
      color: 'warning',
      icon: <ToolOutlined />,
      text: t('status.maintenance')
    },
    PM_MAINTENANCE: {
      color: 'warning',
      icon: <ToolOutlined />,
      text: t('status.maintenance')
    },
    INSPECTION: {
      color: 'warning',
      icon: <ToolOutlined />,
      text: t('status.inspection')
    },
    BREAKDOWN_REPAIR: {
      color: 'error',
      icon: <WarningOutlined />,
      text: t('status.breakdownRepair')
    },
    MODEL_CHANGE: {
      color: 'processing',
      icon: <SettingOutlined />,
      text: t('status.modelChange')
    },
    PLANNED_STOP: {
      color: 'default',
      icon: <PauseCircleOutlined />,
      text: t('status.plannedStop')
    },
    PROGRAM_CHANGE: {
      color: 'processing',
      icon: <SettingOutlined />,
      text: t('status.programChange')
    },
    TOOL_CHANGE: {
      color: 'processing',
      icon: <ToolOutlined />,
      text: t('status.toolChange')
    },
    TEMPORARY_STOP: {
      color: 'error',
      icon: <WarningOutlined />,
      text: t('status.temporaryStop')
    }
  };
  
  return configs[state] || { color: 'default', icon: <WarningOutlined />, text: t('status.unknown') };
};

const MachineCard: React.FC<MachineCardProps> = ({ 
  machine, 
  onClick,
  language = 'ko' 
}) => {
  const { t } = useMachinesTranslation();
  
  const stateConfig = machine.current_state 
    ? getStateConfig(machine.current_state, t)
    : null;

  const handleCardClick = () => {
    if (onClick) {
      onClick(machine);
    }
  };

  // 상태 지속 시간 계산 (임시로 현재 시간 기준)
  const getStateDuration = () => {
    if (!machine.current_state) return null;
    
    // 실제로는 machine_logs에서 현재 상태의 start_time을 가져와야 함
    const now = new Date();
    const mockStartTime = new Date(now.getTime() - Math.random() * 8 * 60 * 60 * 1000); // 0-8시간 전
    
    return formatDistanceToNow(mockStartTime, {
      addSuffix: true,
      locale: language === 'ko' ? ko : vi
    });
  };

  return (
    <Card
      hoverable
      onClick={handleCardClick}
      className="machine-card"
      style={{ 
        borderLeft: `4px solid ${
          stateConfig?.color === 'success' ? '#52c41a' :
          stateConfig?.color === 'warning' ? '#faad14' :
          stateConfig?.color === 'error' ? '#ff4d4f' :
          stateConfig?.color === 'processing' ? '#1890ff' :
          '#d9d9d9'
        }`
      }}
      actions={[]}
    >
      <div className="machine-card-content">
        <div className="machine-header">
          <Title level={4} style={{ margin: 0, marginBottom: 8 }}>
            {machine.name}
          </Title>
          
          {!machine.is_active && (
            <Tag color="red">
              {t('common.inactive')}
            </Tag>
          )}
        </div>

        {stateConfig && (
          <div className="machine-status" style={{ marginBottom: 12 }}>
            <Tag 
              color={stateConfig.color as any}
              icon={stateConfig.icon}
              style={{ marginBottom: 8 }}
            >
              {stateConfig.text}
            </Tag>
            
            {getStateDuration() && (
              <div>
                <Space size="small">
                  <ClockCircleOutlined style={{ color: '#8c8c8c' }} />
                  <Text type="secondary" style={{ fontSize: '12px' }}>
                    {getStateDuration()}
                  </Text>
                </Space>
              </div>
            )}
          </div>
        )}

        <div className="machine-info">
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            <div className="info-row">
              <Text type="secondary">
                {t('fields.productionModel')}:
              </Text>
              <Text strong>
                {machine.production_model?.model_name || t('common.notSet')}
              </Text>
            </div>
            <div className="info-row">
              <Text type="secondary">
                {t('fields.currentProcess')}:
              </Text>
              <Text strong>
                {machine.current_process?.process_name || t('common.notSet')}
              </Text>
            </div>
          </Space>
        </div>
      </div>
    </Card>
  );
};

export default MachineCard;