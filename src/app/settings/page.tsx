'use client';

import React from 'react';
import { Typography } from 'antd';
import { useLanguage } from '@/contexts/LanguageContext';
import { ProtectedRoute } from '@/components/auth';
import SystemSettings from '@/components/settings/SystemSettings';

const { Title, Paragraph } = Typography;

export default function SettingsPage() {
  const { t } = useLanguage();

  return (
    <ProtectedRoute>
      <div>
        <div style={{ marginBottom: '24px' }}>
          <Title level={2}>
            설정
          </Title>
          <Paragraph type="secondary">
            {t('settings.systemSettings')}
          </Paragraph>
        </div>
        <SystemSettings />
      </div>
    </ProtectedRoute>
  );
}