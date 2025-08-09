'use client';

import React from 'react';
import { Layout, Menu, Grid } from 'antd';
import { 
  DashboardOutlined,
  DesktopOutlined,
  EditOutlined,
  BarChartOutlined,
  SettingOutlined,
  UserOutlined
} from '@ant-design/icons';
import { useLanguage } from '@/contexts/LanguageContext';
import { useRouter, usePathname } from 'next/navigation';
import styles from './Sidebar.module.css';

const { Sider } = Layout;
const { useBreakpoint } = Grid;

interface SidebarProps {
  collapsed: boolean;
  onCollapse?: (collapsed: boolean) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ collapsed, onCollapse }) => {
  const { t } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const screens = useBreakpoint();

  // TODO: 실제 사용자 역할에 따라 메뉴 아이템 필터링
  // 현재는 임시로 admin 설정, 추후 AuthContext에서 가져올 예정
  const userRole = 'admin';

  // 역할별 메뉴 아이템 정의
  const getMenuItems = () => {
    const menuItems = [
      {
        key: '/',
        icon: <DashboardOutlined />,
        label: t('nav.dashboard'),
      },
    ];

    // 역할별 메뉴 아이템 추가
    switch (userRole) {
      case 'operator':
        menuItems.push(
          {
            key: '/machines',
            icon: <DesktopOutlined />,
            label: t('nav.myMachines'),
          },
          {
            key: '/log-input',
            icon: <EditOutlined />,
            label: t('nav.logInput'),
          }
        );
        break;
        
      case 'engineer':
        menuItems.push(
          {
            key: '/machines',
            icon: <DesktopOutlined />,
            label: t('nav.machines'),
          },
          {
            key: '/reports',
            icon: <BarChartOutlined />,
            label: t('nav.reports'),
          }
        );
        break;
        
      case 'admin':
        menuItems.push(
          {
            key: '/machines',
            icon: <DesktopOutlined />,
            label: t('nav.machines'),
          },
          {
            key: '/reports',
            icon: <BarChartOutlined />,
            label: t('nav.reports'),
          },
          {
            key: '/management',
            icon: <UserOutlined />,
            label: t('nav.management'),
          }
        );
        break;
        
      default:
        // 기본적으로 대시보드만 표시
        break;
    }

    // 공통 설정 메뉴 (모든 역할에 표시)
    menuItems.push({
      key: '/settings',
      icon: <SettingOutlined />,
      label: t('nav.settings'),
    });

    return menuItems;
  };

  const handleMenuClick = ({ key }: { key: string }) => {
    router.push(key);
  };

  return (
    <Sider 
      trigger={null} 
      collapsible 
      collapsed={collapsed}
      width={240}
      collapsedWidth={screens.xs ? 0 : 80}
      className={`${styles.sidebar} ${screens.xs && !collapsed ? styles.sidebarMobile : ''}`}
      breakpoint="lg"
      onBreakpoint={() => {
        // 브레이크포인트에서 자동으로 접기/펼치기 처리는 AppLayout에서 관리
      }}
    >
      <div className={`${styles.logo} ${screens.xs ? styles.logoMobile : ''}`}>
        {!collapsed && (
          <span className={`${styles.logoText} ${screens.xs ? styles.logoTextMobile : ''}`}>
            CNC OEE
          </span>
        )}
        {collapsed && (
          <span className={styles.logoTextCollapsed}>
            CNC
          </span>
        )}
      </div>
      
      <Menu
        theme="dark"
        mode="inline"
        selectedKeys={[pathname]}
        items={getMenuItems()}
        onClick={handleMenuClick}
        className={`${styles.menu} ${screens.xs ? styles.menuMobile : ''}`}
        inlineCollapsed={collapsed}
      />
      
      {/* 모바일에서 사이드바가 열려있을 때 배경 오버레이 */}
      {screens.xs && !collapsed && (
        <div
          className={styles.overlay}
          onClick={() => onCollapse?.(true)}
        />
      )}
    </Sider>
  );
};

export default Sidebar;