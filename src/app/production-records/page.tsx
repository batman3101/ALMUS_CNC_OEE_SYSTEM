'use client';

import React from 'react';
import { Typography, App as AntdApp } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import ProductionRecordList from '@/components/production/ProductionRecordList';
import ProtectedRoute from '@/components/auth/ProtectedRoute';
import { useDataInputTranslation } from '@/hooks/useTranslation';

const { Title, Text } = Typography;

function ProductionRecordsContent() {
  const { t } = useDataInputTranslation();

  return (
    <div style={{ padding: '24px' }}>
      <div style={{ marginBottom: 24 }}>
        <Title level={2} style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 12 }}>
          <FileTextOutlined />
          {t('recordList.title')}
        </Title>
        <Text type="secondary">
          {t('recordList.description')}
        </Text>
      </div>

      <ProductionRecordList />
    </div>
  );
}

export default function ProductionRecordsPage() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'engineer', 'operator']}>
      <AntdApp>
        <ProductionRecordsContent />
      </AntdApp>
    </ProtectedRoute>
  );
}
