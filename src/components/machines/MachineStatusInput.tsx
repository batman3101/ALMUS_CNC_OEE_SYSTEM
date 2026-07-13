'use client';

import React, { useState, useEffect } from 'react';
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
  SettingOutlined,
  ExclamationCircleOutlined,
  ClockCircleOutlined,
} from '@ant-design/icons';
import { Machine, MachineState } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import { ko, vi } from 'date-fns/locale';
import { useMachinesTranslation } from '@/hooks/useTranslation';
import { useMachineStatusTranslations } from '@/hooks/useMachineStatusTranslations';
import { supabase } from '@/lib/supabase';

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

// 설비 상태별 아이콘 매핑
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

const MachineStatusInput: React.FC<MachineStatusInputProps> = ({
  machine,
  visible,
  onClose,
  onStatusChange,
  language = 'ko'
}) => {
  const { t, i18n } = useMachinesTranslation();
  const currentLanguage = (i18n?.language as 'ko' | 'vi') || language;
  const { 
    getStatusText, 
    getStatusColorCode, 
    getAntdColorFromHex,
    getAllStatusOptions,
    isLoading: statusLoading 
  } = useMachineStatusTranslations(currentLanguage);
  const [selectedState, setSelectedState] = useState<MachineState | undefined>();
  const [loading, setLoading] = useState(false);
  const [stateStartTime, setStateStartTime] = useState<Date | null>(null);

  // 현재 상태의 시작 시각을 진행 중인 machine_logs 행에서 조회한다.
  // machine.updated_at은 모델/공정 등 상태와 무관한 변경으로도 갱신되므로 사용하지 않는다.
  useEffect(() => {
    let cancelled = false;

    const fetchStateStartTime = async () => {
      if (!visible || !machine?.id || !machine?.current_state) {
        setStateStartTime(null);
        return;
      }

      const { data, error } = await supabase
        .from('machine_logs')
        .select('start_time')
        .eq('machine_id', machine.id)
        .eq('state', machine.current_state)
        .is('end_time', null)
        .order('start_time', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;

      if (error || !data?.start_time) {
        setStateStartTime(null);
        return;
      }

      setStateStartTime(new Date(data.start_time));
    };

    fetchStateStartTime();

    return () => {
      cancelled = true;
    };
  }, [visible, machine?.id, machine?.current_state]);

  // 현재 상태 설정 정보 생성
  const getCurrentStateConfig = () => {
    if (!machine?.current_state) return null;
    
    const colorCode = getStatusColorCode(machine.current_state);
    const text = getStatusText(machine.current_state);
    const color = getAntdColorFromHex(colorCode);
    const icon = getStateIcon(machine.current_state);
    
    return {
      color,
      colorCode,
      icon,
      text,
      description: `${text} 상태입니다` // 기본 설명
    };
  };

  const currentStateConfig = getCurrentStateConfig();

  // 현재 상태 지속 시간 (진행 중인 machine_logs 행 기준, 없으면 표시하지 않음)
  const getCurrentStateDuration = () => {
    if (!stateStartTime) return null;

    return formatDistanceToNow(stateStartTime, {
      addSuffix: true,
      locale: currentLanguage === 'ko' ? ko : vi
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

    const newStateColorCode = getStatusColorCode(selectedState);
    const newStateText = getStatusText(selectedState);
    const newStateColor = getAntdColorFromHex(newStateColorCode);
    const newStateIcon = getStateIcon(selectedState);
    
    const newStateConfig = {
      color: newStateColor,
      colorCode: newStateColorCode,
      icon: newStateIcon,
      text: newStateText
    };
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
                <Tag color={currentStateConfig?.color as string} style={{ marginLeft: 8 }}>
                  {currentStateConfig?.icon} {currentStateConfig?.text}
                </Tag>
              </div>
              <div>
                <Text type="secondary">
                  {t('statusChange.newStateLabel')}
                </Text>
                <Tag color={newStateConfig.color as string} style={{ marginLeft: 8 }}>
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
        } catch {
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
              <Text type="secondary">{machine?.production_model?.model_name || t('statusChange.noModelInfo')}</Text>
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
                  color={currentStateConfig.color as string}
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
              loading={statusLoading}
            >
              {getAllStatusOptions().map(option => (
                <Option key={option.value} value={option.value}>
                  <Space>
                    {getStateIcon(option.value as MachineState)}
                    <span>{option.label}</span>
                  </Space>
                </Option>
              ))}
            </Select>
            
            {selectedState && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  {getStatusText(selectedState)} 상태입니다
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