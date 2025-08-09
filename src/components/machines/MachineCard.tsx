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

const { Text, Title } = Typography;

interface MachineCardProps {
  machine: Machine;
  onClick?: (machine: Machine) => void;
  language?: 'ko' | 'vi';
}

// 설비 상태별 색상 및 아이콘 매핑
const getStateConfig = (state: MachineState) => {
  const configs = {
    NORMAL_OPERATION: {
      color: 'success',
      icon: <PlayCircleOutlined />,
      text: { ko: '정상가동', vi: 'Hoạt động bình thường' }
    },
    MAINTENANCE: {
      color: 'warning',
      icon: <ToolOutlined />,
      text: { ko: '점검중', vi: 'Bảo trì' }
    },
    MODEL_CHANGE: {
      color: 'processing',
      icon: <SettingOutlined />,
      text: { ko: '모델교체', vi: 'Thay đổi mô hình' }
    },
    PLANNED_STOP: {
      color: 'default',
      icon: <PauseCircleOutlined />,
      text: { ko: '계획정지', vi: 'Dừng theo kế hoạch' }
    },
    PROGRAM_CHANGE: {
      color: 'processing',
      icon: <SettingOutlined />,
      text: { ko: '프로그램 교체', vi: 'Thay đổi chương trình' }
    },
    TOOL_CHANGE: {
      color: 'processing',
      icon: <ToolOutlined />,
      text: { ko: '공구교환', vi: 'Thay đổi công cụ' }
    },
    TEMPORARY_STOP: {
      color: 'error',
      icon: <WarningOutlined />,
      text: { ko: '일시정지', vi: 'Dừng tạm thời' }
    }
  };
  
  return configs[state] || configs.TEMPORARY_STOP;
};

const MachineCard: React.FC<MachineCardProps> = ({ 
  machine, 
  onClick,
  language = 'ko' 
}) => {
  const stateConfig = machine.current_state 
    ? getStateConfig(machine.current_state)
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
      actions={[
        <Tooltip key="location" title={language === 'ko' ? '위치' : 'Vị trí'}>
          <Space>
            <EnvironmentOutlined />
            <Text type="secondary">{machine.location}</Text>
          </Space>
        </Tooltip>,
        <Tooltip key="model" title={language === 'ko' ? '모델' : 'Mô hình'}>
          <Text type="secondary">{machine.model_type}</Text>
        </Tooltip>
      ]}
    >
      <div className="machine-card-content">
        <div className="machine-header">
          <Title level={4} style={{ margin: 0, marginBottom: 8 }}>
            {machine.name}
          </Title>
          
          {!machine.is_active && (
            <Tag color="red">
              {language === 'ko' ? '비활성' : 'Không hoạt động'}
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
              {stateConfig.text[language]}
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
                {language === 'ko' ? 'Tact Time:' : 'Thời gian Tact:'}
              </Text>
              <Text strong>{machine.default_tact_time}s</Text>
            </div>
          </Space>
        </div>
      </div>
    </Card>
  );
};

export default MachineCard;