'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSystemSettings } from './useSystemSettings';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { App } from 'antd';

export interface ThemeToggleState {
  isDark: boolean;
  isLoading: boolean;
  error: string | null;
}

/**
 * 테마 토글 전용 커스텀 훅
 * 테마 상태 관리, 토글 기능, 로컬 스토리지 동기화를 담당
 */
export function useThemeToggle() {
  // 테마 모드는 개인 환경설정이다. 전역 system_settings 를 쓰면 내 변경이 다른 사용자에게 전파된다.
  const { themeMode, setThemeMode } = useUserPreferences();
  const { getDisplaySettings } = useSystemSettings();
  const { message } = App.useApp();

  const [state, setState] = useState<ThemeToggleState>({
    isDark: false,
    isLoading: false,
    error: null
  });

  // 색상 팔레트 등은 여전히 회사 공통 설정에서 가져온다.
  const displaySettings = getDisplaySettings();
  const currentIsDark = themeMode === 'dark';

  // 상태 업데이트 (설정 변경 시 자동 반영)
  useEffect(() => {
    setState(prev => ({
      ...prev,
      isDark: currentIsDark,
      error: null
    }));
  }, [currentIsDark]);

  /**
   * 테마 토글 함수
   */
  const toggleTheme = useCallback(async (showMessage: boolean = true) => {
    setState(prev => ({ ...prev, isLoading: true, error: null }));

    try {
      const newMode = currentIsDark ? 'light' : 'dark';

      // 내 개인 설정만 갱신한다 (localStorage 동기화도 UserPreferences 가 담당한다).
      await setThemeMode(newMode);

      if (showMessage) {
        const modeText = newMode === 'dark' ? '다크 모드' : '라이트 모드';
        message.success(`${modeText}로 변경되었습니다.`);
      }

      setState(prev => ({
        ...prev,
        isDark: newMode === 'dark',
        isLoading: false,
        error: null
      }));

      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : '테마 변경 중 오류가 발생했습니다.';
      
      setState(prev => ({
        ...prev,
        isLoading: false,
        error: errorMessage
      }));

      if (showMessage) {
        message.error(errorMessage);
      }

      console.error('Theme toggle error:', error);
      return false;
    }
  }, [currentIsDark, setThemeMode, message]);

  /**
   * 특정 테마로 설정
   */
  const setTheme = useCallback(async (mode: 'light' | 'dark', showMessage: boolean = false) => {
    if (currentIsDark === (mode === 'dark')) {
      return true; // 이미 해당 모드임
    }
    
    return await toggleTheme(showMessage);
  }, [currentIsDark, toggleTheme]);

  /**
   * 시스템 테마 감지 및 적용
   */
  const applySystemTheme = useCallback(async (showMessage: boolean = false) => {
    if (typeof window === 'undefined') return false;

    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    return await setTheme(systemPrefersDark ? 'dark' : 'light', showMessage);
  }, [setTheme]);

  /**
   * 로컬 스토리지에서 테마 초기화
   */
  const initializeFromLocalStorage = useCallback(async () => {
    if (typeof window === 'undefined') return;

    try {
      const savedTheme = localStorage.getItem('theme-mode');
      if (savedTheme && (savedTheme === 'light' || savedTheme === 'dark')) {
        await setTheme(savedTheme, false);
      }
    } catch (error) {
      console.warn('Failed to initialize theme from localStorage:', error);
    }
  }, [setTheme]);

  /**
   * 에러 클리어
   */
  const clearError = useCallback(() => {
    setState(prev => ({ ...prev, error: null }));
  }, []);

  // 시스템 테마 변경 감지
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = () => {
      // 자동으로 시스템 테마를 적용하지는 않고, 감지만 함
      console.log('System theme changed:', mediaQuery.matches ? 'dark' : 'light');
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  return {
    // 상태
    isDark: state.isDark,
    isLoading: state.isLoading,
    error: state.error,
    mode: state.isDark ? 'dark' as const : 'light' as const,

    // 액션
    toggleTheme,
    setTheme,
    applySystemTheme,
    initializeFromLocalStorage,
    clearError,

    // 유틸리티
    isSystemDark: typeof window !== 'undefined' ? 
      window.matchMedia('(prefers-color-scheme: dark)').matches : false,
    displaySettings
  };
}

/**
 * 테마 토글 상태만 필요한 경우를 위한 간소화된 훅
 */
export function useThemeState() {
  const { isDark, mode, displaySettings } = useThemeToggle();
  return { isDark, mode, displaySettings };
}