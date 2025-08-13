'use client';

import React from 'react';
import { ConfigProvider } from 'antd';
import koKR from 'antd/locale/ko_KR';
import viVN from 'antd/locale/vi_VN';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { ToastNotificationProvider } from '@/components/notifications';
import '@/lib/i18n'; // i18n 초기화

// Ant Design 테마 설정
const theme = {
  token: {
    // 기본 색상
    colorPrimary: '#1890ff',
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorInfo: '#1890ff',
    
    // 레이아웃
    borderRadius: 6,
    borderRadiusLG: 8,
    borderRadiusSM: 4,
    
    // 폰트
    fontSize: 14,
    fontSizeLG: 16,
    fontSizeSM: 12,
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
    
    // 간격
    padding: 16,
    paddingLG: 24,
    paddingSM: 12,
    paddingXS: 8,
    
    // 그림자
    boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px 0 rgba(0, 0, 0, 0.02)',
    boxShadowSecondary: '0 4px 12px 0 rgba(0, 0, 0, 0.05)',
    
    // 색상 배경
    colorBgContainer: '#ffffff',
    colorBgElevated: '#ffffff',
    colorBgLayout: '#f5f5f5',
    
    // 텍스트 색상
    colorText: 'rgba(0, 0, 0, 0.88)',
    colorTextSecondary: 'rgba(0, 0, 0, 0.65)',
    colorTextTertiary: 'rgba(0, 0, 0, 0.45)',
    colorTextQuaternary: 'rgba(0, 0, 0, 0.25)',
    
    // 테두리 색상
    colorBorder: '#d9d9d9',
    colorBorderSecondary: '#f0f0f0',
  },
  components: {
    Layout: {
      headerBg: '#ffffff',
      siderBg: '#001529',
      bodyBg: '#f5f5f5',
    },
    Menu: {
      darkItemBg: '#001529',
      darkSubMenuItemBg: '#000c17',
      darkItemSelectedBg: '#1890ff',
      darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
    },
    Button: {
      borderRadius: 6,
      controlHeight: 32,
      controlHeightLG: 40,
      controlHeightSM: 24,
    },
    Card: {
      borderRadius: 8,
      boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02)',
    },
  },
};

// Ant Design 로케일 설정을 위한 내부 컴포넌트
const AntdConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { language } = useLanguage();
  
  const locale = language === 'ko' ? koKR : viVN;
  
  return (
    <ConfigProvider theme={theme} locale={locale}>
      {children}
    </ConfigProvider>
  );
};

export const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <LanguageProvider>
      <AuthProvider>
        <NotificationProvider>
          <ToastNotificationProvider>
            <AntdConfigProvider>
              {children}
            </AntdConfigProvider>
          </ToastNotificationProvider>
        </NotificationProvider>
      </AuthProvider>
    </LanguageProvider>
  );
};