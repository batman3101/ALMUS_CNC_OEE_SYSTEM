'use client';

import React from 'react';
import { Tabs, Typography } from 'antd';
import { SettingOutlined, UserOutlined } from '@ant-design/icons';
import { useAdminTranslation } from '@/hooks/useTranslation';
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

  // 접근 권한은 `@/lib/pageAccess` 의 표 한 곳에만 있다 (`AppLayout` 이 적용).
  // 탭 안에서 무엇을 할 수 있는지는 UserManagement 가 같은 모듈의 권한 함수로 판단한다 —
  // 관리자(engineer)는 계정을 만들고 지울 수 있지만 역할을 바꾸지는 못한다.
  return (
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
  );
};

export default AdminPage;