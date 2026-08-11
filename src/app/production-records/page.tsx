'use client';

import React from 'react';
import { Typography, App as AntdApp } from 'antd';
import { FileTextOutlined } from '@ant-design/icons';
import ProductionRecordList from '@/components/production/ProductionRecordList';
import CloseShiftQueue from '@/components/production/CloseShiftQueue';
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

      {/*
        마감 대기 큐를 목록 **위**에 둔다. 마감은 기한이 있는 업무(다음날 불량 입력의 선행
        조건)이고, 생산 기록 조회는 아니다. 대기가 없으면 빈 표만 남아 조용히 비켜선다.
      */}
      <CloseShiftQueue />

      <ProductionRecordList />
    </div>
  );
}

// 접근 권한은 `@/lib/pageAccess` 의 표 한 곳에만 있다 (`AppLayout` 이 적용).
export default function ProductionRecordsPage() {
  return (
    <AntdApp>
      <ProductionRecordsContent />
    </AntdApp>
  );
}
