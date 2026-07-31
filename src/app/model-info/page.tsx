'use client';

import React from 'react';
import { Typography } from 'antd';
import { useModelInfoTranslation } from '@/hooks/useTranslation';
import ModelInfoManager from '@/components/model-info/ModelInfoManager';

const { Title, Paragraph } = Typography;

// 접근 권한은 `@/lib/pageAccess` 의 표 한 곳에만 있다 (`AppLayout` 이 적용).
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