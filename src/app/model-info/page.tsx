'use client';

import React from 'react';
import { Typography } from 'antd';
import { useModelInfoTranslation } from '@/hooks/useTranslation';
import ModelInfoManager from '@/components/model-info/ModelInfoManager';

const { Title, Paragraph } = Typography;

export default function ModelInfoPage() {
  const { t } = useModelInfoTranslation();
  
  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <Title level={2}>
          {t('제목')}
        </Title>
        <Paragraph type="secondary">
          {t('생산모델설명')}
        </Paragraph>
      </div>
      <ModelInfoManager />
    </div>
  );
}