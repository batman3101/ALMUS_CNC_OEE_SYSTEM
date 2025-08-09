'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageContextType } from '@/types';
import { getStoredLanguage, setStoredLanguage } from '@/utils/localStorage';

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

export const LanguageProvider: React.FC<LanguageProviderProps> = ({ children }) => {
  const { i18n, t } = useTranslation();
  const [language, setLanguage] = useState<'ko' | 'vi'>('ko');

  // 컴포넌트 마운트 시 로컬 스토리지에서 언어 설정 로드
  useEffect(() => {
    const savedLanguage = getStoredLanguage();
    if (savedLanguage) {
      setLanguage(savedLanguage);
      i18n.changeLanguage(savedLanguage);
    }
  }, [i18n]);

  const changeLanguage = (lang: 'ko' | 'vi') => {
    setLanguage(lang);
    i18n.changeLanguage(lang);
    setStoredLanguage(lang);
  };

  const value: LanguageContextType = {
    language,
    changeLanguage,
    t,
  };

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
};