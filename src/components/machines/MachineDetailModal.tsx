'use client';

import React, { useState } from 'react';
import { 
  Modal, 
  Descriptions, 
  Tag, 
  Button, 
  Space, 
  Typography,
  Card,
  Row,
  Col,
  Divider
} from 'antd';
import { 
  EditOutlined,
  EnvironmentOutlined,
  SettingOutlined,
  ClockCircleOutlined,
  CheckCircleOutlined,
  ExclamationCircleOutlined
} from '@ant-design/icons';
import { Machine } from '@/types';
import { formatDistanceToNow } from 'date-fns';
import { ko, vi } from 'date-fns/locale';
import MachineEditModal from './MachineEditModal';
import { useMachinesTranslation } from '@/hooks/useTranslation';
import { useMachineStatusTranslations } from '@/hooks/useMachineStatusTranslations';

const { Title, Text } = Typography;

interface MachineDetailModalProps {
  machine: Machine | null;
  visible: boolean;
  onClose: () => void;
  language?: 'ko' | 'vi';
  onMachineUpdated?: () => void;
}

// 설비 상태별 아이콘 매핑 (데이터베이스에서 색상은 가져옴)
const getStateIcon = (state: string) => {
  const iconConfigs: Record<string, React.ReactNode> = {
    NORMAL_OPERATION: <CheckCircleOutlined />,
    INSPECTION: <SettingOutlined />,
    BREAKDOWN_REPAIR: <ExclamationCircleOutlined />,
    PM_MAINTENANCE: <SettingOutlined />,
    MODEL_CHANGE: <SettingOutlined />,
    PLANNED_STOP: <ClockCircleOutlined />,
    PROGRAM_CHANGE: <SettingOutlined />,
    TOOL_CHANGE: <SettingOutlined />,
    TEMPORARY_STOP: <ExclamationCircleOutlined />
  };
  
  return iconConfigs[state] || <ExclamationCircleOutlined />;
};

const MachineDetailModal: React.FC<MachineDetailModalProps> = ({
  machine,
  visible,
  onClose,
  language = 'ko',
  onMachineUpdated
}) => {
  const { t, i18n } = useMachinesTranslation();
  const currentLanguage = (i18n?.language as 'ko' | 'vi') || language;
  const {
    getStatusText,
    getStatusColorCode,
    getAntdColorFromHex
  } = useMachineStatusTranslations(currentLanguage);
  const [editModalVisible, setEditModalVisible] = useState(false);

  if (!machine) return null;

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
  
  // 마지막 업데이트 시간
  const getLastUpdateTime = () => {
    if (!machine.updated_at) return t('common.noInfo');
    
    return formatDistanceToNow(new Date(machine.updated_at), {
      addSuffix: true,
      locale: currentLanguage === 'ko' ? ko : vi
    });
  };

  const handleEditClick = () => {
    setEditModalVisible(true);
  };

  const handleEditSuccess = () => {
    setEditModalVisible(false);
    if (onMachineUpdated) {
      onMachineUpdated();
    }
  };

  const handleEditCancel = () => {
    setEditModalVisible(false);
  };

  return (
    <>
      <Modal
        title={
          <Space>
            <SettingOutlined />
            <span>{t('detail.title')}</span>
          </Space>
        }
        open={visible}
        onCancel={onClose}
        width={800}
        footer={[
          <Button key="edit" type="primary" icon={<EditOutlined />} onClick={handleEditClick}>
            {t('detail.editButton')}
          </Button>,
          <Button key="close" onClick={onClose}>
            {t('common.close')}
          </Button>
        ]}
      >
        {machine && (
          <div style={{ padding: '16px 0' }}>
            {/* 기본 정보 헤더 */}
            <Row gutter={24} style={{ marginBottom: 24 }}>
              <Col span={16}>
                <Title level={3} style={{ margin: 0 }}>
                  {machine.name}
                </Title>
                <Space style={{ marginTop: 8 }}>
                  {stateConfig && (
                    <Tag
                      color={stateConfig.color}
                      style={{ fontSize: '14px', padding: '4px 12px' }}
                      icon={stateConfig.icon}
                    >
                      {stateConfig.text}
                    </Tag>
                  )}
                  <Tag color={machine.is_active ? 'green' : 'red'}>
                    {machine.is_active ? t('common.active') : t('common.inactive')}
                  </Tag>
                </Space>
              </Col>
              <Col span={8} style={{ textAlign: 'right' }}>
                <Text type="secondary">
                  <ClockCircleOutlined /> {t('detail.lastUpdate')}: {getLastUpdateTime()}
                </Text>
              </Col>
            </Row>

            <Divider />

            {/* 상세 정보 */}
            <Row gutter={24}>
              <Col span={12}>
                <Card title={t('detail.basicInfo')} size="small">
                  <Descriptions column={1} size="small">
                    <Descriptions.Item label={t('fields.name')}>
                      <Text strong>{machine.name}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label={t('fields.location')}>
                      <Space>
                        <EnvironmentOutlined />
                        {machine.location}
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label={t('fields.equipmentType')}>
                      {machine.equipment_type || t('common.noInfo')}
                    </Descriptions.Item>
                    <Descriptions.Item label={t('fields.activeStatus')}>
                      {machine.is_active ? (
                        <Tag color="green" icon={<CheckCircleOutlined />}>{t('common.active')}</Tag>
                      ) : (
                        <Tag color="red" icon={<ExclamationCircleOutlined />}>{t('common.inactive')}</Tag>
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label={t('fields.registrationDate')}>
                      {machine.created_at ? new Date(machine.created_at).toLocaleDateString() : t('common.noInfo')}
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              </Col>

              <Col span={12}>
                <Card title={t('detail.productionInfo')} size="small">
                  <Descriptions column={1} size="small">
                    <Descriptions.Item label={t('fields.currentStatus')}>
                      {stateConfig && (
                        <Tag color={stateConfig.color} icon={stateConfig.icon}>
                          {stateConfig.text}
                        </Tag>
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label={t('fields.productionModel')}>
                      <Text code>
                        {machine.production_model?.model_name || t('common.notSet')}
                      </Text>
                    </Descriptions.Item>
                    <Descriptions.Item label={t('fields.currentProcess')}>
                      <Text code>
                        {machine.current_process?.process_name || t('common.notSet')}
                      </Text>
                    </Descriptions.Item>
                    <Descriptions.Item label={t('fields.tactTime')}>
                      {machine.current_process?.tact_time_seconds ? (
                        <Text strong>{machine.current_process.tact_time_seconds}{t('units.seconds')}</Text>
                      ) : (
                        <Text type="secondary">{t('common.notSet')}</Text>
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label={t('fields.processOrder')}>
                      {machine.current_process?.process_order ? (
                        <Text>{machine.current_process.process_order}{t('units.orderSuffix')}</Text>
                      ) : (
                        <Text type="secondary">{t('common.notSet')}</Text>
                      )}
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              </Col>
            </Row>

          </div>
        )}
      </Modal>

      {/* 설비 정보 수정 모달 */}
      <MachineEditModal
        machine={machine}
        visible={editModalVisible}
        onSuccess={handleEditSuccess}
        onCancel={handleEditCancel}
        language={currentLanguage}
      />
    </>
  );
};

export default MachineDetailModal;