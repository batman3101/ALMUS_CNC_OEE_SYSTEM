'use client';

import { useEffect } from 'react';
import { useSystemSettings } from './useSystemSettings';
import { ConfigProvider, theme } from 'antd';

/**
 * 테마 설정을 실시간으로 적용하는 훅
 */
export function useThemeSettings() {
  const { getDisplaySettings, settings } = useSystemSettings();

  // 테마 색상 및 모드 적용
  useEffect(() => {
    const displaySettings = getDisplaySettings();
    
    // CSS 변수로 테마 색상 적용
    const root = document.documentElement;
    root.style.setProperty('--ant-primary-color', displaySettings.theme.primary);
    root.style.setProperty('--ant-success-color', displaySettings.theme.success);
    root.style.setProperty('--ant-warning-color', displaySettings.theme.warning);
    root.style.setProperty('--ant-error-color', displaySettings.theme.error);

    // 테마 모드 적용
    document.body.setAttribute('data-theme', displaySettings.mode);
    
    // HTML 클래스 적용 (다른 라이브러리 호환성)
    if (displaySettings.mode === 'dark') {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
    }

    // 메타 태그 업데이트 (브라우저 테마 색상)
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    const themeColor = displaySettings.mode === 'dark' ? '#141414' : displaySettings.theme.primary;
    
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', themeColor);
    } else {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = themeColor;
      document.head.appendChild(meta);
    }
  }, [settings.display, getDisplaySettings]);

  // Ant Design 테마 객체 생성
  const getAntdTheme = () => {
    const displaySettings = getDisplaySettings();
    const isDark = displaySettings.mode === 'dark';
    
    return {
      algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: displaySettings.theme.primary,
        colorSuccess: displaySettings.theme.success,
        colorWarning: displaySettings.theme.warning,
        colorError: displaySettings.theme.error,
        colorInfo: displaySettings.theme.primary,
        
        // 레이아웃
        borderRadius: 6,
        borderRadiusLG: 8,
        borderRadiusSM: 4,
        
        // 폰트
        fontSize: displaySettings.compactMode ? 12 : 14,
        fontSizeLG: displaySettings.compactMode ? 14 : 16,
        fontSizeSM: displaySettings.compactMode ? 10 : 12,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',
        
        // 간격
        padding: displaySettings.compactMode ? 12 : 16,
        paddingLG: displaySettings.compactMode ? 16 : 24,
        paddingSM: displaySettings.compactMode ? 8 : 12,
        paddingXS: displaySettings.compactMode ? 4 : 8,
        
        // 다크/라이트 테마별 색상
        colorBgContainer: isDark ? '#141414' : '#ffffff',
        colorBgElevated: isDark ? '#1f1f1f' : '#ffffff',
        colorBgLayout: isDark ? '#000000' : '#f5f5f5',
        colorBgBase: isDark ? '#000000' : '#ffffff',
        
        // 텍스트 색상
        colorText: isDark ? 'rgba(255, 255, 255, 0.88)' : 'rgba(0, 0, 0, 0.88)',
        colorTextSecondary: isDark ? 'rgba(255, 255, 255, 0.65)' : 'rgba(0, 0, 0, 0.65)',
        colorTextTertiary: isDark ? 'rgba(255, 255, 255, 0.45)' : 'rgba(0, 0, 0, 0.45)',
        colorTextQuaternary: isDark ? 'rgba(255, 255, 255, 0.25)' : 'rgba(0, 0, 0, 0.25)',
        
        // 테두리 색상
        colorBorder: isDark ? '#424242' : '#d9d9d9',
        colorBorderSecondary: isDark ? '#303030' : '#f0f0f0',
        
        // 그림자
        boxShadow: isDark 
          ? '0 1px 2px 0 rgba(0, 0, 0, 0.16), 0 1px 6px -1px rgba(0, 0, 0, 0.12), 0 2px 4px 0 rgba(0, 0, 0, 0.09)'
          : '0 1px 2px 0 rgba(0, 0, 0, 0.03), 0 1px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px 0 rgba(0, 0, 0, 0.02)',
        boxShadowSecondary: isDark 
          ? '0 4px 12px 0 rgba(0, 0, 0, 0.15)'
          : '0 4px 12px 0 rgba(0, 0, 0, 0.05)',
      },
      components: {
        Layout: {
          headerBg: isDark ? '#141414' : '#ffffff',
          siderBg: isDark ? '#001529' : '#001529', // 사이드바는 항상 다크
          bodyBg: isDark ? '#000000' : '#f5f5f5',
          headerHeight: 64,
          headerPadding: '0 24px',
        },
        Menu: {
          darkItemBg: '#001529',
          darkSubMenuItemBg: '#000c17',
          darkItemSelectedBg: displaySettings.theme.primary,
          darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
          darkItemColor: 'rgba(255, 255, 255, 0.88)',
          darkItemSelectedColor: '#ffffff',
          darkGroupTitleColor: 'rgba(255, 255, 255, 0.67)',
        },
        Button: {
          borderRadius: 6,
          controlHeight: displaySettings.compactMode ? 28 : 32,
          controlHeightLG: displaySettings.compactMode ? 36 : 40,
          controlHeightSM: displaySettings.compactMode ? 20 : 24,
        },
        Card: {
          borderRadius: 8,
          paddingLG: displaySettings.compactMode ? 16 : 24,
          headerBg: isDark ? '#141414' : '#fafafa',
          colorBgContainer: isDark ? '#141414' : '#ffffff',
        },
        Table: {
          cellPaddingBlock: displaySettings.compactMode ? 8 : 12,
          cellPaddingInline: displaySettings.compactMode ? 8 : 16,
          headerBg: isDark ? '#1f1f1f' : '#fafafa',
          rowHoverBg: isDark ? '#262626' : '#f5f5f5',
        },
        Input: {
          colorBgContainer: isDark ? '#141414' : '#ffffff',
          colorBorder: isDark ? '#424242' : '#d9d9d9',
        },
        Select: {
          colorBgContainer: isDark ? '#141414' : '#ffffff',
          colorBorder: isDark ? '#424242' : '#d9d9d9',
        },
        Modal: {
          contentBg: isDark ? '#141414' : '#ffffff',
          headerBg: isDark ? '#141414' : '#ffffff',
        },
        Drawer: {
          colorBgElevated: isDark ? '#141414' : '#ffffff',
        },
        Tabs: {
          cardBg: isDark ? '#141414' : '#ffffff',
          itemColor: isDark ? 'rgba(255, 255, 255, 0.65)' : 'rgba(0, 0, 0, 0.65)',
          itemSelectedColor: displaySettings.theme.primary,
          itemHoverColor: displaySettings.theme.primary,
        }
      },
    };
  };

  return {
    antdTheme: getAntdTheme(),
    applyTheme: () => {
      const displaySettings = getDisplaySettings();
      const root = document.documentElement;
      root.style.setProperty('--ant-primary-color', displaySettings.theme.primary);
      root.style.setProperty('--ant-success-color', displaySettings.theme.success);
      root.style.setProperty('--ant-warning-color', displaySettings.theme.warning);
      root.style.setProperty('--ant-error-color', displaySettings.theme.error);
    }
  };
}