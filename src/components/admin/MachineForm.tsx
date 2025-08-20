'use client';

import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, InputNumber, Switch, Select, message } from 'antd';
import { useTranslation } from '@/hooks/useTranslation';
import { useAdminOperations } from '@/hooks/useAdminOperations';
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
  model_type: string;
  processing_step: string;
  default_tact_time: number;
  is_active: boolean;
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

  const isEditing = !!machine;

  useEffect(() => {
    if (visible && machine) {
      form.setFieldsValue({
        name: machine.name,
        location: machine.location,
        model_type: machine.model_type,
        processing_step: machine.processing_step,
        default_tact_time: machine.default_tact_time,
        is_active: machine.is_active
      });
    } else if (visible) {
      form.resetFields();
      form.setFieldsValue({
        is_active: true
      });
    }
  }, [visible, machine, form]);

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
          name="model_type"
          label="모델 타입"
          rules={[
            { required: true, message: '모델은 필수입니다' }
          ]}
        >
          <Input placeholder="모델 타입" />
        </Form.Item>

        <Form.Item
          name="processing_step"
          label="가공 공정"
          rules={[
            { required: true, message: '가공 공정은 필수입니다' }
          ]}
        >
          <Select placeholder="가공 공정을 선택하세요">
            <Select.Option value="1 공정">1 공정</Select.Option>
            <Select.Option value="2 공정">2 공정</Select.Option>
            <Select.Option value="3 공정">3 공정</Select.Option>
            <Select.Option value="4 공정">4 공정</Select.Option>
          </Select>
        </Form.Item>

        <Form.Item
          name="default_tact_time"
          label="Tact Time (초)"
          rules={[
            { required: true, message: 'Tact Time은 필수입니다' },
            { type: 'number', min: 1, message: 'Tact Time은 양수여야 합니다' }
          ]}
        >
          <InputNumber
            min={1}
            style={{ width: '100%' }}
            placeholder="60"
          />
        </Form.Item>

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