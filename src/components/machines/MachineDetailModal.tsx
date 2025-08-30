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
import { ko } from 'date-fns/locale';
import MachineEditModal from './MachineEditModal';
import { useMachinesTranslation } from '@/hooks/useTranslation';

const { Title, Text } = Typography;

interface MachineDetailModalProps {
  machine: Machine | null;
  visible: boolean;
  onClose: () => void;
  language?: 'ko' | 'vi';
  onMachineUpdated?: () => void;
}

// 설비 상태별 색상 및 텍스트 매핑
const getStateConfig = (state: string, t: any) => {
  const configs: Record<string, any> = {
    NORMAL_OPERATION: {
      color: 'success',
      text: t('status.normalOperation')
    },
    MAINTENANCE: {
      color: 'warning',
      text: t('status.maintenance')
    },
    MODEL_CHANGE: {
      color: 'processing',
      text: t('status.modelChange')
    },
    PLANNED_STOP: {
      color: 'default',
      text: t('status.plannedStop')
    },
    PROGRAM_CHANGE: {
      color: 'processing',
      text: t('status.programChange')
    },
    TOOL_CHANGE: {
      color: 'processing',
      text: t('status.toolChange')
    },
    TEMPORARY_STOP: {
      color: 'error',
      text: t('status.temporaryStop')
    }
  };
  
  return configs[state] || { color: 'default', text: state };
};

const MachineDetailModal: React.FC<MachineDetailModalProps> = ({
  machine,
  visible,
  onClose,
  language = 'ko',
  onMachineUpdated
}) => {
  const { t } = useMachinesTranslation();
  const [editModalVisible, setEditModalVisible] = useState(false);

  if (!machine) return null;

  const stateConfig = getStateConfig(machine.current_state, t);
  
  // 마지막 업데이트 시간
  const getLastUpdateTime = () => {
    if (!machine.updated_at) return t('common.noInfo');
    
    return formatDistanceToNow(new Date(machine.updated_at), {
      addSuffix: true,
      locale: ko
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
                  <Tag 
                    color={stateConfig.color as any}
                    style={{ fontSize: '14px', padding: '4px 12px' }}
                  >
                    {stateConfig.text}
                  </Tag>
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
                      <Tag color={stateConfig.color as any}>
                        {stateConfig.text}
                      </Tag>
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
      />
    </>
  );
};

export default MachineDetailModal;