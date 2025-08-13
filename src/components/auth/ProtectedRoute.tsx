'use client';

import React, { ReactNode } from 'react';
import { Spin } from 'antd';
import { useAuth } from '@/contexts/AuthContext';
import LoginForm from './LoginForm';

interface ProtectedRouteProps {
  children: ReactNode;
  fallback?: ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ 
  children, 
  fallback 
}) => {
  const { user, loading } = useAuth();

  // 로딩 중일 때
  if (loading) {
    return (
      <div style={{ 
        display: 'flex', 
        justifyContent: 'center', 
        alignItems: 'center', 
        minHeight: '100vh' 
      }}>
        <Spin size="large" />
      </div>
    );
  }

  // 인증되지 않은 경우
  if (!user) {
    return fallback || <LoginForm />;
  }

  // 인증된 경우 자식 컴포넌트 렌더링
  return <>{children}</>;
};

export default ProtectedRoute;