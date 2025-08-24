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

const { Title, Text } = Typography;

interface MachineDetailModalProps {
  machine: Machine | null;
  visible: boolean;
  onClose: () => void;
  language?: 'ko' | 'vi';
  onMachineUpdated?: () => void;
}

// 설비 상태별 색상 및 텍스트 매핑
const getStateConfig = (state: string) => {
  const configs: Record<string, any> = {
    NORMAL_OPERATION: {
      color: 'success',
      text: '정상가동'
    },
    MAINTENANCE: {
      color: 'warning',
      text: '점검중'
    },
    MODEL_CHANGE: {
      color: 'processing',
      text: '모델교체'
    },
    PLANNED_STOP: {
      color: 'default',
      text: '계획정지'
    },
    PROGRAM_CHANGE: {
      color: 'processing',
      text: '프로그램 교체'
    },
    TOOL_CHANGE: {
      color: 'processing',
      text: '공구교환'
    },
    TEMPORARY_STOP: {
      color: 'error',
      text: '일시정지'
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
  const [editModalVisible, setEditModalVisible] = useState(false);

  if (!machine) return null;

  const stateConfig = getStateConfig(machine.current_state);
  
  // 마지막 업데이트 시간
  const getLastUpdateTime = () => {
    if (!machine.updated_at) return '정보 없음';
    
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
            <span>설비 상세 정보</span>
          </Space>
        }
        open={visible}
        onCancel={onClose}
        width={800}
        footer={[
          <Button key="edit" type="primary" icon={<EditOutlined />} onClick={handleEditClick}>
            설비 정보 수정
          </Button>,
          <Button key="close" onClick={onClose}>
            닫기
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
                    {machine.is_active ? '활성' : '비활성'}
                  </Tag>
                </Space>
              </Col>
              <Col span={8} style={{ textAlign: 'right' }}>
                <Text type="secondary">
                  <ClockCircleOutlined /> 마지막 업데이트: {getLastUpdateTime()}
                </Text>
              </Col>
            </Row>

            <Divider />

            {/* 상세 정보 */}
            <Row gutter={24}>
              <Col span={12}>
                <Card title="기본 정보" size="small">
                  <Descriptions column={1} size="small">
                    <Descriptions.Item label="설비명">
                      <Text strong>{machine.name}</Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="위치">
                      <Space>
                        <EnvironmentOutlined />
                        {machine.location}
                      </Space>
                    </Descriptions.Item>
                    <Descriptions.Item label="설비 유형">
                      {machine.equipment_type || '정보 없음'}
                    </Descriptions.Item>
                    <Descriptions.Item label="활성 상태">
                      {machine.is_active ? (
                        <Tag color="green" icon={<CheckCircleOutlined />}>활성</Tag>
                      ) : (
                        <Tag color="red" icon={<ExclamationCircleOutlined />}>비활성</Tag>
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="등록일">
                      {machine.created_at ? new Date(machine.created_at).toLocaleDateString() : '정보 없음'}
                    </Descriptions.Item>
                  </Descriptions>
                </Card>
              </Col>

              <Col span={12}>
                <Card title="생산 정보" size="small">
                  <Descriptions column={1} size="small">
                    <Descriptions.Item label="현재 상태">
                      <Tag color={stateConfig.color as any}>
                        {stateConfig.text}
                      </Tag>
                    </Descriptions.Item>
                    <Descriptions.Item label="생산 모델">
                      <Text code>
                        {machine.production_model?.model_name || '설정 없음'}
                      </Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="가공 공정">
                      <Text code>
                        {machine.current_process?.process_name || '설정 없음'}
                      </Text>
                    </Descriptions.Item>
                    <Descriptions.Item label="Tact Time">
                      {machine.current_process?.tact_time_seconds ? (
                        <Text strong>{machine.current_process.tact_time_seconds}초</Text>
                      ) : (
                        <Text type="secondary">설정 없음</Text>
                      )}
                    </Descriptions.Item>
                    <Descriptions.Item label="공정 순서">
                      {machine.current_process?.process_order ? (
                        <Text>{machine.current_process.process_order}번째</Text>
                      ) : (
                        <Text type="secondary">설정 없음</Text>
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