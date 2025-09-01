'use client';

import { useCallback, useEffect, useState } from 'react';
import { useSystemSettings } from './useSystemSettings';
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
  const { getDisplaySettings, updateSetting } = useSystemSettings();
  const { message } = App.useApp();
  
  const [state, setState] = useState<ThemeToggleState>({
    isDark: false,
    isLoading: false,
    error: null
  });

  // 현재 테마 모드 확인
  const displaySettings = getDisplaySettings();
  const currentIsDark = displaySettings.mode === 'dark';

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
      
      // 시스템 설정 업데이트
      const success = await updateSetting({
        category: 'display',
        setting_key: 'theme_mode',
        setting_value: newMode,
        change_reason: '사용자가 테마 토글을 통해 모드를 변경함'
      });

      if (success) {
        // 로컬 스토리지에도 저장 (빠른 로딩을 위해)
        try {
          localStorage.setItem('theme-mode', newMode);
        } catch (localStorageError) {
          console.warn('localStorage theme-mode update failed:', localStorageError);
        }

        // 성공 메시지 (옵션)
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
      } else {
        throw new Error('테마 설정 업데이트에 실패했습니다.');
      }
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
  }, [currentIsDark, updateSetting, message]);

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