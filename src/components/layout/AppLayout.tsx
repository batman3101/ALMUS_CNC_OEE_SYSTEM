'use client';

import React, { useState, useEffect } from 'react';
import { Layout, Button, Dropdown, Typography, Grid, message } from 'antd';
import { 
  MenuFoldOutlined, 
  MenuUnfoldOutlined, 
  LogoutOutlined,
  UserOutlined 
} from '@ant-design/icons';
import { useLanguage } from '@/contexts/LanguageContext';
import { useAuth } from '@/contexts/AuthContext';
import { useNotifications } from '@/contexts/NotificationContext';
import { NotificationBadge, NotificationPanel } from '@/components/notifications';
import Sidebar from './Sidebar';
import LanguageToggle from './LanguageToggle';
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
  const { t } = useLanguage();
  const { user, logout } = useAuth();
  const { 
    notifications, 
    unreadCount, 
    acknowledgeNotification, 
    resolveNotification, 
    clearNotification, 
    clearAllNotifications 
  } = useNotifications();
  const screens = useBreakpoint();

  // 모바일에서는 기본적으로 사이드바를 접음
  useEffect(() => {
    if (screens.xs || screens.sm) {
      setCollapsed(true);
    } else if (screens.md || screens.lg || screens.xl) {
      setCollapsed(false);
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

  return (
    <Layout className={styles.appLayout}>
      <Sidebar collapsed={collapsed} onCollapse={setCollapsed} />
      <Layout>
        <Header className={styles.header}>
          <div className={styles.headerLeft}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed(!collapsed)}
              className={styles.menuToggle}
            />
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