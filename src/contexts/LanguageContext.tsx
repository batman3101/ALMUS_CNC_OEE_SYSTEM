'use client';

import React, { createContext, useContext, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageContextType } from '@/types';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};

interface LanguageProviderProps {
  children: React.ReactNode;
}

/**
 * 언어는 "개인 환경설정"이다. 전역 system_settings 가 아니라 UserPreferences 를 따른다.
 *
 * 예전에는 이 컨텍스트가
 *   1) system_settings.default_language 를 직접 읽고 쓰고,
 *   2) 그 값이 로컬 상태와 다르면 사용자의 선택을 되돌리는 effect 를 갖고 있었다.
 * system_settings 는 사용자 구분이 없는 전역 행이라, 다른 사용자가 언어를 바꾸면
 * 그 값이 Realtime 으로 전파되어 내 화면까지 바뀌었고, 서로 다른 언어를 원하면
 * 두 클라이언트가 같은 행을 되돌려 쓰며 무한히 뒤집혔다.
 *
 * 이제 값의 출처는 UserPreferences 하나뿐이고(내 프로필 -> localStorage -> 시스템 기본값),
 * 여기서는 그 값을 i18next 에 반영하는 일만 한다. 되돌리는 effect 는 존재하지 않는다.
 */
export const LanguageProvider: React.FC<LanguageProviderProps> = ({ children }) => {
  const { i18n, t } = useTranslation();
  const { language, setLanguage } = useUserPreferences();

  // 개인 설정 -> i18next 단방향 반영
  useEffect(() => {
    if (i18n.language !== language) {
      i18n.changeLanguage(language);
    }
  }, [language, i18n]);

  const changeLanguage = useCallback(async (lang: 'ko' | 'vi') => {
    await setLanguage(lang);
  }, [setLanguage]);

  const value: LanguageContextType = useMemo(() => ({
    language,
    changeLanguage,
    t,
  }), [language, changeLanguage, t]);

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};
