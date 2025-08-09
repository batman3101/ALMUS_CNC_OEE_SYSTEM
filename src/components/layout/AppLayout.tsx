'use client';

import React, { useState, useEffect } from 'react';
import { Layout, Button, Dropdown, Typography, Grid } from 'antd';
import { 
  MenuFoldOutlined, 
  MenuUnfoldOutlined, 
  LogoutOutlined,
  UserOutlined 
} from '@ant-design/icons';
import { useLanguage } from '@/contexts/LanguageContext';
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
  const { t } = useLanguage();
  const screens = useBreakpoint();

  // 모바일에서는 기본적으로 사이드바를 접음
  useEffect(() => {
    if (screens.xs || screens.sm) {
      setCollapsed(true);
    } else if (screens.md || screens.lg || screens.xl) {
      setCollapsed(false);
    }
  }, [screens]);



  // 사용자 메뉴 아이템 (임시)
  const userItems = [
    {
      key: 'logout',
      label: t('auth.logout'),
      icon: <LogoutOutlined />,
      onClick: () => {
        // TODO: 로그아웃 로직 구현
        console.log('Logout clicked');
      },
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
            {/* 언어 전환 컴포넌트 */}
            <LanguageToggle size={screens.xs ? 'small' : 'middle'} />
            
            {/* 사용자 메뉴 드롭다운 */}
            <Dropdown menu={{ items: userItems }} placement="bottomRight">
              <Button 
                type="text" 
                icon={<UserOutlined />}
                size={screens.xs ? 'small' : 'middle'}
              >
                {!screens.xs && '사용자'} {/* TODO: 실제 사용자 이름으로 교체 */}
              </Button>
            </Dropdown>
          </div>
        </Header>
        
        <Content className={styles.content}>
          {children}
        </Content>
      </Layout>
    </Layout>
  );
};

export default AppLayout;