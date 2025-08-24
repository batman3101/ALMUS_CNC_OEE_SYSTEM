'use client';

import React, { useState } from 'react';
import { Button, Alert } from 'antd';
import { AdminDashboard } from './AdminDashboard';
import { OperatorDashboard } from './OperatorDashboard';
import { EngineerDashboard } from './EngineerDashboard';
import { RoleSwitcher } from './RoleSwitcher';
import { User } from '@/types';
import { useClientOnly } from '@/hooks/useClientOnly';
import { useAuth } from '@/contexts/AuthContext';

interface DashboardRouterProps {
  user: User | null;
}

export const DashboardRouter: React.FC<DashboardRouterProps> = ({ user }) => {
  const isClient = useClientOnly();
  const { error: authError, logout } = useAuth();
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  
  // 에러 재시도 핸들러
  const handleRetry = async () => {
    setDashboardError(null);
    window.location.reload();
  };
  
  // 대시보드 로드 에러 핸들러
  const handleDashboardError = (error: Error) => {
    if (process.env.NODE_ENV === 'development') {
      console.error('Dashboard error:', error);
    }
    setDashboardError('대시보드를 불러오는 중 오류가 발생했습니다.');
  };

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

  // 인증 에러가 있는 경우
  if (authError) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '400px',
        padding: '20px'
      }}>
        <Alert
          message="인증 오류"
          description={authError}
          type="error"
          style={{ marginBottom: '16px', maxWidth: '500px' }}
        />
        <div style={{ display: 'flex', gap: '8px' }}>
          <Button onClick={handleRetry}>
            새로고침
          </Button>
          <Button type="primary" onClick={() => logout()}>
            로그인 페이지로
          </Button>
        </div>
      </div>
    );
  }

  // 대시보드 에러가 있는 경우
  if (dashboardError) {
    return (
      <div style={{ 
        display: 'flex', 
        flexDirection: 'column',
        justifyContent: 'center', 
        alignItems: 'center', 
        height: '400px',
        padding: '20px'
      }}>
        <Alert
          message="대시보드 오류"
          description={dashboardError}
          type="error"
          style={{ marginBottom: '16px', maxWidth: '500px' }}
        />
        <Button onClick={handleRetry}>
          다시 시도
        </Button>
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
    try {
      switch (user.role) {
        case 'admin':
          return <AdminDashboard onError={handleDashboardError} />;
        case 'operator':
          return <OperatorDashboard onError={handleDashboardError} />;
        case 'engineer':
          return <EngineerDashboard onError={handleDashboardError} />;
        default:
          if (process.env.NODE_ENV === 'development') {
            console.warn('Unknown user role:', user.role, 'defaulting to admin dashboard');
          }
          return <AdminDashboard onError={handleDashboardError} />;
      }
    } catch (error) {
      handleDashboardError(error as Error);
      return null;
    }
  };

  return (
    <>
      {renderDashboard()}
      <RoleSwitcher />
    </>
  );
};