'use client';

import React from 'react';
import { OperatorDashboard } from '@/components/dashboard';

/**
 * 운영자 콘솔.
 *
 * `DashboardRouter` 는 `user.role` 로 화면을 고르므로, 이 URL 이 없으면 운영자가 아닌
 * 사람은 운영자 화면에 도달할 방법이 없다(관리자가 자기 시스템의 한 화면을 열어볼 수
 * 없으면 유지보수를 할 수 없다). 반대로 예전에는 이 페이지가 `admin` 전용이라
 * **운영자 본인**이 메뉴에서도 URL 에서도 자기 콘솔에 못 왔다 — 2026-07-31 수정.
 *
 * 접근 권한은 여기 적지 않는다. `@/lib/pageAccess` 의 표 한 곳에만 있고
 * `AppLayout` 이 모든 페이지에 적용한다. 페이지마다 역할을 다시 적으면 그 순간
 * 규칙이 둘이 되고, 언젠가 한쪽만 바뀐다.
 *
 * `OperatorDashboard` 는 `user.assigned_machines` 로 설비를 좁히므로 역할과 무관하게
 * 그대로 동작한다.
 */
const OperatorViewPage: React.FC = () => {
  return (
    <div>
      <OperatorDashboard />
    </div>
  );
};

export default OperatorViewPage;
