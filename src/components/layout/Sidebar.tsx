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

/** 설정에 로고가 없을 때 쓰는 기본 심볼. 지금까지 하드코딩되어 있던 그 파일이다. */
const FALLBACK_LOGO_SRC = '/ALMUS symbol.png';

/**
 * 설정에 저장된 로고 URL을 `next/image` 가 실제로 그릴 수 있는 형태로 판정한다.
 *
 * 업로드된 로고는 Supabase Storage 의 **공개 URL**(`https://<project>.supabase.co/...`)로
 * 저장된다(`src/app/api/upload/image/route.ts`). `next/image` 의 기본 로더는 외부 호스트를
 * `next.config.js` 의 `images.remotePatterns` 에 등록해야만 최적화 경로로 통과시키고,
 * 등록되지 않은 호스트는 **런타임 에러**로 막는다. 지금 이 설정에는 `images` 블록 자체가
 * 없다.
 *
 * 그래서 원격 URL 은 `unoptimized` 로 그린다 — 이 플래그가 붙으면 Next 는 로더를 아예
 * 부르지 않고 `src` 를 그대로 `<img>` 에 넘기므로 호스트 등록이 필요 없다. 로고는 32px
 * 짜리 심볼이라 최적화로 얻을 이득도 거의 없다. 값이 비어 있으면(현재 운영 상태) 기존
 * 로컬 파일을 그대로 쓰므로 화면은 지금과 완전히 동일하다.
 *
 * ■ 왜 `null`·`undefined` 까지 받는가
 *   타입상 `getCompanyInfo().logo` 는 항상 문자열이지만, 이 함수가 문자열을 전제하고
 *   `.trim()` 을 부르는 순간 **회사 로고라는 장식 하나가 내비게이션 전체를 무너뜨릴 수
 *   있는 자리**가 된다 — 실제로 `logo` 키가 없는 호출자 하나에 `Sidebar` 가 통째로
 *   TypeError 로 죽었다. 값이 없으면 기본 심볼로 물러나는 것이 언제나 옳으므로, 타입을
 *   믿는 대신 전(total) 함수로 만든다.
 */
function resolveLogo(configuredUrl: string | null | undefined): { src: string; unoptimized: boolean } {
  const trimmed = configuredUrl?.trim() ?? '';
  if (!trimmed) return { src: FALLBACK_LOGO_SRC, unoptimized: false };

  // 로컬 경로(`/foo.png`)는 최적화 경로가 그대로 처리한다. 프로토콜 상대 URL(`//host/..`)은
  // 원격이므로 제외한다.
  const isLocal = trimmed.startsWith('/') && !trimmed.startsWith('//');
  return { src: trimmed, unoptimized: !isLocal };
}

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
  // 회사명은 더 이상 읽지 않는다(브랜드는 ALMUS 고정). 로고 URL 만 설정에서 온다.
  const { getCompanyInfo } = useSystemSettings();
  const router = useRouter();
  const pathname = usePathname();
  const screens = useBreakpoint();
  
  const companyInfo = getCompanyInfo();
  const logo = resolveLogo(companyInfo.logo);

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
          src={logo.src}
          alt="ALMUS Logo"
          width={32}
          height={32}
          className={`${styles.logoImage} ${collapsed ? styles.logoImageCollapsed : ''}`}
          unoptimized={logo.unoptimized}
          priority
        />
        {/*
          앱 브랜드는 공장과 무관하게 ALMUS 로 고정한다(운영 결정 2026-08-24).
          어느 공장을 보고 있는지는 헤더의 공장 배지(FactorySwitcher)가 말한다.

          예전에는 여기에 설정의 회사명을 그렸다. 그러면 공장마다 다른 이름이 나오는데,
          그 값은 RLS 를 타므로 공장을 특정하지 못하는 순간 엉뚱한 공장 이름이 뜬다
          (다중 소속 관리자에게 실제로 그랬다). 브랜드를 상수로 두면 그 실패 자체가
          사라진다 — 표시할 수 없는 것을 감추는 게 아니라, 애초에 공장에 의존하지 않는다.
        */}
        {!collapsed && (
          <span className={`${styles.logoText} ${!screens.lg ? styles.logoTextMobile : ''}`}>
            ALMUS
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
