'use client';

import React, { ReactNode, useMemo } from 'react';
import { ConfigProvider } from 'antd';
import dayjs from 'dayjs';
import 'dayjs/locale/ko';
import 'dayjs/locale/vi';
import koKR from 'antd/locale/ko_KR';
import viVN from 'antd/locale/vi_VN';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useLanguage } from '@/contexts/LanguageContext';

interface AntdConfigProviderProps {
  children: ReactNode;
}

/**
 * Ant Design ConfigProvider
 * 시스템 설정에 따른 전역 날짜/시간 형식 및 로케일 설정 제공
 */
export const AntdConfigProvider: React.FC<AntdConfigProviderProps> = ({ children }) => {
  const { getDisplaySettings } = useSystemSettings();
  const { language } = useLanguage();

  const locale = useMemo(() => {
    // dayjs 로케일 설정
    if (language === 'ko') {
      dayjs.locale('ko');
      return koKR;
    } else {
      dayjs.locale('vi');
      return viVN;
    }
  }, [language]);

  const theme = useMemo(() => {
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
      algorithm: displaySettings.mode === 'dark' ? 'darkAlgorithm' : 'defaultAlgorithm',
      components: {
        DatePicker: {
          // 시스템 설정에 따른 기본 날짜 형식
          // Ant Design에서 지원하는 형식으로 변환
        },
        TimePicker: {
          // 시스템 설정에 따른 기본 시간 형식
        },
        Table: {
          // 테이블 내 날짜/시간 컬럼 스타일
        },
      },
    };
  }, [getDisplaySettings]);

  return (
    <ConfigProvider
      locale={locale}
      theme={theme}
    >
      {children}
    </ConfigProvider>
  );
};

export default AntdConfigProvider;