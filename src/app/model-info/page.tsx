'use client';

import React from 'react';
import { Card, Typography } from 'antd';
import ModelInfoManager from '@/components/model-info/ModelInfoManager';

const { Title } = Typography;

export default function ModelInfoPage() {
  return (
    <div style={{ padding: '24px' }}>
      <Card>
        <Title level={2} style={{ marginBottom: '24px' }}>
          모델 정보 관리
        </Title>
        <ModelInfoManager />
      </Card>
    </div>
  );
}