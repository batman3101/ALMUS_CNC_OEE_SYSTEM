'use client';

import React, { useCallback } from 'react';
import { Button, Grid, Tooltip, App } from 'antd';
import { SunOutlined, MoonOutlined } from '@ant-design/icons';
import { useSystemSettings } from '@/hooks/useSystemSettings';
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
  const { getDisplaySettings, updateSetting } = useSystemSettings();
  const { t } = useLanguage();
  const { message } = App.useApp();
  const screens = useBreakpoint();

  // 현재 테마 모드 가져오기
  const displaySettings = getDisplaySettings();
  const isDark = displaySettings.mode === 'dark';

  // 테마 토글 핸들러
  const handleToggleTheme = useCallback(async () => {
    try {
      const newMode = isDark ? 'light' : 'dark';

      const success = await updateSetting({
        category: 'display',
        setting_key: 'theme_mode',
        setting_value: newMode,
        change_reason: 'User changed theme mode from header'
      });

      if (success) {
        message.success(newMode === 'dark' ? t('theme.changedToDark') : t('theme.changedToLight'));
      } else {
        message.error(t('theme.changeFailed'));
      }
    } catch (error) {
      console.error('Theme toggle error:', error);
      message.error(t('theme.changeError'));
    }
  }, [isDark, updateSetting, message, t]);

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