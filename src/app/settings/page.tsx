'use client';

import React from 'react';
import { Card, Typography } from 'antd';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import SystemSettings from '@/components/settings/SystemSettings';

const { Title } = Typography;

export default function SettingsPage() {
  const { t } = useLanguage();

  return (
    <ProtectedRoute>
      <div style={{ padding: '24px' }}>
        <Card>
          <Title level={2} style={{ marginBottom: '24px' }}>
            {t('settings.title')}
          </Title>
          <SystemSettings />
        </Card>
      </div>
    </ProtectedRoute>
  );
}