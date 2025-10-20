'use client';

import React from 'react';
import { Typography } from 'antd';
import { useDataInputTranslation } from '@/hooks/useTranslation';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import DataInputForm from '@/components/data-input/DataInputForm';

const { Title, Paragraph } = Typography;

export default function DataInputPage() {
  const { t } = useDataInputTranslation();

  return (
    <ProtectedRoute>
      <div>
        <div style={{ marginBottom: '24px' }}>
          <Title level={2}>
            {t('title')}
          </Title>
          <Paragraph type="secondary">
            {t('description')}
          </Paragraph>
        </div>
        <DataInputForm />
      </div>
    </ProtectedRoute>
  );
}