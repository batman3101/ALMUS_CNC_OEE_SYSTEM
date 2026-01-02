'use client';

import React, { useState, useEffect } from 'react';
import { 
  Modal, 
  Form, 
  Input, 
  Select, 
  Switch, 
  Button, 
  Space,
  App,
  Row,
  Col,
  Card
} from 'antd';
import { 
  SaveOutlined,
  CloseOutlined
} from '@ant-design/icons';
import { Machine } from '@/types';
import { useMachinesTranslation } from '@/hooks/useTranslation';
import { useMachineStatusTranslations } from '@/hooks/useMachineStatusTranslations';

const { Option } = Select;

interface MachineEditModalProps {
  machine: Machine | null;
  visible: boolean;
  onSuccess: () => void;
  onCancel: () => void;
  language?: 'ko' | 'vi';
}

interface EditFormData {
  name: string;
  location: string;
  equipment_type: string;
  is_active: boolean;
  current_state: string;
  production_model_id: string | null;
  current_process_id: string | null;
}

// 상태별 아이콘 매핑
const getStateIcon = (state: string) => {
  const iconMap: Record<string, React.ReactNode> = {
    NORMAL_OPERATION: '🟢',
    INSPECTION: '🔧', 
    BREAKDOWN_REPAIR: '🚨',
    PM_MAINTENANCE: '⚙️',
    MODEL_CHANGE: '🔄',
    PLANNED_STOP: '⏸️',
    PROGRAM_CHANGE: '💻',
    TOOL_CHANGE: '🔧',
    TEMPORARY_STOP: '⚠️'
  };
  
  return iconMap[state] || '❓';
};

