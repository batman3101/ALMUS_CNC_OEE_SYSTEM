'use client';

import React from 'react';
import { Button, Dropdown, Grid } from 'antd';
import { GlobalOutlined, CheckOutlined } from '@ant-design/icons';
import { useLanguage } from '@/contexts/LanguageContext';
import type { MenuProps } from 'antd';

const { useBreakpoint } = Grid;

interface LanguageToggleProps {
  size?: 'small' | 'middle' | 'large';
  showText?: boolean;
}

const LanguageToggle: React.FC<LanguageToggleProps> = ({ 
  size = 'middle', 
  showText = true 
}) => {
  const { language, changeLanguage } = useLanguage();
  const screens = useBreakpoint();

  // 언어 옵션 정의
  const languageOptions = [
    {
      key: 'ko',
      label: '한국어',
      flag: '🇰🇷',
      code: 'KOR'
    },
    {
      key: 'vi',
      label: 'Tiếng Việt',
      flag: '🇻🇳',
      code: 'VIE'
    }
  ];

  // 현재 언어 정보
  const currentLanguage = languageOptions.find(lang => lang.key === language);

  // 드롭다운 메뉴 아이템
  const menuItems: MenuProps['items'] = languageOptions.map(lang => ({
    key: lang.key,
    label: (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'space-between',
        minWidth: 120
      }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span>{lang.flag}</span>
          <span>{lang.label}</span>
        </span>
        {language === lang.key && <CheckOutlined style={{ color: '#1890ff' }} />}
      </div>
    ),
    onClick: () => {
      if (language !== lang.key) {
        changeLanguage(lang.key as 'ko' | 'vi');
      }
    },
  }));

  // 모바일에서는 텍스트 숨김
  const shouldShowText = showText && !screens.xs;

  return (
    <Dropdown 
      menu={{ items: menuItems }} 
      placement="bottomLeft"
      trigger={['click']}
    >
      <Button 
        type="text" 
        icon={<GlobalOutlined />}
        size={size}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          height: 'auto',
          padding: screens.xs ? '4px 8px' : '4px 12px'
        }}
      >
        {shouldShowText && (
          <span style={{ fontSize: screens.xs ? '12px' : '14px' }}>
            {currentLanguage?.code}
          </span>
        )}
      </Button>
    </Dropdown>
  );
};

export default LanguageToggle;