'use client';

import React, { ReactNode } from 'react';
import { Result, Button } from 'antd';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useTranslation } from '@/hooks/useTranslation';
import { User } from '@/types';

type UserRole = User['role'];

interface RoleGuardProps {
  children: ReactNode;
  allowedRoles: UserRole[];
  fallback?: ReactNode;
  redirectTo?: string;
}

export const RoleGuard: React.FC<RoleGuardProps> = ({
  children,
  allowedRoles,
  fallback,
  redirectTo = '/'
}) => {
  const { user } = useAuth();
  const { t } = useTranslation();
  const router = useRouter();

  // 사용자가 로그인하지 않은 경우 (ProtectedRoute에서 처리되어야 함)
  if (!user) {
    return null;
  }

  // 사용자 역할이 허용된 역할에 포함되지 않는 경우
  if (!allowedRoles.includes(user.role)) {
    if (fallback) {
      return <>{fallback}</>;
    }

    return (
      <Result
        status="403"
        title="403"
        subTitle={t('auth.permissions.accessDenied')}
        extra={
          <Button type="primary" onClick={() => router.push(redirectTo)}>
            {t('common.goBack')}
          </Button>
        }
      />
    );
  }

  // 권한이 있는 경우 자식 컴포넌트 렌더링
  return <>{children}</>;
};

// 특정 역할만 허용하는 편의 컴포넌트들
export const AdminOnly: React.FC<Omit<RoleGuardProps, 'allowedRoles'>> = (props) => (
  <RoleGuard {...props} allowedRoles={['admin']} />
);

export const OperatorOnly: React.FC<Omit<RoleGuardProps, 'allowedRoles'>> = (props) => (
  <RoleGuard {...props} allowedRoles={['operator']} />
);

export const EngineerOnly: React.FC<Omit<RoleGuardProps, 'allowedRoles'>> = (props) => (
  <RoleGuard {...props} allowedRoles={['engineer']} />
);

export const AdminOrEngineer: React.FC<Omit<RoleGuardProps, 'allowedRoles'>> = (props) => (
  <RoleGuard {...props} allowedRoles={['admin', 'engineer']} />
);

export const OperatorOrEngineer: React.FC<Omit<RoleGuardProps, 'allowedRoles'>> = (props) => (
  <RoleGuard {...props} allowedRoles={['operator', 'engineer']} />
);

export const AllRoles: React.FC<Omit<RoleGuardProps, 'allowedRoles'>> = (props) => (
  <RoleGuard {...props} allowedRoles={['admin', 'operator', 'engineer']} />
);

export default RoleGuard;