'use client';

import React from 'react';
import Image from 'next/image';
import { Layout, Menu, Grid } from 'antd';
import {
  DashboardOutlined,
  DesktopOutlined,
  EditOutlined,
  BarChartOutlined,
  SettingOutlined,
  UserOutlined,
  AppstoreOutlined,
  FileTextOutlined,
  LineChartOutlined,
  LockOutlined
} from '@ant-design/icons';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useRouter, usePathname } from 'next/navigation';
import {
  canAccessPath,
  findPageAccess,
  getNavEntries,
  type UserRole
} from '@/lib/pageAccess';
import styles from './Sidebar.module.css';

const { Sider } = Layout;
const { useBreakpoint } = Grid;

/**
 * 경로별 아이콘. 권한 표(`@/lib/pageAccess`)에 아이콘을 섞지 않는 이유는, 그 표를 React 를
 * 모르는 곳(테스트·서버)에서도 읽기 때문이다. 표는 규칙만, 여기는 표현만 담당한다.
 */
const NAV_ICONS: Record<string, React.ReactNode> = {
  '/dashboard': <DashboardOutlined />,
  '/machines': <DesktopOutlined />,
  '/data-input': <EditOutlined />,
  '/production-records': <FileTextOutlined />,
  '/model-info': <AppstoreOutlined />,
  '/reports': <BarChartOutlined />,
  '/analytics': <LineChartOutlined />,
  '/operator-view': <DesktopOutlined />,
  '/admin': <UserOutlined />,
  '/settings': <SettingOutlined />,
};

interface SidebarProps {
  collapsed: boolean;
  onCollapse?: (collapsed: boolean) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onCollapse }) => {
  const { t } = useLanguage();
  const { user } = useAuth();
  const { getCompanyInfo, isLoading } = useSystemSettings();
  const router = useRouter();
  const pathname = usePathname();
  const screens = useBreakpoint();
  
  const companyInfo = getCompanyInfo();

  const userRole = user?.role as UserRole | undefined;

  /**
   * 메뉴 **목록 자체는 역할과 무관하게 동일**하다. 달라지는 것은 각 항목이 눌리는지뿐이다.
   *
   * 예전에는 역할마다 다른 배열을 만들었고, 그래서 사이드바가 사실상 두 번째 권한 규칙이
   * 되어 페이지 가드와 어긋났다(운영자는 `/operator-view` 가 메뉴에 없었고, 엔지니어는
   * 접근 가능한 `/analytics` 가 메뉴에 없었다). 이제 목록과 허용 여부 둘 다
   * `@/lib/pageAccess` 한 곳에서 나온다.
   */
  const getMenuItems = () =>
    getNavEntries().map((entry) => {
      const allowed = canAccessPath(userRole, entry.path);
      const label = t(entry.labelKey!);

      return {
        key: entry.path,
        icon: NAV_ICONS[entry.path] ?? <DashboardOutlined />,
        disabled: !allowed,
        // 접힌 상태에서 antd 가 띄우는 툴팁이자 펼친 상태의 네이티브 title.
        // 왜 잠겼는지 말해 주지 않으면 사용자는 고장으로 읽는다.
        title: allowed ? label : `${label} — ${lockHint(entry.roles)}`,
        label: allowed ? (
          label
        ) : (
          <span className={styles.lockedLabel}>
            {label}
            <LockOutlined className={styles.lockIcon} />
          </span>
        ),
      };
    });

  /** "시스템 관리자 전용" 처럼 필요한 등급을 사람 말로 적는다. */
  const lockHint = (roles: readonly UserRole[]): string => {
    const names = roles.map((role) => t(`auth:roles.${role}`));
    return t('nav.restrictedTo', { roles: names.join(' · ') });
  };

  const handleMenuClick = ({ key }: { key: string }) => {
    // disabled 항목은 antd 가 onClick 을 부르지 않지만, 규칙을 화면 상태에 맡기지 않는다.
    if (!canAccessPath(userRole, key)) return;
    router.push(key);
  };

  // 선택 표시는 **현재 경로가 속한 메뉴 항목**을 따른다. `/machines/bulk-upload` 에서는
  // '설비 현황'이 선택된 것으로 보여야 한다 (예전에는 /dashboard 만 특별 취급했다).
  const activeEntry = findPageAccess(pathname);
  const selectedKey = activeEntry?.labelKey ? activeEntry.path : pathname;

  return (
    <Sider 
      trigger={null} 
      collapsible
      collapsed={collapsed}
      width={240}
      collapsedWidth={screens.lg ? 80 : 0}
      className={`${styles.sidebar} ${!screens.lg && !collapsed ? styles.sidebarMobile : ''}`}
      breakpoint="lg"
      onBreakpoint={() => {
        // 브레이크포인트에서 자동으로 접기/펼치기 처리는 AppLayout에서 관리
      }}
    >
      <div className={`${styles.logo} ${screens.xs ? styles.logoMobile : ''}`}>
        <Image
          src="/ALMUS symbol.png"
          alt="ALMUS Logo"
          width={32}
          height={32}
          className={`${styles.logoImage} ${collapsed ? styles.logoImageCollapsed : ''}`}
          priority
        />
        {!collapsed && (
          <span className={`${styles.logoText} ${!screens.lg ? styles.logoTextMobile : ''}`}>
            {isLoading ? 'Loading...' : companyInfo.name}
          </span>
        )}
      </div>
      
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[selectedKey]}
        items={getMenuItems()}
        onClick={handleMenuClick}
        className={`${styles.menu} ${!screens.lg ? styles.menuMobile : ''}`}
        inlineCollapsed={collapsed}
      />
      
      {/* 모바일에서 사이드바가 열려있을 때 배경 오버레이 */}
      {!screens.lg && !collapsed && (
        <div
          className={styles.overlay}
          onClick={() => onCollapse?.(true)}
        />
      )}
    </Sider>
  );
};

export default Sidebar;
