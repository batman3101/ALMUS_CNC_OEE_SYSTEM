'use client';

import React from 'react';
import { Typography } from 'antd';
import { useLanguage } from '@/contexts/LanguageContext';
import { ProtectedRoute } from '@/components/auth';
import SystemSettings from '@/components/settings/SystemSettings';

const { Title } = Typography;

export default function SettingsPage() {
  const { t } = useLanguage();

  return (
    <ProtectedRoute>
      <div>
        <Title level={2} style={{ marginBottom: '24px' }}>
          {t('settings.title')}
        </Title>
        <SystemSettings />
      </div>
    </ProtectedRoute>
  );
}