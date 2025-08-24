'use client';

import React from 'react';
import { ConfigProvider, App, theme } from 'antd';
import koKR from 'antd/locale/ko_KR';
import viVN from 'antd/locale/vi_VN';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { AuthProvider } from '@/contexts/AuthContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { SystemSettingsProvider } from '@/contexts/SystemSettingsContext';
import { ToastNotificationProvider } from '@/components/notifications';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import '@/lib/i18n'; // i18n 초기화

// Ant Design 로케일 설정을 위한 내부 컴포넌트
const AntdConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { language } = useLanguage();
  
  const locale = language === 'ko' ? koKR : viVN;
  
  return (
    <ConfigProvider locale={locale}>
      <App>
        {children}
      </App>
    </ConfigProvider>
  );
};

export const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <LanguageProvider>
      <AuthProvider>
        <SystemSettingsProvider>
          <NotificationProvider>
            <ToastNotificationProvider>
              <ThemeProvider>
                <AntdConfigProvider>
                  {children}
                </AntdConfigProvider>
              </ThemeProvider>
            </ToastNotificationProvider>
          </NotificationProvider>
        </SystemSettingsProvider>
      </AuthProvider>
    </LanguageProvider>
  );
};