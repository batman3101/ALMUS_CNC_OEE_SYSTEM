'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Layout, Button, Dropdown, Typography, Grid, Spin, App, Result, Alert } from 'antd';
import {
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  LogoutOutlined,
  UserOutlined
} from '@ant-design/icons';
import { usePathname, useRouter } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { canAccessPath, isPublicPath, type UserRole } from '@/lib/pageAccess';
import { useFailureReport } from '@/hooks/useFailureReport';
import LoginForm from '@/components/auth/LoginForm';
import Sidebar from './Sidebar';
import FactorySwitcher from './FactorySwitcher';
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
  const { user, logout, loading, error: authError } = useAuth();
  const { message } = App.useApp();
  const reportFailure = useFailureReport();
  const screens = useBreakpoint();
  const { getDisplaySettings, isLoading: settingsLoading } = useSystemSettings();
  const configuredCollapsed = getDisplaySettings().sidebarCollapsed;

  // 로그인 페이지인지 확인
  const isLoginPage = pathname === '/login';
  const isOperatorConsolePage = pathname === '/operator-view' || (pathname === '/dashboard' && user?.role === 'operator');

  /**
   * 세션이 끊겨 로그인 화면으로 전환되면 **이미 떠 있는** 토스트를 걷는다.
   *
   * 늦게 도착하는 토스트는 여기서 막지 않는다 — 그건 `@/lib/errorReporting` 이 판정한다.
   * 요청 실패를 도메인 언어로 옮겨 적는 자리는 전부 `useFailureReport` 를 지나고, 그
   * 헬퍼는 세션이 끝난 상태면 아무 말도 하지 않는다. 예전에는 그 판정이 어디에도 없어
   * "대시보드 데이터를 불러오는데 실패했습니다" 가 만료 안내 위에 겹쳐 떴다.
   *
   * 그래도 이 `destroy` 가 남아 있는 이유는, **만료 이전에 이미 화면에 올라와 있던**
   * 토스트는 판정을 거칠 기회가 없었기 때문이다. 예를 들어 만료 3초 전에 뜬 네트워크
   * 오류 토스트는 그대로 남아 로그인 화면 위에 떠 있게 된다. 그건 지금 화면이 하는
   * 이야기와 무관하므로 여기서 걷는다.
   */
  useEffect(() => {
    if (!user && authError) {
      message.destroy();
    }
  }, [user, authError, message]);

  // 태블릿에서는 콘텐츠 폭을 확보하고, 운영자 콘솔에서는 데스크톱도 아이콘 레일로 시작한다.
  useEffect(() => {
    if (screens.lg === undefined) return;
    setCollapsed(!screens.lg || isOperatorConsolePage);
  }, [screens.lg, isOperatorConsolePage]);

  /**
   * 바로 위 효과가 **강제하는** 접힘 상태를, 아래 하이드레이션이 읽을 수 있게 같은 규칙으로
   * 파생한다. `null` 은 아직 브레이크포인트가 확정되지 않았다는 뜻이다(antd 의
   * `useBreakpoint` 는 첫 렌더에서 전부 undefined 를 준다).
   *
   * 두 곳에 같은 식이 적힌 이유는, 위 효과의 표현이 운영자 태블릿 동선 계약
   * (`src/components/dashboard/__tests__/OperatorDashboard.tabletLayout.test.ts`)에
   * 그대로 못박혀 있기 때문이다. 그 계약은 이 화면이 현장 태블릿에서 어떻게 동작해야
   * 하는지에 대한 결정이므로 표현을 바꾸지 않는다. 둘이 어긋나면
   * `appLayoutSidebarCollapsed.test.tsx` 의 모바일·운영자 콘솔 조항이 깨진다.
   */
  const forcedCollapsed = screens.lg === undefined
    ? null
    : (!screens.lg || isOperatorConsolePage);

  /**
   * `display.sidebar_collapsed` 를 **초기 접힘 상태**로 한 번만 반영한다.
   *
   * ■ 왜 1회 하이드레이션인가
   *   이 설정은 비동기로 도착한다(`useSystemSettings().isLoading`). 매 렌더마다 그대로
   *   반영하면 사용자가 사이드바를 접자마자 설정값이 다시 펴 버리고, 사용자는 토글이
   *   고장 났다고 읽는다. `UserPreferencesContext` 가 언어·테마에서 이미 겪은 문제이고
   *   해법도 같다 — ref 로 "확정했는가"를 기억하고, 확정 뒤에는 사용자의 선택만이 값을
   *   바꾼다.
   *
   * ■ 왜 브레이크포인트 확정을 기다리는가
   *   바로 위 효과가 모바일·운영자 콘솔에서 접힘을 **강제**한다. 두 규칙이 같은 상태를
   *   두고 다투면 화면이 한 번 깜빡였다가 되돌아간다. 그래서 강제 규칙이 정해진 뒤에만
   *   판단하고, 강제 접힘 상황(`forcedCollapsed === true`)에서는 설정이 개입하지 않는다
   *   — 모바일에서 설정 때문에 사이드바가 펼쳐지면 콘텐츠를 통째로 덮는다.
   *
   * ■ 왜 강제 접힘일 때도 "반영 완료"로 표시하는가
   *   "초기 상태"라는 순간은 브레이크포인트와 설정이 모두 확정된 시점에 끝난다. 여기서
   *   소비 표시를 미루면 나중에 창을 넓혔을 때(모바일 → 데스크톱) 뒤늦게 설정이 튀어나와
   *   사용자가 요청하지 않은 접힘이 일어난다.
   */
  const sidebarHydratedRef = useRef(false);
  const userToggledSidebarRef = useRef(false);

  useEffect(() => {
    if (sidebarHydratedRef.current) return;
    if (settingsLoading) return;
    if (forcedCollapsed === null) return;

    sidebarHydratedRef.current = true;

    // 설정을 기다리는 동안 사용자가 이미 접거나 편 경우, 그 선택이 이긴다.
    if (forcedCollapsed || userToggledSidebarRef.current) return;
    setCollapsed(configuredCollapsed);
  }, [settingsLoading, forcedCollapsed, configuredCollapsed]);

  /** 사용자가 직접 바꾼 접힘. 이후로는 설정이 이 선택을 덮지 않는다. */
  const handleCollapseChange = useCallback((next: boolean) => {
    userToggledSidebarRef.current = true;
    setCollapsed(next);
  }, []);



  // 로그아웃 처리
  const handleLogout = async () => {
    try {
      await logout();
      message.success(t('auth.logoutSuccess'));
    } catch (error) {
      console.error('Logout error:', error);
      reportFailure(t('auth.logoutFailed'), error);
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
        {/*
          왜 오류를 보여주는가 — 세션이 만료되면 화면이 갑자기 로그인 폼으로 바뀐다.
          이유를 말해 주지 않으면 사용자는 무슨 일이 났는지 알 수 없다. 예전에는 그 이유가
          각 패널의 도메인 오류("비가동 내역을 불러오지 못했습니다")로 새어 나왔고, 그래서
          데이터가 깨진 줄 알고 새로고침만 반복하게 됐다.

          왜 배너인가 — LoginForm 은 스스로 `minHeight: 100vh` 로 화면 전체를 차지하며
          가운데 정렬한다. 그 위에 폭 400px 짜리 컨테이너를 씌우고 그 안에 안내를 넣었더니
          안내가 화면 꼭대기로, 폼은 한참 아래 가운데로 갈라졌다. 폼의 레이아웃과 다투는
          대신 상단 배너로 띄운다.
        */}
        {authError && (
          <Alert
            className={styles.gateAlert}
            message={authError}
            type="warning"
            showIcon
          />
        )}
        <LoginForm />
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
      <Sidebar collapsed={collapsed} onCollapse={handleCollapseChange} />
      <Layout>
        <Header className={styles.header}>
          <div className={styles.headerLeft}>
            {/*
              데스크톱 넓은 화면에서는 사이드바가 늘 펼쳐져 있으므로 토글이 필요 없었다.
              그런데 `display.sidebar_collapsed` 를 켜면 접힌 채로 시작하고, 토글이 없으면
              **펼칠 방법이 사라진다** — 설정 하나가 화면을 되돌릴 수 없는 상태로 만든다.
              그래서 그 설정이 켜져 있을 때는 데스크톱에서도 토글을 남긴다. 설정이 꺼져
              있으면(현재 운영값) 조건이 예전과 완전히 같다.
            */}
            {(!screens.lg || isOperatorConsolePage || configuredCollapsed) && (
              <Button
                type="text"
                icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                onClick={() => handleCollapseChange(!collapsed)}
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
            {/*
              현재 공장 표시 · 전환기.
              소속이 하나인 사용자에게는 배지만 보이고 전환 메뉴는 나타나지 않는다.
            */}
            <FactorySwitcher size={screens.xs ? 'small' : 'middle'} />

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
