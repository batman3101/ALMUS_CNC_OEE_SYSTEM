'use client';

import React from 'react';
import { RoleGuard } from '@/components/auth';
import { OperatorDashboard } from '@/components/dashboard';

/**
 * 운영자 화면(관리자 보기).
 *
 * DashboardRouter 는 user.role 로 화면을 고르므로, 관리자는 AdminDashboard 로만 갈 수 있고
 * OperatorDashboard 에 도달할 URL 자체가 없었다. 엔지니어 화면은 /analytics 로 열려
 * 있는데(admin+engineer) 운영자 화면만 그렇지 않아 대칭이 깨져 있었다. 총괄 관리자가
 * 자기 시스템의 한 화면을 열어볼 수 없으면 유지보수를 할 수 없다.
 *
 * 컴포넌트는 손대지 않는다 — OperatorDashboard 는 user.assigned_machines 로 설비를
 * 좁히는데, 관리자 계정에는 이미 전 설비가 배정돼 있어 그대로 동작한다.
 * 권한은 RoleGuard 와 DB 의 RLS 가 이중으로 지킨다.
 */
const OperatorViewPage: React.FC = () => {
  return (
    <RoleGuard allowedRoles={['admin']}>
      <div>
        <OperatorDashboard />
      </div>
    </RoleGuard>
  );
};

export default OperatorViewPage;
