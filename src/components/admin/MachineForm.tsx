'use client';

import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, InputNumber, Switch, Select, message } from 'antd';
import { useTranslation } from '@/hooks/useTranslation';
import { useAdminOperations } from '@/hooks/useAdminOperations';
import { supabase } from '@/lib/supabase';
import type { Machine } from '@/types';

interface MachineFormProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  machine?: Machine | null;
}

interface MachineFormData {
  name: string;
  location: string;
  equipment_type: string;
  production_model_id: string;
  current_process_id: string;
  is_active: boolean;
}

interface ProductModel {
  id: string;
  model_name: string;
  description: string;
}

interface ModelProcess {
  id: string;
  process_name: string;
  process_order: number;
  tact_time_seconds: number;
}

const MachineForm: React.FC<MachineFormProps> = ({
  visible,
  onCancel,
  onSuccess,
  machine
}) => {
  const { t } = useTranslation();
  const [form] = Form.useForm<MachineFormData>();
  const { loading, createMachine, updateMachine } = useAdminOperations();
  const [productModels, setProductModels] = useState<ProductModel[]>([]);
  const [modelProcesses, setModelProcesses] = useState<ModelProcess[]>([]);
  const [selectedTactTime, setSelectedTactTime] = useState<number>(0);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [processesLoading, setProcessesLoading] = useState(false);

  const isEditing = !!machine;

  // 생산 모델 목록 조회
  const fetchProductModels = async () => {
    try {
      setModelsLoading(true);
      const { data, error } = await supabase
        .from('product_models')
        .select('*')
        .eq('is_active', true)
        .order('model_name');

      if (error) throw error;
      setProductModels(data || []);
    } catch (error) {
      console.error('Error fetching product models:', error);
      message.error('생산 모델 목록을 불러오는데 실패했습니다');
    } finally {
      setModelsLoading(false);
    }
  };

  // 선택된 생산 모델의 공정 목록 조회
  const fetchModelProcesses = async (modelId: string) => {
    try {
      setProcessesLoading(true);
      const { data, error } = await supabase
        .from('model_processes')
        .select('*')
        .eq('model_id', modelId)
        .order('process_order');

      if (error) throw error;
      setModelProcesses(data || []);
      
      // 기존 선택된 공정이 없으면 첫 번째 공정으로 자동 설정
      if (data && data.length > 0 && !form.getFieldValue('current_process_id')) {
        form.setFieldValue('current_process_id', data[0].id);
        setSelectedTactTime(data[0].tact_time_seconds);
      }
    } catch (error) {
      console.error('Error fetching model processes:', error);
      message.error('공정 목록을 불러오는데 실패했습니다');
    } finally {
      setProcessesLoading(false);
    }
  };

  // 모달이 열릴 때 생산 모델 목록 조회
  useEffect(() => {
    if (visible) {
      fetchProductModels();
    }
  }, [visible]);

  // 폼 초기값 설정
  useEffect(() => {
    if (visible && machine) {
      form.setFieldsValue({
        name: machine.name,
        location: machine.location,
        equipment_type: machine.equipment_type || '',
        production_model_id: machine.production_model_id || '',
        current_process_id: machine.current_process_id || '',
        is_active: machine.is_active
      });
      
      // 편집 모드에서 기존 생산 모델의 공정들 로드
      if (machine.production_model_id) {
        fetchModelProcesses(machine.production_model_id);
      }
    } else if (visible) {
      form.resetFields();
      form.setFieldsValue({
        is_active: true
      });
      setModelProcesses([]);
      setSelectedTactTime(0);
    }
  }, [visible, machine, form]);

  // 생산 모델 변경시 공정 목록 업데이트
  const handleProductModelChange = (modelId: string) => {
    form.setFieldValue('current_process_id', '');
    setSelectedTactTime(0);
    if (modelId) {
      fetchModelProcesses(modelId);
    } else {
      setModelProcesses([]);
    }
  };

  // 공정 변경시 Tact Time 업데이트
  const handleProcessChange = (processId: string) => {
    const selectedProcess = modelProcesses.find(p => p.id === processId);
    if (selectedProcess) {
      setSelectedTactTime(selectedProcess.tact_time_seconds);
    }
  };

  const handleSubmit = async (values: MachineFormData) => {
    try {
      if (isEditing && machine) {
        await updateMachine(machine.id, values);
        message.success('설비 정보가 성공적으로 저장되었습니다');
      } else {
        await createMachine(values);
        message.success('설비 정보가 성공적으로 저장되었습니다');
      }

      form.resetFields();
      onSuccess();
    } catch (error) {
      console.error('Error saving machine:', error);
      message.error('설비 정보 저장 중 오류가 발생했습니다');
    }
  };

  return (
    <Modal
      title={isEditing ? '설비 편집' : '설비 추가'}
      open={visible}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={loading}
      width={600}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
        initialValues={{ is_active: true }}
      >
        <Form.Item
          name="name"
          label="설비명"
          rules={[
            { required: true, message: '설비명은 필수입니다' }
          ]}
        >
          <Input placeholder="설비명" />
        </Form.Item>

        <Form.Item
          name="location"
          label="위치"
          rules={[
            { required: true, message: '위치는 필수입니다' }
          ]}
        >
          <Input placeholder="위치" />
        </Form.Item>

        <Form.Item
          name="equipment_type"
          label="설비 타입 (선택사항)"
        >
          <Input placeholder="예: DMG MORI, MAZAK, HAAS 등" />
        </Form.Item>

        <Form.Item
          name="production_model_id"
          label="생산 모델"
          rules={[
            { required: true, message: '생산 모델은 필수입니다' }
          ]}
        >
          <Select
            placeholder="생산 모델을 선택하세요"
            loading={modelsLoading}
            onChange={handleProductModelChange}
            showSearch
            filterOption={(input, option) =>
              (option?.label ?? '').toLowerCase().includes(input.toLowerCase())
            }
            options={productModels.map(model => ({
              value: model.id,
              label: `${model.model_name} - ${model.description}`
            }))}
          />
        </Form.Item>

        <Form.Item
          name="current_process_id"
          label="가공 공정"
          rules={[
            { required: true, message: '가공 공정은 필수입니다' }
          ]}
        >
          <Select
            placeholder="공정을 선택하세요"
            loading={processesLoading}
            onChange={handleProcessChange}
            disabled={modelProcesses.length === 0}
            options={modelProcesses.map(process => ({
              value: process.id,
              label: `${process.process_name} (${process.tact_time_seconds}초)`
            }))}
          />
        </Form.Item>

        {selectedTactTime > 0 && (
          <Form.Item label="Tact Time">
            <Input
              value={`${selectedTactTime}초`}
              disabled
              style={{ backgroundColor: '#f5f5f5' }}
            />
          </Form.Item>
        )}

        <Form.Item
          name="is_active"
          label="상태"
          valuePropName="checked"
        >
          <Switch
            checkedChildren="활성"
            unCheckedChildren="비활성"
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default MachineForm;