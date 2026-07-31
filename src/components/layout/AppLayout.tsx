'use client';

import React, { useState, useEffect } from 'react';
import { Layout, Button, Dropdown, Typography, Grid, Spin, App, Result } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  UserOutlined
} from '@ant-design/icons';
import { usePathname, useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { canAccessPath, isPublicPath, type UserRole } from '@/lib/pageAccess';
import LoginForm from '@/components/auth/LoginForm';
import Sidebar from './Sidebar';
import LanguageToggle from './LanguageToggle';
import ThemeToggle from './ThemeToggle';
import styles from './AppLayout.module.css';

const { Header, Content } = Layout;
const { Text } = Typography;
const { useBreakpoint } = Grid;

interface AppLayoutProps {
  children: React.ReactNode;
}

const AppLayout: React.FC<AppLayoutProps> = ({ children }) => {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useLanguage();
  const { user, logout, loading } = useAuth();
  const { message } = App.useApp();
  const screens = useBreakpoint();

  // 로그인 페이지인지 확인
  const isLoginPage = pathname === '/login';
  const isOperatorConsolePage = pathname === '/operator-view' || (pathname === '/dashboard' && user?.role === 'operator');

  // 태블릿에서는 콘텐츠 폭을 확보하고, 운영자 콘솔에서는 데스크톱도 아이콘 레일로 시작한다.
  useEffect(() => {
    if (screens.lg === undefined) return;
    setCollapsed(!screens.lg || isOperatorConsolePage);
  }, [screens.lg, isOperatorConsolePage]);



  // 로그아웃 처리
  const handleLogout = async () => {
    try {
      await logout();
      message.success(t('auth.logoutSuccess'));
    } catch (error) {
      console.error('Logout error:', error);
      message.error(t('auth.logoutFailed'));
    }
  };

  // 사용자 메뉴 아이템
  const userItems = [
    {
      key: 'logout',
      label: t('auth.logout'),
      icon: <LogoutOutlined />,
      onClick: handleLogout,
    },
  ];

  // 로딩 중일 때
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

  // 로그인 페이지는 레이아웃 밖에서 스스로 그린다.
  if (isLoginPage) {
    return <>{children}</>;
  }

  /**
   * 로그인하지 않은 상태.
   *
   * 예전에는 여기서 `children` 을 그대로 렌더링하고 뒷일을 페이지에 맡겼다. 그래서 처리가
   * 갈렸다 — `<ProtectedRoute>` 를 쓴 페이지는 로그인 폼이 떴지만 `<RoleGuard>` 만 쓴
   * `/admin`·`/analytics`·`/operator-view`·`/model-info` 는 `user` 가 없을 때 `null` 을
   * 반환해 **빈 화면**이 나왔다. 관문을 하나로 모으면서 이 갈림도 없앤다.
   */
  if (!user) {
    if (isPublicPath(pathname)) {
      return <>{children}</>;
    }
    return (
      <div className={styles.gateScreen}>
        <div className={styles.gateCard}>
          <LoginForm />
        </div>
      </div>
    );
  }

  /**
   * 역할 검사 — 이 애플리케이션의 **유일한** 페이지 접근 관문.
   *
   * AppLayout 은 `app/layout.tsx` 에서 모든 페이지를 감싸므로 우회할 수 있는 페이지가
   * 존재하지 않는다. 페이지마다 가드를 다는 방식은 "새 페이지에 가드 다는 걸 잊는다"는
   * 실패 모드가 늘 열려 있었고, 실제로 `/settings`·`/data-input`·`/machines` 세 곳이
   * 가드 없이 살아 있었다(운영자가 시스템 설정을 열 수 있었다).
   *
   * 사이드바를 남긴 채 안쪽만 403 으로 바꾼다 — 화면 전체를 갈아치우면 사용자는 갈 곳을
   * 잃고 뒤로가기밖에 못 한다.
   */
  const accessDenied = !isPublicPath(pathname)
    && !canAccessPath(user.role as UserRole, pathname);

  return (
    <Layout className={styles.appLayout}>
      <Sidebar collapsed={collapsed} onCollapse={setCollapsed} />
      <Layout>
        <Header className={styles.header}>
          <div className={styles.headerLeft}>
            {(!screens.lg || isOperatorConsolePage) && (
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => setCollapsed(!collapsed)}
                className={styles.menuToggle}
              />
            )}
            {!screens.xs && (
              <Text 
                strong 
                className={styles.headerTitle}
              >
                {t('app.title')}
              </Text>
            )}
          </div>
          
          <div className={styles.headerActions}>
            {/* 언어 전환 컴포넌트 */}
            <LanguageToggle size={screens.xs ? 'small' : 'middle'} />

            {/* 테마 전환 컴포넌트 */}
            <ThemeToggle size={screens.xs ? 'small' : 'middle'} />

            {/* 사용자 메뉴 드롭다운 */}
            <Dropdown menu={{ items: userItems }} placement="bottomRight">
              <Button
                type="text"
                icon={<UserOutlined />}
                size={screens.xs ? 'small' : 'middle'}
              >
                {!screens.xs && (user?.name || user?.email || t('common.user'))}
              </Button>
            </Dropdown>
          </div>
        </Header>
        
        <Content className={styles.content}>
          {accessDenied ? (
            <Result
              status="403"
              title="403"
              subTitle={t('auth.noPermission')}
              extra={
                <Button type="primary" onClick={() => router.push('/dashboard')}>
                  {t('nav.dashboard')}
                </Button>
              }
            />
          ) : (
            children
          )}
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;
