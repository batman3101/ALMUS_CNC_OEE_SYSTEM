'use client';

import React from 'react';
import { AdminDashboard } from './AdminDashboard';
import { OperatorDashboard } from './OperatorDashboard';
import { EngineerDashboard } from './EngineerDashboard';
import { User } from '@/types';
import { useClientOnly } from '@/hooks/useClientOnly';

interface DashboardRouterProps {
  user?: User | null;
  selectedRole?: 'admin' | 'operator' | 'engineer';
  onRoleChange?: (role: 'admin' | 'operator' | 'engineer') => void;
}

export const DashboardRouter: React.FC<DashboardRouterProps> = ({ user, selectedRole, onRoleChange }) => {
  const isClient = useClientOnly();
  
  // 클라이언트에서만 사용자 역할 확인
  const userRole = isClient ? (selectedRole || user?.role || 'admin') : 'admin';

  // 서버 사이드에서는 기본 로딩 상태 표시
  if (!isClient) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '400px',
        fontSize: 16,
        color: '#666'
      }}>
        대시보드를 로딩 중입니다...
      </div>
    );
  }

  switch (userRole) {
    case 'admin':
      return <AdminDashboard selectedRole={selectedRole} onRoleChange={onRoleChange} />;
    case 'operator':
      return <OperatorDashboard selectedRole={selectedRole} onRoleChange={onRoleChange} />;
    case 'engineer':
      return <EngineerDashboard selectedRole={selectedRole} onRoleChange={onRoleChange} />;
    default:
      return <AdminDashboard selectedRole={selectedRole} onRoleChange={onRoleChange} />;
  }
};