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

const { Title, Text } = Typography;
const { Option } = Select;
const { confirm } = Modal;

interface MachineStatusInputProps {
  machine: Machine;
  visible: boolean;
  onClose: () => void;
  onStatusChange: (machineId: string, newState: MachineState) => Promise<void>;
  language?: 'ko' | 'vi';
}

// 설비 상태별 설정
const getStateConfig = (state: MachineState, language: 'ko' | 'vi' = 'ko') => {
  const configs = {
    NORMAL_OPERATION: {
      color: 'success',
      icon: <PlayCircleOutlined />,
      text: { ko: '정상가동', vi: 'Hoạt động bình thường' },
      description: { 
        ko: '설비가 정상적으로 생산 중입니다', 
        vi: 'Thiết bị đang sản xuất bình thường' 
      }
    },
    MAINTENANCE: {
      color: 'warning',
      icon: <ToolOutlined />,
      text: { ko: '점검중', vi: 'Bảo trì' },
      description: { 
        ko: '계획된 점검 또는 보수 작업 중입니다', 
        vi: 'Đang thực hiện kiểm tra hoặc bảo trì theo kế hoạch' 
      }
    },
    MODEL_CHANGE: {
      color: 'processing',
      icon: <SettingOutlined />,
      text: { ko: '모델교체', vi: 'Thay đổi mô hình' },
      description: { 
        ko: '생산 모델 변경 작업 중입니다', 
        vi: 'Đang thay đổi mô hình sản xuất' 
      }
    },
    PLANNED_STOP: {
      color: 'default',
      icon: <PauseCircleOutlined />,
      text: { ko: '계획정지', vi: 'Dừng theo kế hoạch' },
      description: { 
        ko: '계획된 생산 중단 상태입니다', 
        vi: 'Trạng thái dừng sản xuất theo kế hoạch' 
      }
    },
    PROGRAM_CHANGE: {
      color: 'processing',
      icon: <SettingOutlined />,
      text: { ko: '프로그램 교체', vi: 'Thay đổi chương trình' },
      description: { 
        ko: 'CNC 프로그램 변경 작업 중입니다', 
        vi: 'Đang thay đổi chương trình CNC' 
      }
    },
    TOOL_CHANGE: {
      color: 'processing',
      icon: <ToolOutlined />,
      text: { ko: '공구교환', vi: 'Thay đổi công cụ' },
      description: { 
        ko: '공구 교체 작업 중입니다', 
        vi: 'Đang thay đổi công cụ' 
      }
    },
    TEMPORARY_STOP: {
      color: 'error',
      icon: <WarningOutlined />,
      text: { ko: '일시정지', vi: 'Dừng tạm thời' },
      description: { 
        ko: '예상치 못한 일시 정지 상태입니다', 
        vi: 'Trạng thái dừng tạm thời không mong muốn' 
      }
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
  const [selectedState, setSelectedState] = useState<MachineState | undefined>();
  const [loading, setLoading] = useState(false);

  // 현재 상태 정보
  const currentStateConfig = machine.current_state 
    ? getStateConfig(machine.current_state, language)
    : null;

  // 현재 상태 지속 시간 (임시 계산)
  const getCurrentStateDuration = () => {
    if (!machine.current_state) return null;
    
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
      message.warning(
        language === 'ko' 
          ? '변경할 상태를 선택해주세요' 
          : 'Vui lòng chọn trạng thái cần thay đổi'
      );
      return;
    }

    if (selectedState === machine.current_state) {
      message.info(
        language === 'ko' 
          ? '현재 상태와 동일합니다' 
          : 'Trạng thái giống với trạng thái hiện tại'
      );
      return;
    }

    const newStateConfig = getStateConfig(selectedState, language);
    const currentStateText = currentStateConfig?.text[language] || 
      (language === 'ko' ? '알 수 없음' : 'Không xác định');

    // 상태 변경 확인 모달
    confirm({
      title: language === 'ko' ? '상태 변경 확인' : 'Xác nhận thay đổi trạng thái',
      icon: <ExclamationCircleOutlined />,
      content: (
        <div>
          <p>
            <strong>{machine.name}</strong>{language === 'ko' ? '의 상태를 변경하시겠습니까?' : ' thay đổi trạng thái?'}
          </p>
          <div style={{ margin: '16px 0' }}>
            <Space direction="vertical" size="small">
              <div>
                <Text type="secondary">
                  {language === 'ko' ? '현재 상태:' : 'Trạng thái hiện tại:'}
                </Text>
                <Tag color={currentStateConfig?.color as any} style={{ marginLeft: 8 }}>
                  {currentStateConfig?.icon} {currentStateText}
                </Tag>
              </div>
              <div>
                <Text type="secondary">
                  {language === 'ko' ? '변경할 상태:' : 'Trạng thái mới:'}
                </Text>
                <Tag color={newStateConfig.color as any} style={{ marginLeft: 8 }}>
                  {newStateConfig.icon} {newStateConfig.text[language]}
                </Tag>
              </div>
            </Space>
          </div>
          <Alert
            message={
              language === 'ko' 
                ? '이전 상태가 자동으로 종료되고 새로운 상태가 시작됩니다.' 
                : 'Trạng thái trước sẽ tự động kết thúc và trạng thái mới sẽ bắt đầu.'
            }
            type="info"
            showIcon
            style={{ marginTop: 12 }}
          />
        </div>
      ),
      okText: language === 'ko' ? '변경' : 'Thay đổi',
      cancelText: language === 'ko' ? '취소' : 'Hủy',
      onOk: async () => {
        setLoading(true);
        try {
          await onStatusChange(machine.id, selectedState);
          message.success(
            language === 'ko' 
              ? '상태가 성공적으로 변경되었습니다' 
              : 'Trạng thái đã được thay đổi thành công'
          );
          onClose();
        } catch (error) {
          message.error(
            language === 'ko' 
              ? '상태 변경에 실패했습니다' 
              : 'Thay đổi trạng thái thất bại'
          );
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
          {language === 'ko' ? '설비 상태 변경' : 'Thay đổi trạng thái thiết bị'}
        </Space>
      }
      open={visible}
      onCancel={handleCancel}
      footer={[
        <Button key="cancel" onClick={handleCancel}>
          {language === 'ko' ? '취소' : 'Hủy'}
        </Button>,
        <Button 
          key="submit" 
          type="primary" 
          loading={loading}
          onClick={handleStatusChange}
          disabled={!selectedState}
        >
          {language === 'ko' ? '상태 변경' : 'Thay đổi'}
        </Button>
      ]}
      width={600}
    >
      <Spin spinning={loading}>
        <Space direction="vertical" size="large" style={{ width: '100%' }}>
          {/* 설비 정보 */}
          <div>
            <Title level={4} style={{ margin: 0, marginBottom: 8 }}>
              {machine.name}
            </Title>
            <Space>
              <Text type="secondary">{machine.location}</Text>
              <Divider type="vertical" />
              <Text type="secondary">{machine.model_type}</Text>
            </Space>
          </div>

          {/* 현재 상태 */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {language === 'ko' ? '현재 상태' : 'Trạng thái hiện tại'}
            </Text>
            {currentStateConfig ? (
              <Space direction="vertical" size="small">
                <Tag 
                  color={currentStateConfig.color as any}
                  icon={currentStateConfig.icon}
                  style={{ padding: '4px 12px', fontSize: '14px' }}
                >
                  {currentStateConfig.text[language]}
                </Tag>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  {currentStateConfig.description[language]}
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
                {language === 'ko' ? '상태 정보 없음' : 'Không có thông tin trạng thái'}
              </Text>
            )}
          </div>

          {/* 새로운 상태 선택 */}
          <div>
            <Text strong style={{ display: 'block', marginBottom: 8 }}>
              {language === 'ko' ? '변경할 상태 선택' : 'Chọn trạng thái mới'}
            </Text>
            <Select
              placeholder={
                language === 'ko' 
                  ? '새로운 상태를 선택하세요' 
                  : 'Chọn trạng thái mới'
              }
              value={selectedState}
              onChange={setSelectedState}
              style={{ width: '100%' }}
              size="large"
            >
              {Object.entries(getStateConfig('NORMAL_OPERATION')).map(() => 
                ['NORMAL_OPERATION', 'MAINTENANCE', 'MODEL_CHANGE', 'PLANNED_STOP', 'PROGRAM_CHANGE', 'TOOL_CHANGE', 'TEMPORARY_STOP'].map(state => {
                  const config = getStateConfig(state as MachineState, language);
                  return (
                    <Option key={state} value={state}>
                      <Space>
                        {config.icon}
                        <span>{config.text[language]}</span>
                      </Space>
                    </Option>
                  );
                })
              )}
            </Select>
            
            {selectedState && (
              <div style={{ marginTop: 8 }}>
                <Text type="secondary" style={{ fontSize: '12px' }}>
                  {getStateConfig(selectedState, language).description[language]}
                </Text>
              </div>
            )}
          </div>

          {/* 주의사항 */}
          <Alert
            message={
              language === 'ko' 
                ? '상태 변경 시 주의사항' 
                : 'Lưu ý khi thay đổi trạng thái'
            }
            description={
              language === 'ko' 
                ? '• 현재 진행 중인 상태가 자동으로 종료됩니다\n• 새로운 상태의 시작 시간이 기록됩니다\n• 변경 후에는 되돌릴 수 없습니다' 
                : '• Trạng thái hiện tại sẽ tự động kết thúc\n• Thời gian bắt đầu trạng thái mới sẽ được ghi lại\n• Không thể hoàn tác sau khi thay đổi'
            }
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