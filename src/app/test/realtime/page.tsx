'use client';

import React from 'react';
import { App, Space, Typography } from 'antd';
import { RealtimeTestPanel } from '@/components/machines/RealtimeTestPanel';

const { Title, Paragraph } = Typography;

export default function RealtimeTestPage() {
  return (
    <App>
      <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
        <Space direction="vertical" style={{ width: '100%' }} size="large">
          <div>
            <Title level={2}>실시간 데이터 동기화 테스트</Title>
            <Paragraph>
              이 페이지는 Supabase Realtime을 사용한 실시간 데이터 동기화 기능을 테스트하기 위한 데모입니다.
            </Paragraph>
            <Paragraph>
              <strong>테스트 방법:</strong>
              <ol>
                <li>브라우저에서 새 탭을 열어 이 페이지를 다시 접속하세요</li>
                <li>한쪽 탭에서 설비 상태를 변경하세요</li>
                <li>다른 탭에서 실시간으로 상태가 변경되는지 확인하세요</li>
              </ol>
            </Paragraph>
          </div>
          
          <RealtimeTestPanel />
        </Space>
      </div>
    </App>
  );
}