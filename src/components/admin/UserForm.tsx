'use client';

import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, Transfer, App } from 'antd';
import { useTranslation } from '@/hooks/useTranslation';
import { useAdminOperations } from '@/hooks/useAdminOperations';
import type { User, Machine } from '@/types';

interface UserFormProps {
  visible: boolean;
  onCancel: () => void;
  onSuccess: () => void;
  user?: User | null;
}

interface UserFormData {
  name: string;
  email: string;
  password?: string;
  role: 'admin' | 'operator' | 'engineer';
  assigned_machines: string[];
}

interface TransferItem {
  key: string;
  title: string;
  description: string;
}

const UserForm: React.FC<UserFormProps> = ({
  visible,
  onCancel,
  onSuccess,
  user
}) => {
  const { message } = App.useApp();
  const { t } = useTranslation();
  const [form] = Form.useForm<UserFormData>();
  const { loading, createUser, updateUser, fetchMachines } = useAdminOperations();
  const [machines, setMachines] = useState<Machine[]>([]);
  const [transferData, setTransferData] = useState<TransferItem[]>([]);
  const [targetKeys, setTargetKeys] = useState<string[]>([]);

  const isEditing = !!user;

  useEffect(() => {
    if (visible) {
      loadMachines();
    }
  }, [visible]);

  useEffect(() => {
    if (visible && user) {
      form.setFieldsValue({
        name: user.name,
        email: user.email,
        role: user.role,
      });
      setTargetKeys(user.assigned_machines || []);
    } else if (visible) {
      form.resetFields();
      setTargetKeys([]);
    }
  }, [visible, user, form]);

  const loadMachines = async () => {
    try {
      const data = await fetchMachines();
      const activeMachines = data.filter(machine => machine.is_active);
      
      setMachines(activeMachines);
      const transferItems: TransferItem[] = activeMachines.map(machine => ({
        key: machine.id,
        title: machine.name,
        description: machine.location
      }));
      setTransferData(transferItems);
    } catch (error) {
      console.error('Error fetching machines:', error);
    }
  };

  const handleSubmit = async (values: UserFormData) => {
    try {
      if (isEditing && user) {
        await updateUser(user.id, {
          name: values.name,
          email: values.email,
          role: values.role,
          assigned_machines: values.role === 'operator' ? targetKeys : undefined
        }, user.email);
        message.success('사용자 정보가 성공적으로 저장되었습니다');
      } else {
        await createUser({
          name: values.name,
          email: values.email,
          password: values.password!,
          role: values.role,
          assigned_machines: values.role === 'operator' ? targetKeys : undefined
        });
        message.success('사용자 정보가 성공적으로 저장되었습니다');
      }

      form.resetFields();
      setTargetKeys([]);
      onSuccess();
    } catch (error) {
      console.error('Error saving user:', error);
      message.error('사용자 정보 저장 중 오류가 발생했습니다');
    }
  };

  const handleTransferChange = (newTargetKeys: string[]) => {
    setTargetKeys(newTargetKeys);
  };

  const roleOptions = [
    { value: 'admin', label: '관리자' },
    { value: 'engineer', label: '엔지니어' },
    { value: 'operator', label: '운영자' }
  ];

  const selectedRole = Form.useWatch('role', form);
  const showMachineAssignment = selectedRole === 'operator';

  return (
    <Modal
      title={isEditing ? '사용자 편집' : '사용자 추가'}
      open={visible}
      onCancel={onCancel}
      onOk={() => form.submit()}
      confirmLoading={loading}
      width={800}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        onFinish={handleSubmit}
      >
        <Form.Item
          name="name"
          label="이름"
          rules={[
            { required: true, message: '이름은 필수입니다' }
          ]}
        >
          <Input placeholder="이름" />
        </Form.Item>

        <Form.Item
          name="email"
          label="이메일"
          rules={[
            { required: true, message: '이메일은 필수입니다' },
            { type: 'email', message: '유효한 이메일 주소를 입력하세요' }
          ]}
        >
          <Input placeholder="이메일" />
        </Form.Item>

        {!isEditing && (
          <Form.Item
            name="password"
            label="비밀번호"
            rules={[
              { required: true, message: '비밀번호는 필수입니다' },
              { min: 6, message: '비밀번호는 최소 6자 이상이어야 합니다' }
            ]}
          >
            <Input.Password placeholder="비밀번호" />
          </Form.Item>
        )}

        <Form.Item
          name="role"
          label="역할"
          rules={[
            { required: true, message: '역할을 선택하세요' }
          ]}
        >
          <Select
            placeholder="역할을 선택하세요"
            options={roleOptions}
          />
        </Form.Item>

        {showMachineAssignment && (
          <Form.Item
            label="담당 설비 할당"
          >
            <Transfer
              dataSource={transferData}
              titles={['사용 가능한 설비', '할당된 설비']}
              targetKeys={targetKeys}
              onChange={handleTransferChange}
              render={item => item.title}
              showSearch
              listStyle={{
                width: 300,
                height: 300,
              }}
            />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
};

export default UserForm;