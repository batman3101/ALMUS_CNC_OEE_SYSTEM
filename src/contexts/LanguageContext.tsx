'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { LanguageContextType } from '@/types';
import { getStoredLanguage, setStoredLanguage } from '@/utils/localStorage';
import { useSystemSettings } from '@/contexts/SystemSettingsContext';

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
  const [isInitialized, setIsInitialized] = useState(false);
  
  const { 
    getSetting, 
    updateSetting, 
    isLoading: systemSettingsLoading 
  } = useSystemSettings();

  // SystemSettings에서 언어 설정 초기화
  useEffect(() => {
    if (systemSettingsLoading || isInitialized) return;

    const initializeLanguage = async () => {
      try {
        // 1. 먼저 SystemSettings에서 언어 설정 확인
        const systemLanguage = getSetting('general', 'language');
        let targetLanguage: 'ko' | 'vi' = 'ko';

        if (systemLanguage) {
          targetLanguage = systemLanguage as 'ko' | 'vi';
          console.log('언어 설정을 SystemSettings에서 로드:', targetLanguage);
        } else {
          // 2. SystemSettings에 없다면 localStorage에서 확인
          const localLanguage = getStoredLanguage();
          if (localLanguage) {
            targetLanguage = localLanguage;
            console.log('언어 설정을 localStorage에서 로드:', targetLanguage);

            // SystemSettings에 저장 (DB 의 canonical key 는 default_language)
            await updateSetting({
              category: 'general',
              setting_key: 'default_language',
              setting_value: targetLanguage
            });
          }
        }

        // 3. 언어 설정 적용
        setLanguage(targetLanguage);
        await i18n.changeLanguage(targetLanguage);
        setStoredLanguage(targetLanguage);
        setIsInitialized(true);
        
        console.log('언어 초기화 완료:', targetLanguage);
      } catch (error) {
        console.error('언어 초기화 중 오류:', error);
        // 오류 발생 시 기본값으로 설정
        setLanguage('ko');
        await i18n.changeLanguage('ko');
        setStoredLanguage('ko');
        setIsInitialized(true);
      }
    };

    initializeLanguage();
  }, [systemSettingsLoading, isInitialized, getSetting, updateSetting, i18n]);

  // SystemSettings 변경 감지 및 동기화
  useEffect(() => {
    if (!isInitialized || systemSettingsLoading) return;

    const systemLanguage = getSetting('general', 'language');
    if (systemLanguage && systemLanguage !== language) {
      const newLanguage = systemLanguage as 'ko' | 'vi';
      console.log('SystemSettings에서 언어 변경 감지:', newLanguage);
      setLanguage(newLanguage);
      i18n.changeLanguage(newLanguage);
      setStoredLanguage(newLanguage);
    }
  }, [getSetting('general', 'language'), language, isInitialized, systemSettingsLoading, i18n]);

  const changeLanguage = useCallback(async (lang: 'ko' | 'vi') => {
    if (language === lang) return;

    try {
      console.log('언어 변경 시작:', lang);
      
      // 1. 로컬 상태 업데이트
      setLanguage(lang);
      
      // 2. i18next 업데이트
      await i18n.changeLanguage(lang);
      
      // 3. localStorage 업데이트
      setStoredLanguage(lang);
      
      // 4. SystemSettings 업데이트 (DB 의 canonical key 는 default_language)
      const success = await updateSetting({
        category: 'general',
        setting_key: 'default_language',
        setting_value: lang
      });

      if (success) {
        console.log('언어 설정이 모든 저장소에 성공적으로 업데이트됨:', lang);
      } else {
        console.error('SystemSettings 업데이트 실패');
      }
    } catch (error) {
      console.error('언어 변경 중 오류:', error);
      // 오류 발생 시 이전 상태로 복원
      setLanguage(language);
      await i18n.changeLanguage(language);
      setStoredLanguage(language);
    }
  }, [language, i18n, updateSetting]);

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