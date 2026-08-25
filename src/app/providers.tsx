'use client';

import '@ant-design/v5-patch-for-react-19';
import React, { useMemo } from 'react';
import { ConfigProvider, App, theme } from 'antd';
import koKR from 'antd/locale/ko_KR';
import viVN from 'antd/locale/vi_VN';
import { I18nextProvider } from 'react-i18next';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { UserPreferencesProvider, useUserPreferences } from '@/contexts/UserPreferencesContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { AuthProvider } from '@/contexts/AuthContext';
import { FactoryProvider } from '@/contexts/FactoryContext';
import { NotificationProvider } from '@/contexts/NotificationContext';
import { SystemSettingsProvider } from '@/contexts/SystemSettingsContext';
import { DateRangeProvider } from '@/contexts/DateRangeContext';
import { ToastNotificationProvider } from '@/components/notifications';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import i18n from '@/lib/i18n'; // i18n 초기화

// 시스템 설정 기반 Ant Design 설정을 위한 내부 컴포넌트
const AntdConfigProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // 언어와 다크/라이트 모드는 개인 환경설정을 따른다.
  // 예전에는 여기서도 전역 system_settings 의 언어/모드를 "우선"했기 때문에,
  // 사용자가 토글로 바꿔도 antd 로케일과 알고리즘은 남의 설정을 따라가 버렸다.
  const { language, themeMode } = useUserPreferences();
  const { getDisplaySettings } = useSystemSettings();

  const locale = useMemo(() => (language === 'ko' ? koKR : viVN), [language]);

  const themeConfig = useMemo(() => {
    // 색상 팔레트는 회사 공통 브랜딩이므로 전역 설정을 그대로 쓴다.
    const displaySettings = getDisplaySettings();

    return {
      token: {
        colorPrimary: String(displaySettings.theme.primary),
        colorSuccess: String(displaySettings.theme.success),
        colorWarning: String(displaySettings.theme.warning),
        colorError: String(displaySettings.theme.error),
        borderRadius: 6,
        wireframe: false,
      },
      algorithm: themeMode === 'dark' ? theme.darkAlgorithm : theme.defaultAlgorithm,
    };
  }, [getDisplaySettings, themeMode]);
  
  return (
    <ConfigProvider 
      locale={locale}
      theme={themeConfig}
    >
      <App
        notification={{
          placement: 'topRight',
          duration: 4.5,
          maxCount: 5,
          rtl: false,
        }}
      >
        {children}
      </App>
    </ConfigProvider>
  );
};

export const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  return (
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        {/* 공장은 세션에서 나오고(Auth 아래), 설정·구독보다 먼저 정해져야 한다.
            설정은 공장별로 다른 행이고 Realtime 구독도 공장으로 좁히므로, 이 provider 가
            그 둘보다 위에 있어야 "어느 공장인지 모르는 채로" 읽거나 구독하지 않는다. */}
        <FactoryProvider>
        <SystemSettingsProvider>
          {/* 개인 환경설정은 "내 프로필"(Auth)과 "시스템 기본값"(SystemSettings)을 모두 필요로 하므로
              둘 아래에 두고, 이를 소비하는 Language/Theme 계층보다는 위에 둔다. */}
          <UserPreferencesProvider>
            <LanguageProvider>
              <DateRangeProvider>
                <ThemeProvider>
                  <AntdConfigProvider>
                    <ToastNotificationProvider>
                      <NotificationProvider>
                        {children}
                      </NotificationProvider>
                    </ToastNotificationProvider>
                  </AntdConfigProvider>
                </ThemeProvider>
              </DateRangeProvider>
            </LanguageProvider>
          </UserPreferencesProvider>
        </SystemSettingsProvider>
        </FactoryProvider>
      </AuthProvider>
    </I18nextProvider>
  );
};
