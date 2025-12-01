'use client';

import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, Transfer, App } from 'antd';
import { useTranslation } from '@/hooks/useTranslation';
import { useAdminOperations } from '@/hooks/useAdminOperations';
import type { User } from '@/types';

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
          // 모든 역할에서 담당 설비 저장 가능
          assigned_machines: targetKeys.length > 0 ? targetKeys : []
        }, user.email);
        message.success(t('admin:userManagement.saveSuccess'));
      } else {
        await createUser({
          name: values.name,
          email: values.email,
          password: values.password!,
          role: values.role,
          // 모든 역할에서 담당 설비 저장 가능
          assigned_machines: targetKeys.length > 0 ? targetKeys : []
        });
        message.success(t('admin:userManagement.saveSuccess'));
      }

      form.resetFields();
      setTargetKeys([]);
      onSuccess();
    } catch (error) {
      console.error('Error saving user:', error);
      message.error(t('admin:userManagement.saveError'));
    }
  };

  const handleTransferChange = (newTargetKeys: string[]) => {
    setTargetKeys(newTargetKeys);
  };

  const roleOptions = [
    { value: 'admin', label: t('admin:roles.admin') },
    { value: 'engineer', label: t('admin:roles.engineer') },
    { value: 'operator', label: t('admin:roles.operator') }
  ];

  const selectedRole = Form.useWatch('role', form);
  // 모든 역할에서 담당 설비 할당 항상 표시
  const showMachineAssignment = true;

  return (
    <Modal
      title={isEditing ? t('admin:userManagement.editUser') : t('admin:userManagement.addUser')}
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
          label={t('admin:userManagement.form.name')}
          rules={[
            { required: true, message: t('admin:userManagement.validation.nameRequired') }
          ]}
        >
          <Input placeholder={t('admin:userManagement.form.name')} />
        </Form.Item>

        <Form.Item
          name="email"
          label={t('admin:userManagement.form.email')}
          rules={[
            { required: true, message: t('admin:userManagement.validation.emailRequired') },
            { type: 'email', message: t('admin:userManagement.validation.emailInvalid') }
          ]}
        >
          <Input placeholder={t('admin:userManagement.form.email')} />
        </Form.Item>

        {!isEditing && (
          <Form.Item
            name="password"
            label={t('admin:userManagement.form.password')}
            rules={[
              { required: true, message: t('admin:userManagement.validation.passwordRequired') },
              { min: 6, message: t('admin:userManagement.validation.passwordMinLength') }
            ]}
          >
            <Input.Password placeholder={t('admin:userManagement.form.password')} />
          </Form.Item>
        )}

        <Form.Item
          name="role"
          label={t('admin:userManagement.form.role')}
          rules={[
            { required: true, message: t('admin:userManagement.validation.roleRequired') }
          ]}
        >
          <Select
            placeholder={t('admin:userManagement.form.selectRole')}
            options={roleOptions}
          />
        </Form.Item>

        {showMachineAssignment && (
          <Form.Item
            label={
              <span>
                {t('admin:userManagement.assignMachines')}
                {(selectedRole || user?.role) !== 'operator' && (
                  <span style={{ color: '#999', fontWeight: 'normal', marginLeft: 8 }}>
                    ({t('admin:userManagement.optional') || '선택사항'})
                  </span>
                )}
              </span>
            }
            extra={(selectedRole || user?.role) === 'operator' ? t('admin:userManagement.operatorMachineHint') || '운영자는 할당된 설비만 접근할 수 있습니다.' : undefined}
          >
            <Transfer
              dataSource={transferData}
              titles={[t('admin:userManagement.availableMachines'), t('admin:userManagement.assignedMachines')]}
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