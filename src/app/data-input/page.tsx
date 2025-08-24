'use client';

import React from 'react';
import { Typography } from 'antd';
import { useLanguage } from '@/contexts/LanguageContext';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import DataInputForm from '@/components/data-input/DataInputForm';

const { Title, Paragraph } = Typography;

export default function DataInputPage() {
  const { t } = useLanguage();

  return (
    <ProtectedRoute>
      <div>
        <div style={{ marginBottom: '24px' }}>
          <Title level={2}>
            데이터 입력
          </Title>
          <Paragraph type="secondary">
            {t('dataInput.title')}
          </Paragraph>
        </div>
        <DataInputForm />
      </div>
    </ProtectedRoute>
  );
}