'use client';

import React from 'react';
import { Card, Tag, Typography, Space } from 'antd';
import {
  PlayCircleOutlined,
  PauseCircleOutlined,
  ToolOutlined,
  WarningOutlined,
  ClockCircleOutlined,
  SettingOutlined
} from '@ant-design/icons';
import { Machine, MachineState } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import { ko, vi } from 'date-fns/locale';
import { useMachinesTranslation } from '@/hooks/useTranslation';
import { useMachineStatusTranslations } from '@/hooks/useMachineStatusTranslations';
import { useThemeState } from '@/hooks/useThemeToggle';

const { Text, Title } = Typography;

interface MachineCardProps {
  machine: Machine;
  onClick?: (machine: Machine) => void;
  language?: 'ko' | 'vi';
}

// 설비 상태별 아이콘 매핑 (데이터베이스에서 색상은 가져옴)
const getStateIcon = (state: MachineState) => {
  const iconConfigs = {
    NORMAL_OPERATION: <PlayCircleOutlined />,
    INSPECTION: <ToolOutlined />,
    BREAKDOWN_REPAIR: <WarningOutlined />,
    PM_MAINTENANCE: <ToolOutlined />,
    MODEL_CHANGE: <SettingOutlined />,
    PLANNED_STOP: <PauseCircleOutlined />,
    PROGRAM_CHANGE: <SettingOutlined />,
    TOOL_CHANGE: <ToolOutlined />,
    TEMPORARY_STOP: <WarningOutlined />
  };
  
  return iconConfigs[state] || <WarningOutlined />;
};

const MachineCard: React.FC<MachineCardProps> = ({
  machine,
  onClick,
  language = 'ko'
}) => {
  const { t } = useMachinesTranslation();
  const { isDark } = useThemeState();
  const {
    getStatusText,
    getStatusColorCode,
    getAntdColorFromHex
  } = useMachineStatusTranslations(language);
  
  // 현재 상태의 설정 정보 생성
  const getStateConfig = () => {
    if (!machine.current_state) return null;
    
    const colorCode = getStatusColorCode(machine.current_state);
    const text = getStatusText(machine.current_state);
    const color = getAntdColorFromHex(colorCode);
    const icon = getStateIcon(machine.current_state);
    
    return {
      color,
      colorCode,
      icon,
      text
    };
  };
  
  const stateConfig = getStateConfig();

  const handleCardClick = () => {
    if (onClick) {
      onClick(machine);
    }
  };

  // 상태 지속 시간 계산 (실제 데이터 기반)
  const getStateDuration = () => {
    if (!machine.current_state || !machine.updated_at) return null;
    
    // machine.updated_at을 현재 상태 시작 시간으로 사용
    const stateStartTime = new Date(machine.updated_at);
    
    return formatDistanceToNow(stateStartTime, {
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
        borderLeft: `4px solid ${stateConfig?.colorCode || '#d9d9d9'}`,
        backgroundColor: isDark ? '#1a1a1a' : '#fafafa'
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
              color={stateConfig.color}
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