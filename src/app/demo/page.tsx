'use client';

import React from 'react';
import { Card, Typography, Space, Divider } from 'antd';
import { useCommonTranslation, useMachinesTranslation, useDashboardTranslation, useAuthTranslation } from '@/hooks/useTranslation';

const { Title, Text } = Typography;

const DemoPage: React.FC = () => {
  const { t: tCommon } = useCommonTranslation();
  const { t: tMachines } = useMachinesTranslation();
  const { t: tDashboard } = useDashboardTranslation();
  const { t: tAuth } = useAuthTranslation();

  return (
    <div style={{ padding: '24px' }}>
      <Title level={2}>{tCommon('app.title')}</Title>
      <Text type="secondary">다국어 지원 시스템 데모 페이지</Text>
      
      <Divider />
      
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <Card title={tCommon('nav.dashboard')} size="small">
          <Space direction="vertical">
            <Text>{tDashboard('overview')}: {tDashboard('totalMachines')}</Text>
            <Text>{tDashboard('oee.title')}: {tDashboard('oee.availability')}, {tDashboard('oee.performance')}, {tDashboard('oee.quality')}</Text>
            <Text>{tDashboard('production.title')}: {tDashboard('production.actual')} / {tDashboard('production.planned')}</Text>
          </Space>
        </Card>

        <Card title={tCommon('nav.machines')} size="small">
          <Space direction="vertical">
            <Text>{tMachines('labels.machineName')}: CNC-001</Text>
            <Text>{tMachines('labels.currentState')}: {tMachines('states.NORMAL_OPERATION')}</Text>
            <Text>{tMachines('actions.changeState')}: {tMachines('states.MAINTENANCE')}</Text>
          </Space>
        </Card>

        <Card title={tCommon('auth.login')} size="small">
          <Space direction="vertical">
            <Text>{tAuth('login.email')}: admin@example.com</Text>
            <Text>{tAuth('roles.admin')}: {tAuth('roles.adminDescription')}</Text>
            <Text>{tAuth('messages.loginSuccess')}</Text>
          </Space>
        </Card>

        <Card title="Common UI Elements" size="small">
          <Space wrap>
            <Text>{tCommon('app.save')}</Text>
            <Text>{tCommon('app.cancel')}</Text>
            <Text>{tCommon('app.confirm')}</Text>
            <Text>{tCommon('app.delete')}</Text>
            <Text>{tCommon('app.edit')}</Text>
            <Text>{tCommon('app.add')}</Text>
          </Space>
        </Card>
      </Space>
    </div>
  );
};

export default DemoPage;