'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { ConfigProvider } from 'antd';
import { useThemeSettings } from '@/hooks/useThemeSettings';
import { useSystemSettings } from '@/hooks/useSystemSettings';

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const systemSettings = useSystemSettings();
  const { antdTheme: customTheme } = useThemeSettings();
  const [isTransitioning, setIsTransitioning] = useState(false);
  
  // getDisplaySettings 함수를 메모이제이션
  const getDisplaySettings = useMemo(() => {
    return systemSettings?.getDisplaySettings || (() => ({
      mode: 'light',
      theme: {
        primary: '#1890ff',
        success: '#52c41a',
        warning: '#faad14',
        error: '#ff4d4f'
      },
      refreshInterval: 30,
      chartAnimation: true,
      compactMode: false,
      showMachineImages: true,
      sidebarCollapsed: false
    }));
  }, [systemSettings?.getDisplaySettings]);

  // 테마 전환 감지 및 부드러운 전환 처리
  useEffect(() => {
    const displaySettings = getDisplaySettings();
    
    // 테마 전환 시작 표시
    setIsTransitioning(true);
    
    // CSS 변수 즉시 업데이트 (Ant Design과 별개로)
    const rootEl = document.documentElement;

    // 테마별 CSS 커스텀 속성 적용
    rootEl.style.setProperty('--theme-transition-duration', '0.3s');
    rootEl.style.setProperty('--theme-bg-primary', displaySettings.mode === 'dark' ? '#000000' : '#ffffff');
    rootEl.style.setProperty('--theme-bg-secondary', displaySettings.mode === 'dark' ? '#141414' : '#f5f5f5');
    rootEl.style.setProperty('--theme-bg-elevated', displaySettings.mode === 'dark' ? '#1f1f1f' : '#ffffff');
    rootEl.style.setProperty('--theme-text-primary', displaySettings.mode === 'dark' ? 'rgba(255, 255, 255, 0.88)' : 'rgba(0, 0, 0, 0.88)');
    rootEl.style.setProperty('--theme-text-secondary', displaySettings.mode === 'dark' ? 'rgba(255, 255, 255, 0.65)' : 'rgba(0, 0, 0, 0.65)');
    rootEl.style.setProperty('--theme-border', displaySettings.mode === 'dark' ? '#424242' : '#d9d9d9');

    // 전환 완료 처리
    const timer = setTimeout(() => {
      setIsTransitioning(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [customTheme, getDisplaySettings]);

  // 초기 테마 설정 (페이지 로드 시)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const docRoot = document.documentElement;
    
    // 전역 테마 전환 CSS 추가
    const existingStyle = document.getElementById('theme-transitions');
    if (!existingStyle) {
      const style = document.createElement('style');
      style.id = 'theme-transitions';
      style.textContent = `
        * {
          transition: 
            background-color var(--theme-transition-duration, 0.3s) ease,
            border-color var(--theme-transition-duration, 0.3s) ease,
            color var(--theme-transition-duration, 0.3s) ease,
            box-shadow var(--theme-transition-duration, 0.3s) ease !important;
        }
        
        /* 특정 요소들의 전환 최적화 */
        .ant-layout,
        .ant-layout-header,
        .ant-layout-content,
        .ant-layout-sider,
        .ant-card,
        .ant-table,
        .ant-modal,
        .ant-drawer {
          transition: 
            background-color var(--theme-transition-duration, 0.3s) ease,
            border-color var(--theme-transition-duration, 0.3s) ease,
            box-shadow var(--theme-transition-duration, 0.3s) ease !important;
        }
        
        /* 텍스트 전환 */
        .ant-typography,
        .ant-btn,
        .ant-menu,
        .ant-table-tbody > tr > td,
        .ant-table-thead > tr > th {
          transition: 
            color var(--theme-transition-duration, 0.3s) ease !important;
        }
        
        /* 페이드 인/아웃 동안 깜박임 방지 */
        body {
          transition: background-color var(--theme-transition-duration, 0.3s) ease;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  return (
    <ConfigProvider theme={customTheme}>
      <div 
        className={`theme-provider-wrapper ${isTransitioning ? 'theme-transitioning' : ''}`}
        style={{
          minHeight: '100vh',
          transition: 'all 0.3s ease'
        }}
      >
        {children}
      </div>
    </ConfigProvider>
  );
};