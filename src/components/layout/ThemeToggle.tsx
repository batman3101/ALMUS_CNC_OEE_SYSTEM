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
        change_reason: '사용자가 헤더에서 테마 모드를 변경함'
      });

      if (success) {
        const modeText = newMode === 'dark' ? '다크 모드' : '라이트 모드';
        message.success(`${modeText}로 변경되었습니다.`);
      } else {
        message.error('테마 변경에 실패했습니다.');
      }
    } catch (error) {
      console.error('Theme toggle error:', error);
      message.error('테마 변경 중 오류가 발생했습니다.');
    }
  }, [isDark, updateSetting, message]);

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
      aria-label={isDark ? '라이트 모드로 전환하기' : '다크 모드로 전환하기'}
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
          {isDark ? '라이트' : '다크'}
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
        현재 {isDark ? '다크' : '라이트'} 모드입니다. 
        {isDark ? '라이트' : '다크'} 모드로 전환하려면 클릭하거나 스페이스/엔터키를 누르세요.
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
      title={isDark ? '라이트 모드로 전환' : '다크 모드로 전환'}
      placement="bottom"
    >
      {buttonContent}
    </Tooltip>
  );
};

export default ThemeToggle;