'use client';

import React, { useState, useEffect } from 'react';
import { Layout, Button, Dropdown, Typography, Grid, Spin, App } from 'antd';
import { 
  MenuFoldOutlined, 
  MenuUnfoldOutlined, 
  LogoutOutlined,
  UserOutlined 
} from '@ant-design/icons';
import { usePathname } from 'next/navigation';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { NotificationBadge, NotificationPanel } from '@/components/notifications';
import { LoginForm } from '@/components/auth/LoginForm';
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
  const [notificationPanelOpen, setNotificationPanelOpen] = useState(false);
  const pathname = usePathname();
  const { t } = useLanguage();
  const { user, logout, loading } = useAuth();
  const { message } = App.useApp();
  const { 
    notifications, 
    unreadCount, 
    acknowledgeNotification, 
    resolveNotification, 
    clearNotification, 
    clearAllNotifications 
  } = useNotifications();
  const screens = useBreakpoint();

  // 로그인 페이지인지 확인
  const isLoginPage = pathname === '/login';

  // 모바일에서만 사이드바를 접음 (데스크탑에서는 항상 펼침)
  useEffect(() => {
    if (screens.xs || screens.sm) {
      setCollapsed(true);
    } else {
      setCollapsed(false); // 데스크탑에서는 항상 펼침
    }
  }, [screens]);



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

  // 로그인 페이지이거나 사용자가 로그인하지 않은 경우
  if (isLoginPage || !user) {
    return <>{children}</>;
  }

  return (
    <Layout className={styles.appLayout}>
      <Sidebar collapsed={collapsed} onCollapse={setCollapsed} />
      <Layout>
        <Header className={styles.header}>
          <div className={styles.headerLeft}>
            {(screens.xs || screens.sm) && (
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
            {/* 알림 배지 */}
            <NotificationBadge
              count={unreadCount}
              severity={notifications.find(n => n.status === 'active' && n.severity === 'critical') ? 'critical' : 'medium'}
              onClick={() => setNotificationPanelOpen(true)}
              size={screens.xs ? 'small' : 'default'}
            />
            
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
                {!screens.xs && (user?.name || user?.email || '사용자')}
              </Button>
            </Dropdown>
          </div>
        </Header>
        
        <Content className={styles.content}>
          {children}
        </Content>
      </Layout>

      {/* 알림 패널 */}
      <NotificationPanel
        open={notificationPanelOpen}
        onClose={() => setNotificationPanelOpen(false)}
        notifications={notifications}
        onAcknowledge={acknowledgeNotification}
        onResolve={resolveNotification}
        onDelete={clearNotification}
        onClearAll={clearAllNotifications}
      />
    </Layout>
  );
};

export default AppLayout;