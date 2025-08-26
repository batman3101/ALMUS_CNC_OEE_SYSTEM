'use client';

import React, { useState } from 'react';
import { Tabs, Typography } from 'antd';
import { SettingOutlined, UserOutlined } from '@ant-design/icons';
import { useAdminTranslation } from '@/hooks/useTranslation';
import { RoleGuard } from '@/components/auth';
import { MachineManagement, UserManagement } from '@/components/admin';

const { Title, Paragraph } = Typography;

const AdminPage: React.FC = () => {
  const { t } = useAdminTranslation();

  const tabItems = [
    {
      key: 'machines',
      label: (
        <span>
          <SettingOutlined />
          {t('page.tabs.machineManagement')}
        </span>
      ),
      children: <MachineManagement />,
    },
    {
      key: 'users',
      label: (
        <span>
          <UserOutlined />
          {t('page.tabs.userManagement')}
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
            {t('page.title')}
          </Title>
          <Paragraph type="secondary">
            {t('page.description')}
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