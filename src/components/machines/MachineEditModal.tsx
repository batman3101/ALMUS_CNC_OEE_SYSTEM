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

const { Option } = Select;

interface MachineEditModalProps {
  machine: Machine | null;
  visible: boolean;
  onSuccess: () => void;
  onCancel: () => void;
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

// 설비 상태 옵션
const machineStates = [
  { value: 'NORMAL_OPERATION', label: '정상가동' },
  { value: 'MAINTENANCE', label: '점검중' },
  { value: 'MODEL_CHANGE', label: '모델교체' },
  { value: 'PLANNED_STOP', label: '계획정지' },
  { value: 'PROGRAM_CHANGE', label: '프로그램 교체' },
  { value: 'TOOL_CHANGE', label: '공구교환' },
  { value: 'TEMPORARY_STOP', label: '일시정지' }
];

const MachineEditModal: React.FC<MachineEditModalProps> = ({
  machine,
  visible,
  onSuccess,
  onCancel
}) => {
  const { message } = App.useApp();
  const [form] = Form.useForm<EditFormData>();
  const [loading, setLoading] = useState(false);
  const [productModels, setProductModels] = useState<any[]>([]);
  const [processes, setProcesses] = useState<any[]>([]);
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

      const result = await response.json();
      message.success('설비 운영 정보가 성공적으로 수정되었습니다');
      onSuccess();

    } catch (error: any) {
      console.error('Error updating machine:', error);
      message.error(`설비 정보 수정 실패: ${error.message}`);
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
      title="설비 정보 수정"
      open={visible}
      onCancel={handleCancel}
      width={800}
      footer={[
        <Button key="cancel" icon={<CloseOutlined />} onClick={handleCancel}>
          취소
        </Button>,
        <Button 
          key="submit" 
          type="primary" 
          icon={<SaveOutlined />}
          loading={loading}
          onClick={() => form.submit()}
        >
          저장
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
            <Card title="기본 정보 (수정 불가)" size="small" style={{ marginBottom: 16 }}>
              <Form.Item
                name="name"
                label="설비명"
              >
                <Input disabled placeholder="예: CNC-001" />
              </Form.Item>

              <Form.Item
                name="location"
                label="위치"
              >
                <Input disabled placeholder="예: 1공장 A라인" />
              </Form.Item>

              <Form.Item
                name="equipment_type"
                label="설비 유형"
              >
                <Input disabled placeholder="예: CNC 머시닝센터" />
              </Form.Item>

              <Form.Item
                name="is_active"
                label="활성 상태"
                valuePropName="checked"
              >
                <Switch 
                  disabled
                  checkedChildren="활성" 
                  unCheckedChildren="비활성"
                />
              </Form.Item>
            </Card>
          </Col>

          <Col span={12}>
            <Card title="운영 정보" size="small" style={{ marginBottom: 16 }}>
              <Form.Item
                name="current_state"
                label="현재 상태"
                rules={[{ required: true, message: '현재 상태를 선택하세요' }]}
              >
                <Select placeholder="상태를 선택하세요">
                  {machineStates.map(state => (
                    <Option key={state.value} value={state.value}>
                      {state.label}
                    </Option>
                  ))}
                </Select>
              </Form.Item>

              <Form.Item
                name="production_model_id"
                label="생산 모델"
              >
                <Select
                  placeholder="생산 모델을 선택하세요"
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
                label="가공 공정"
              >
                <Select
                  placeholder="가공 공정을 선택하세요"
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
                          - {process.process_order}번째
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