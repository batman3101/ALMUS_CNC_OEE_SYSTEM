'use client';

import React, { useState } from 'react';
import { Tabs, Card } from 'antd';
import { SettingOutlined, UserOutlined } from '@ant-design/icons';
import { useTranslation } from '@/hooks/useTranslation';
import { RoleGuard } from '@/components/auth';
import { MachineManagement, UserManagement } from '@/components/admin';

const AdminPage: React.FC = () => {
  const { t } = useTranslation();

  const tabItems = [
    {
      key: 'machines',
      label: (
        <span>
          <SettingOutlined />
          설비 관리
        </span>
      ),
      children: <MachineManagement />,
    },
    {
      key: 'users',
      label: (
        <span>
          <UserOutlined />
          사용자 관리
        </span>
      ),
      children: <UserManagement />,
    },
  ];

  return (
    <RoleGuard allowedRoles={['admin']}>
      <div>
        <h1 style={{ marginBottom: '24px' }}>
          사용자 및 설비 관리
        </h1>
        <Tabs
          defaultActiveKey="machines"
          items={tabItems}
          size="large"
        />
      </div>
    </RoleGuard>
  );
};

export default AdminPage;