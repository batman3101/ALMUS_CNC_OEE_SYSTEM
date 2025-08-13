'use client';

import { useEffect } from 'react';
import { useSystemSettings } from './useSystemSettings';
import { ConfigProvider } from 'antd';

/**
 * 테마 설정을 실시간으로 적용하는 훅
 */
export function useThemeSettings() {
  const { getDisplaySettings, settings } = useSystemSettings();

  // 테마 색상 적용
  useEffect(() => {
    const displaySettings = getDisplaySettings();
    
    // CSS 변수로 테마 색상 적용
    const root = document.documentElement;
    root.style.setProperty('--ant-primary-color', displaySettings.theme.primary);
    root.style.setProperty('--ant-success-color', displaySettings.theme.success);
    root.style.setProperty('--ant-warning-color', displaySettings.theme.warning);
    root.style.setProperty('--ant-error-color', displaySettings.theme.error);

    // 메타 태그 업데이트 (브라우저 테마 색상)
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', displaySettings.theme.primary);
    } else {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = displaySettings.theme.primary;
      document.head.appendChild(meta);
    }
  }, [settings.display, getDisplaySettings]);

  // Ant Design 테마 객체 생성
  const getAntdTheme = () => {
    const displaySettings = getDisplaySettings();
    
    return {
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
        
        // 간격
        padding: displaySettings.compactMode ? 12 : 16,
        paddingLG: displaySettings.compactMode ? 16 : 24,
        paddingSM: displaySettings.compactMode ? 8 : 12,
        paddingXS: displaySettings.compactMode ? 4 : 8,
      },
      components: {
        Layout: {
          headerBg: '#ffffff',
          siderBg: '#001529',
          bodyBg: '#f5f5f5',
        },
        Menu: {
          darkItemBg: '#001529',
          darkSubMenuItemBg: '#000c17',
          darkItemSelectedBg: displaySettings.theme.primary,
          darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
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
        },
        Table: {
          cellPaddingBlock: displaySettings.compactMode ? 8 : 12,
          cellPaddingInline: displaySettings.compactMode ? 8 : 16,
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