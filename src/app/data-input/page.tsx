'use client';

import React from 'react';
import { Typography } from 'antd';
import { useLanguage } from '@/contexts/LanguageContext';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import DataInputForm from '@/components/data-input/DataInputForm';

const { Title } = Typography;

export default function DataInputPage() {
  const { t } = useLanguage();

  return (
    <ProtectedRoute>
      <div>
        <Title level={2} style={{ marginBottom: '24px' }}>
          {t('dataInput.title')}
        </Title>
        <DataInputForm />
      </div>
    </ProtectedRoute>
  );
}