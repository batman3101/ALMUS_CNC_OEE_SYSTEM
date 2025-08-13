'use client';

import React from 'react';
import { AdminDashboard } from './AdminDashboard';
import { OperatorDashboard } from './OperatorDashboard';
import { EngineerDashboard } from './EngineerDashboard';
import { RoleSwitcher } from './RoleSwitcher';
import { User } from '@/types';
import { useClientOnly } from '@/hooks/useClientOnly';

interface DashboardRouterProps {
  user: User | null;
}

export const DashboardRouter: React.FC<DashboardRouterProps> = ({ user }) => {
  const isClient = useClientOnly();

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

  // 사용자가 없는 경우 (인증되지 않음)
  if (!user) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '400px',
        fontSize: 16,
        color: '#666'
      }}>
        사용자 정보를 불러오는 중입니다...
      </div>
    );
  }

  // 사용자 역할에 따른 대시보드 렌더링
  const renderDashboard = () => {
    switch (user.role) {
      case 'admin':
        return <AdminDashboard />;
      case 'operator':
        return <OperatorDashboard />;
      case 'engineer':
        return <EngineerDashboard />;
      default:
        return <AdminDashboard />;
    }
  };

  return (
    <>
      {renderDashboard()}
      <RoleSwitcher />
    </>
  );
};