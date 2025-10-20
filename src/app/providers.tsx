'use client';

import React, { useMemo } from 'react';
import { ConfigProvider, App, theme } from 'antd';
import koKR from 'antd/locale/ko_KR';
import viVN from 'antd/locale/vi_VN';
import { I18nextProvider } from 'react-i18next';
import { LanguageProvider, useLanguage } from '@/contexts/LanguageContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { AuthProvider } from '@/contexts/AuthContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { SystemSettingsProvider } from '@/contexts/SystemSettingsContext';
import { ToastNotificationProvider } from '@/components/notifications';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import i18n from '@/lib/i18n'; // i18n 초기화

// 시스템 설정 기반 Ant Design 설정을 위한 내부 컴포넌트
const AntdConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { language } = useLanguage();
  const {
    getDisplaySettings,
    getCompanyInfo
  } = useSystemSettings();
  
  const locale = useMemo(() => {
    const companyInfo = getCompanyInfo();
    // 시스템 설정 언어를 우선하되, 없으면 LanguageContext 사용
    const settingsLanguage = companyInfo.language || language;
    return settingsLanguage === 'ko' ? koKR : viVN;
  }, [getCompanyInfo, language]);

  const themeConfig = useMemo(() => {
    const displaySettings = getDisplaySettings();
    
    return {
      token: {
        colorPrimary: displaySettings.theme.primary,
        colorSuccess: displaySettings.theme.success,
        colorWarning: displaySettings.theme.warning,
        colorError: displaySettings.theme.error,
        borderRadius: 6,
        wireframe: false,
      },
      algorithm: displaySettings.mode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    };
  }, [getDisplaySettings]);
  
  return (
    <ConfigProvider 
      locale={locale}
      theme={themeConfig}
    >
      <App>
        {children}
      </App>
    </ConfigProvider>
  );
};

export const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <SystemSettingsProvider>
          <LanguageProvider>
            <NotificationProvider>
              <ToastNotificationProvider>
                <ThemeProvider>
                  <AntdConfigProvider>
                    {children}
                  </AntdConfigProvider>
                </ThemeProvider>
              </ToastNotificationProvider>
            </NotificationProvider>
          </LanguageProvider>
        </SystemSettingsProvider>
      </AuthProvider>
    </I18nextProvider>
  );
};