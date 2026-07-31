'use client';

import React, { useState, useEffect } from 'react';
import { Modal, Form, Input, Select, Transfer, App } from 'antd';
import { useTranslation } from '@/hooks/useTranslation';
import { useAdminOperations } from '@/hooks/useAdminOperations';
import { useAuth } from '@/contexts/AuthContext';
import { assignableRoles, canChangeUserRole, type UserRole } from '@/lib/pageAccess';
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
  const { user: actor } = useAuth();
  const actorRole = actor?.role as UserRole | undefined;
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

  const handleTransferChange = (newTargetKeys: React.Key[]) => {
    setTargetKeys(newTargetKeys.map(String));
  };

  /**
   * 선택 가능한 역할은 **로그인한 사람이 누구인가**에 달려 있다.
   *
   * 관리자(engineer)에게 '시스템 관리자'를 선택지로 주면, 그 계정을 만들어 로그인하는
   * 것으로 자기 등급을 올릴 수 있다 — 역할 변경을 막아 둔 의미가 사라진다. 서버도 같은
   * 규칙(`assertCanManageAccount`)으로 거절하므로 여기서 감추는 것은 **안내**이지
   * 방어가 아니다. 둘 다 `@/lib/pageAccess` 의 같은 함수를 부른다.
   */
  const roleLabels: Record<UserRole, string> = {
    admin: t('admin:roles.admin'),
    engineer: t('admin:roles.engineer'),
    operator: t('admin:roles.operator'),
  };
  const roleOptions = assignableRoles(actorRole).map((role) => ({
    value: role,
    label: roleLabels[role],
  }));

  // 기존 계정의 역할 변경은 시스템 관리자만 할 수 있다. 새 계정 생성은 위 선택지로 이미
  // 좁혀져 있으므로 잠그지 않는다 — 잠그면 관리자가 계정을 아예 만들 수 없다.
  const roleLocked = isEditing && !canChangeUserRole(actorRole);

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
            disabled={roleLocked}
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