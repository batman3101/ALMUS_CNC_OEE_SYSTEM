'use client';

import React from 'react';
import { EngineerDashboard } from '@/components/dashboard';

// 접근 권한은 `@/lib/pageAccess` 의 표 한 곳에만 있다. `AppLayout` 이 모든 페이지에
// 적용하므로 여기서 역할을 다시 적으면 규칙이 둘이 되고 언젠가 한쪽만 바뀐다.
const AnalyticsPage: React.FC = () => {
  return (
    <div>
      <EngineerDashboard />
    </div>
  );
};

export default AnalyticsPage;
