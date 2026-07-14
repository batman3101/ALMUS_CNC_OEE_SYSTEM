'use client';

import React, { useCallback } from 'react';
import { Button, Grid, Tooltip, App } from 'antd';
import { SunOutlined, MoonOutlined } from '@ant-design/icons';
import { useUserPreferences } from '@/contexts/UserPreferencesContext';
import { useLanguage } from '@/contexts/LanguageContext';

const { useBreakpoint } = Grid;

interface ThemeToggleProps {
  size?: 'small' | 'middle' | 'large';
  showTooltip?: boolean;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({
  size = 'middle',
  showTooltip = true
}) => {
  // 테마는 개인 환경설정이다. 전역 system_settings 가 아니라 내 프로필에만 저장된다.
  // (예전에는 전역 행을 고쳐서, 내가 다크로 바꾸면 다른 사용자 화면까지 다크가 됐다)
  const { themeMode, setThemeMode } = useUserPreferences();
  const { t } = useLanguage();
  const { message } = App.useApp();
  const screens = useBreakpoint();

  const isDark = themeMode === 'dark';

  // 테마 토글 핸들러
  const handleToggleTheme = useCallback(async () => {
    try {
      const newMode = isDark ? 'light' : 'dark';
      await setThemeMode(newMode);
      message.success(newMode === 'dark' ? t('theme.changedToDark') : t('theme.changedToLight'));
    } catch (error) {
      console.error('Theme toggle error:', error);
      message.error(t('theme.changeError'));
    }
  }, [isDark, setThemeMode, message, t]);

  // 토글 버튼 컨텐츠
  const buttonContent = (
    <Button
      type="text"
      icon={isDark ? <SunOutlined /> : <MoonOutlined />}
      size={size}
      onClick={handleToggleTheme}
      onKeyDown={(e) => {
        // 스페이스바와 엔터키로 토글 가능
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          handleToggleTheme();
        }
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 4,
        height: 'auto',
        padding: screens.xs ? '4px 8px' : '4px 12px',
        transition: 'all 0.3s ease'
      }}
      aria-label={isDark ? t('theme.switchToLightAria') : t('theme.switchToDarkAria')}
      aria-describedby="theme-toggle-description"
      role="switch"
      aria-checked={isDark}
      tabIndex={0}
    >
      {!screens.xs && (
        <span
          style={{
            fontSize: screens.xs ? '12px' : '14px',
            marginLeft: 2
          }}
          aria-hidden="true"
        >
          {isDark ? t('theme.light') : t('theme.dark')}
        </span>
      )}

      {/* 스크린리더용 숨김 설명 */}
      <span
        id="theme-toggle-description"
        style={{
          position: 'absolute',
          left: '-9999px',
          opacity: 0
        }}
      >
        {t('theme.currentMode', { mode: isDark ? t('theme.dark') : t('theme.light') })}
        {' '}
        {t('theme.switchInstruction', { mode: isDark ? t('theme.light') : t('theme.dark') })}
      </span>
    </Button>
  );

  // 모바일에서는 툴팁 비활성화
  if (!showTooltip || screens.xs) {
    return buttonContent;
  }

  // 데스크탑에서는 툴팁 표시
  return (
    <Tooltip
      title={isDark ? t('theme.switchToLight') : t('theme.switchToDark')}
      placement="bottom"
    >
      {buttonContent}
    </Tooltip>
  );
};

export default ThemeToggle;