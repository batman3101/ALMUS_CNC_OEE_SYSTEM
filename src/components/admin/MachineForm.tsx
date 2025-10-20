'use client';

import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Switch, Select, message } from 'antd';
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
      message.error(t('admin:machineManagement.fetchModelsError'));
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
      message.error(t('admin:machineManagement.fetchProcessesError'));
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
        message.success(t('admin:machineManagement.saveSuccess'));
      } else {
        await createMachine(values);
        message.success(t('admin:machineManagement.saveSuccess'));
      }

      form.resetFields();
      onSuccess();
    } catch (error) {
      console.error('Error saving machine:', error);
      message.error(t('admin:machineManagement.saveError'));
    }
  };

  return (
    <Modal
      title={isEditing ? t('admin:machineManagement.editMachine') : t('admin:machineManagement.addMachine')}
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
          label={t('admin:machineManagement.form.machineName')}
          rules={[
            { required: true, message: t('admin:machineManagement.validation.nameRequired') }
          ]}
        >
          <Input placeholder={t('admin:machineManagement.form.machineName')} />
        </Form.Item>

        <Form.Item
          name="location"
          label={t('admin:machineManagement.form.location')}
          rules={[
            { required: true, message: t('admin:machineManagement.validation.locationRequired') }
          ]}
        >
          <Input placeholder={t('admin:machineManagement.form.location')} />
        </Form.Item>

        <Form.Item
          name="equipment_type"
          label={t('admin:machineManagement.form.equipmentType')}
        >
          <Input placeholder={t('admin:machineManagement.form.equipmentTypePlaceholder')} />
        </Form.Item>

        <Form.Item
          name="production_model_id"
          label={t('admin:machineManagement.form.productionModel')}
          rules={[
            { required: true, message: t('admin:machineManagement.validation.productionModelRequired') }
          ]}
        >
          <Select
            placeholder={t('admin:machineManagement.form.selectProductionModel')}
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
          label={t('admin:machineManagement.form.process')}
          rules={[
            { required: true, message: t('admin:machineManagement.validation.processRequired') }
          ]}
        >
          <Select
            placeholder={t('admin:machineManagement.form.selectProcess')}
            loading={processesLoading}
            onChange={handleProcessChange}
            disabled={modelProcesses.length === 0}
            options={modelProcesses.map(process => ({
              value: process.id,
              label: `${process.process_name} (${t('admin:machineManagement.form.tactTimeSeconds', { seconds: process.tact_time_seconds })})`
            }))}
          />
        </Form.Item>

        {selectedTactTime > 0 && (
          <Form.Item label={t('admin:machineManagement.form.tactTime')}>
            <Input
              value={t('admin:machineManagement.form.tactTimeSeconds', { seconds: selectedTactTime })}
              disabled
              style={{ backgroundColor: '#f5f5f5' }}
            />
          </Form.Item>
        )}

        <Form.Item
          name="is_active"
          label={t('admin:common.status')}
          valuePropName="checked"
        >
          <Switch
            checkedChildren={t('admin:common.active')}
            unCheckedChildren={t('admin:common.inactive')}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
};

export default MachineForm;