'use client';

import React, { useState } from 'react';
import { Tabs, Typography } from 'antd';
import { SettingOutlined, UserOutlined } from '@ant-design/icons';
import { useTranslation } from '@/hooks/useTranslation';
import { RoleGuard } from '@/components/auth';
import { MachineManagement, UserManagement } from '@/components/admin';

const { Title, Paragraph } = Typography;

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
        <div style={{ marginBottom: '24px' }}>
          <Title level={2}>
            사용자 및 설비 관리
          </Title>
          <Paragraph type="secondary">
            시스템 사용자와 설비를 관리합니다
          </Paragraph>
        </div>
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