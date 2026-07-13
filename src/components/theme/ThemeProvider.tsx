'use client';

import React, { useEffect, useState, useMemo } from 'react';
import { ConfigProvider, type ThemeConfig } from 'antd';
import { useThemeSettings } from '@/hooks/useThemeSettings';
import { useSystemSettings } from '@/hooks/useSystemSettings';

interface ThemeProviderProps {
  children: React.ReactNode;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({ children }) => {
  const { settings } = useSystemSettings();
  const { antdTheme: customTheme } = useThemeSettings();
  const [isTransitioning, setIsTransitioning] = useState(false);

  // 원시값(mode)만 의존성으로 사용 — settings 객체나 getDisplaySettings 함수의
  // 참조가 상위에서 매 렌더마다 바뀌더라도 실제 모드가 그대로면 재실행되지 않는다.
  const mode = settings.display?.theme_mode ?? 'light';

  // 테마 모드에 따른 CSS 변수 값 (mode가 실제로 바뀔 때만 새 객체 생성)
  const themeCssVars = useMemo(() => ({
    bgPrimary: mode === 'dark' ? '#000000' : '#ffffff',
    bgSecondary: mode === 'dark' ? '#141414' : '#f5f5f5',
    bgElevated: mode === 'dark' ? '#1f1f1f' : '#ffffff',
    textPrimary: mode === 'dark' ? 'rgba(255, 255, 255, 0.88)' : 'rgba(0, 0, 0, 0.88)',
    textSecondary: mode === 'dark' ? 'rgba(255, 255, 255, 0.65)' : 'rgba(0, 0, 0, 0.65)',
    border: mode === 'dark' ? '#424242' : '#d9d9d9',
  }), [mode]);

  // 테마 전환 감지 및 부드러운 전환 처리
  useEffect(() => {
    // 테마 전환 시작 표시
    setIsTransitioning(true);

    // CSS 변수 즉시 업데이트 (Ant Design과 별개로)
    const rootEl = document.documentElement;

    // 테마별 CSS 커스텀 속성 적용
    rootEl.style.setProperty('--theme-transition-duration', '0.3s');
    rootEl.style.setProperty('--theme-bg-primary', themeCssVars.bgPrimary);
    rootEl.style.setProperty('--theme-bg-secondary', themeCssVars.bgSecondary);
    rootEl.style.setProperty('--theme-bg-elevated', themeCssVars.bgElevated);
    rootEl.style.setProperty('--theme-text-primary', themeCssVars.textPrimary);
    rootEl.style.setProperty('--theme-text-secondary', themeCssVars.textSecondary);
    rootEl.style.setProperty('--theme-border', themeCssVars.border);

    // 전환 완료 처리
    const timer = setTimeout(() => {
      setIsTransitioning(false);
    }, 300);

    return () => clearTimeout(timer);
  }, [themeCssVars]);

  // 전역 테마 전환 CSS 추가 (최초 1회만 삽입)
  useEffect(() => {
    const existingStyle = document.getElementById('theme-transitions');
    if (!existingStyle) {
      const style = document.createElement('style');
      style.id = 'theme-transitions';
      style.textContent = `
        /* 테마 전환이 진행 중일 때(.theme-transitioning)만 부드러운 애니메이션 적용.
           평상시(호버/포커스/클릭 등)에는 각 컴포넌트 고유의 전환 속도를 그대로 사용한다. */
        .theme-transitioning,
        .theme-transitioning * {
          transition:
            background-color var(--theme-transition-duration, 0.3s) ease,
            border-color var(--theme-transition-duration, 0.3s) ease,
            color var(--theme-transition-duration, 0.3s) ease,
            box-shadow var(--theme-transition-duration, 0.3s) ease;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  return (
    <ConfigProvider theme={customTheme as ThemeConfig}>
      <div
        className={`theme-provider-wrapper ${isTransitioning ? 'theme-transitioning' : ''}`}
        style={{
          minHeight: '100vh'
        }}
      >
        {children}
      </div>
    </ConfigProvider>
  );
};
