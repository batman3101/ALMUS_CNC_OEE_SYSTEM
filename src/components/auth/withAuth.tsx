'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { Spin } from 'antd';

export interface WithAuthOptions {
  requireAuth?: boolean;
  allowedRoles?: ('admin' | 'engineer' | 'operator')[];
  redirectTo?: string;
}

export function withAuth<P extends object>(
  WrappedComponent: React.ComponentType<P>,
  options: WithAuthOptions = {}
) {
  const {
    requireAuth = true,
    allowedRoles = ['admin', 'engineer', 'operator'],
    redirectTo = '/login'
  } = options;

  return function AuthenticatedComponent(props: P) {
    const { user, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
      if (!loading) {
        // 인증이 필요한데 사용자가 없는 경우
        if (requireAuth && !user) {
          console.log('🔒 인증 필요 - 로그인 페이지로 리다이렉트');
          router.replace(redirectTo);
          return;
        }

        // 사용자는 있지만 권한이 없는 경우
        if (user && !allowedRoles.includes(user.role)) {
          console.log(`🚫 권한 없음 - ${user.role} 사용자가 ${allowedRoles} 권한 필요 페이지 접근`);
          router.replace('/dashboard');
          return;
        }

        // 로그인한 사용자가 로그인 페이지에 접근하는 경우
        if (!requireAuth && user && redirectTo === '/login') {
          console.log('✅ 이미 로그인됨 - 대시보드로 리다이렉트');
          router.replace('/dashboard');
          return;
        }
      }
    }, [user, loading, router]);

    // 로딩 중
    if (loading) {
      return (
        <div style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          background: 'var(--ant-color-bg-layout, #f5f5f5)'
        }}>
          <Spin size="large" />
        </div>
      );
    }

    // 인증이 필요한데 사용자가 없는 경우
    if (requireAuth && !user) {
      return null; // 리다이렉트 중
    }

    // 권한이 없는 경우
    if (user && !allowedRoles.includes(user.role)) {
      return null; // 리다이렉트 중
    }

    // 로그인한 사용자가 로그인 페이지에 접근하는 경우
    if (!requireAuth && user && redirectTo === '/login') {
      return null; // 리다이렉트 중
    }

    return <WrappedComponent {...props} />;
  };
}

// 권한별 HOC 미리 정의
export const withAdminAuth = <P extends object>(Component: React.ComponentType<P>) =>
  withAuth(Component, { allowedRoles: ['admin'] });

export const withEngineerAuth = <P extends object>(Component: React.ComponentType<P>) =>
  withAuth(Component, { allowedRoles: ['admin', 'engineer'] });

export const withOperatorAuth = <P extends object>(Component: React.ComponentType<P>) =>
  withAuth(Component, { allowedRoles: ['admin', 'engineer', 'operator'] });

export const withNoAuth = <P extends object>(Component: React.ComponentType<P>) =>
  withAuth(Component, { requireAuth: false });