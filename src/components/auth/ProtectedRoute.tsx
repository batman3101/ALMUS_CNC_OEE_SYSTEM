'use client';

import React, { ReactNode } from 'react';
import { Spin, Alert, Button } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useAuth } from '@/contexts/AuthContext';
import { useLanguage } from '@/contexts/LanguageContext';
import LoginForm from './LoginForm';

type UserRole = 'admin' | 'engineer' | 'operator';

interface ProtectedRouteProps {
  children: ReactNode;
  fallback?: ReactNode;
  allowedRoles?: UserRole[];
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  fallback,
  allowedRoles
}) => {
  const { user, loading, error } = useAuth();
  const { t } = useLanguage();

  // 인증 오류가 있는 경우
  if (error && !loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        padding: '20px'
      }}>
        <Alert
          message={t('auth.authError')}
          description={error}
          type="error"
          style={{ marginBottom: '20px', maxWidth: '500px' }}
        />
        <Button
          icon={<ReloadOutlined />}
          onClick={() => window.location.reload()}
        >
          {t('common.refresh')}
        </Button>
      </div>
    );
  }

  // 로딩 중일 때 (개선된 로딩 UI)
  if (loading) {
    return (
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        minHeight: '100vh',
        backgroundColor: '#f5f5f5'
      }}>
        <div style={{
          padding: '40px',
          backgroundColor: 'white',
          borderRadius: '8px',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
          textAlign: 'center'
        }}>
          <Spin size="large" />
          <div style={{ marginTop: '20px', fontSize: '16px', color: '#666' }}>
            {t('auth.verifyingAuth')}
          </div>
          <div style={{ marginTop: '8px', fontSize: '12px', color: '#999' }}>
            {t('auth.pleaseWait')}
          </div>
        </div>
      </div>
    );
  }

  // 인증되지 않은 경우 (개선된 fallback)
  if (!user) {
    if (fallback) {
      return <>{fallback}</>;
    }

    return (
      <div style={{
        minHeight: '100vh',
        backgroundColor: '#f5f5f5',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }}>
        <div style={{
          width: '100%',
          maxWidth: '400px',
          margin: '0 20px'
        }}>
          <LoginForm />
        </div>
      </div>
    );
  }

  // 역할 기반 접근 제어
  if (allowedRoles && allowedRoles.length > 0) {
    const userRole = user.role as UserRole;
    if (!allowedRoles.includes(userRole)) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          minHeight: '100vh',
          padding: '20px'
        }}>
          <Alert
            message={t('auth.accessDenied')}
            description={t('auth.noPermission')}
            type="warning"
            style={{ marginBottom: '20px', maxWidth: '500px' }}
          />
          <Button onClick={() => window.history.back()}>
            {t('auth.goBack')}
          </Button>
        </div>
      );
    }
  }

  // 인증된 경우 자식 컴포넌트 렌더링
  return <>{children}</>;
};

export default ProtectedRoute;
