'use client';

import React from 'react';
import { Typography } from 'antd';
import ModelInfoManager from '@/components/model-info/ModelInfoManager';

const { Title, Paragraph } = Typography;

export default function ModelInfoPage() {
  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <Title level={2}>
          모델 정보 관리
        </Title>
        <Paragraph type="secondary">
          제품 모델 정보를 관리합니다
        </Paragraph>
      </div>
      <ModelInfoManager />
    </div>
  );
}