const MachineEditModal: React.FC<MachineEditModalProps> = ({
  machine,
  visible,
  onSuccess,
  onCancel,
  language = 'ko'
}) => {
  const { t, i18n } = useMachinesTranslation();
  const currentLanguage = (i18n?.language as 'ko' | 'vi') || language;
  const {
    getAllStatusOptions,
    isLoading: statusLoading
  } = useMachineStatusTranslations(currentLanguage);
  const { message } = App.useApp();
  const [form] = Form.useForm<EditFormData>();
  const [loading, setLoading] = useState(false);
  interface ProductModel { id: string; model_name: string; tact_time?: number; }
  interface ProcessItem { id: string; process_name: string; tact_time?: number; }
  const [productModels, setProductModels] = useState<ProductModel[]>([]);
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [processesLoading, setProcessesLoading] = useState(false);

  // 생산 모델 목록 가져오기
  const fetchProductModels = async () => {
    try {
      setModelsLoading(true);
      const response = await fetch('/api/product-models');
      if (response.ok) {
        const data = await response.json();
        // API는 배열을 직접 반환함
        setProductModels(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching product models:', error);
    } finally {
      setModelsLoading(false);
    }
  };

  // 공정 목록 가져오기
  const fetchProcesses = async (modelId?: string) => {
    try {
      setProcessesLoading(true);
      
      if (!modelId) {
        setProcesses([]);
        return;
      }

      const response = await fetch(`/api/model-processes?model_id=${modelId}`);
      if (response.ok) {
        const data = await response.json();
        // API는 배열을 직접 반환함
        setProcesses(Array.isArray(data) ? data : []);
      }
    } catch (error) {
      console.error('Error fetching processes:', error);
    } finally {
      setProcessesLoading(false);
    }
  };

  // 모달이 열릴 때 데이터 로드 및 폼 초기화
  useEffect(() => {
    if (visible && machine) {
      // 데이터 먼저 로드
      fetchProductModels();
      
      // 약간의 딜레이 후 폼 값 설정
      setTimeout(() => {
        // 폼 초기값 설정 (생산 모델과 공정은 실제 데이터 기반으로)
        const productionModelId = machine.production_model?.id || machine.product_models?.id || machine.production_model_id;
        const currentProcessId = machine.current_process?.id || machine.model_processes?.id || machine.current_process_id;
        
        form.setFieldsValue({
          name: machine.name,
          location: machine.location,
          equipment_type: machine.equipment_type,
          is_active: machine.is_active,
          current_state: machine.current_state,
          production_model_id: productionModelId,
          current_process_id: currentProcessId
        });

        // 생산 모델이 있으면 해당 모델의 공정들만 다시 로드
        if (productionModelId) {
          fetchProcesses(productionModelId);
        } else {
          setProcesses([]);
        }
      }, 100);
    }
  }, [visible, machine, form]);

  // 생산 모델 변경 시 공정 목록 업데이트
  const handleProductModelChange = (modelId: string) => {
    // 공정 선택 초기화
    form.setFieldValue('current_process_id', null);
    // 새로운 모델의 공정 목록 가져오기
    if (modelId) {
      fetchProcesses(modelId);
    } else {
      setProcesses([]);
    }
  };

  // 폼 제출 처리 (운영 정보만)
  const handleSubmit = async (values: EditFormData) => {
    if (!machine) return;

    try {
      setLoading(true);

      // 운영 정보만 전송
      const operationalData = {
        current_state: values.current_state,
        production_model_id: values.production_model_id,
        current_process_id: values.current_process_id
      };

      const response = await fetch(`/api/machines/${machine.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(operationalData)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}`);
      }

      await response.json();
      message.success(t('edit.successMessage'));
      onSuccess();

    } catch (error: unknown) {
      console.error('Error updating machine:', error);
      const errMessage = error instanceof Error ? error.message : String(error);
      message.error(`${t('edit.errorMessage')}: ${errMessage}`);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onCancel();
  };

  return (
    <Modal
      title={t('edit.title')}
      open={visible}
      onCancel={handleCancel}
      width={800}
      footer={[
        <Button key="cancel" icon={<CloseOutlined />} onClick={handleCancel}>
          {t('common.cancel')}
        </Button>,
        <Button 
          key="submit" 
          type="primary" 
          icon={<SaveOutlined />}
          loading={loading}
          onClick={() => form.submit()}
        >
          {t('common.save')}
        </Button>
      ]}
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        style={{ marginTop: 16 }}
      >
        <Row gutter={24}>
          <Col span={12}>
            <Card title={t('edit.basicInfoReadonly')} size="small" style={{ marginBottom: 16 }}>
              <Form.Item
                name="name"
                label={t('fields.name')}
              >
                <Input disabled placeholder={t('edit.placeholders.name')} />
              </Form.Item>

              <Form.Item
                name="location"
                label={t('fields.location')}
              >
                <Input disabled placeholder={t('edit.placeholders.location')} />
              </Form.Item>

              <Form.Item
                name="equipment_type"
                label={t('fields.equipmentType')}
              >
                <Input disabled placeholder={t('edit.placeholders.equipmentType')} />
              </Form.Item>

              <Form.Item
                name="is_active"
                label={t('fields.activeStatus')}
                valuePropName="checked"
              >
                <Switch 
                  disabled
                  checkedChildren={t('common.active')} 
                  unCheckedChildren={t('common.inactive')}
                />
              </Form.Item>
            </Card>
          </Col>

          <Col span={12}>
            <Card title={t('edit.operationalInfo')} size="small" style={{ marginBottom: 16 }}>
              <Form.Item
                name="current_state"
                label={t('fields.currentStatus')}
                rules={[{ required: true, message: t('edit.validation.selectStatus') }]}
              >
                <Select 
                  placeholder={t('edit.placeholders.status')}
                  loading={statusLoading}
                >
                  {getAllStatusOptions().map(option => (
                    <Option key={option.value} value={option.value}>
                      <Space>
                        {getStateIcon(option.value)}
                        <span>{option.label}</span>
                      </Space>
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                name="production_model_id"
                label={t('fields.productionModel')}
              >
                <Select
                  placeholder={t('edit.placeholders.productionModel')}
                  loading={modelsLoading}
                  allowClear
                  onChange={handleProductModelChange}
                  showSearch
                  optionFilterProp="children"
                >
                  {productModels.map(model => (
                    <Option key={model.id} value={model.id}>
                      {model.model_name}
                      {model.description && (
                        <span style={{ color: '#8c8c8c', fontSize: '12px', marginLeft: '8px' }}>
                          - {model.description}
                        </span>
                      )}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                name="current_process_id"
                label={t('fields.currentProcess')}
              >
                <Select
                  placeholder={t('edit.placeholders.process')}
                  loading={processesLoading}
                  allowClear
                  showSearch
                  optionFilterProp="children"
                >
                  {processes.map(process => (
                    <Option key={process.id} value={process.id}>
                      {process.process_name}
                      {process.process_order && (
                        <span style={{ color: '#8c8c8c', fontSize: '12px', marginLeft: '8px' }}>
                          - {process.process_order}{t('units.orderSuffix')}
                        </span>
                      )}
                      {process.tact_time_seconds && (
                        <span style={{ color: '#8c8c8c', fontSize: '12px', marginLeft: '8px' }}>
                          ({process.tact_time_seconds}s)
                        </span>
                      )}
                    </Option>
                  ))}
                </Select>
              </Form.Item>
            </Card>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
};

export default MachineEditModal;