'use client';

import { useEffect, useMemo } from 'react';
import { useSystemSettings } from './useSystemSettings';
import { theme } from 'antd';

/**
 * 테마 설정을 실시간으로 적용하는 훅
 */
export function useThemeSettings() {
  const { settings } = useSystemSettings();

  // 원시값으로 분해하여 안정적인 메모이제이션 키로 사용
  // (settings.display 객체나 getDisplaySettings 함수의 참조가 매 렌더마다
  //  바뀌더라도, 실제 값이 그대로면 아래 훅들이 재실행되지 않도록 함)
  const mode = settings.display?.theme_mode ?? 'light';
  const primaryColor = settings.display?.theme_primary_color ?? '#1890ff';
  const successColor = settings.display?.theme_success_color ?? '#52c41a';
  const warningColor = settings.display?.theme_warning_color ?? '#faad14';
  const errorColor = settings.display?.theme_error_color ?? '#ff4d4f';
  const compactMode = settings.display?.compact_mode ?? false;

  // 테마 색상 및 모드 적용
  useEffect(() => {
    // 브라우저 환경에서만 실행
    if (typeof window === 'undefined') return;

    const isDark = mode === 'dark';

    // CSS 변수로 테마 색상 적용
    const root = document.documentElement;
    root.style.setProperty('--ant-primary-color', primaryColor);
    root.style.setProperty('--ant-success-color', successColor);
    root.style.setProperty('--ant-warning-color', warningColor);
    root.style.setProperty('--ant-error-color', errorColor);

    // 테마 모드 적용 (body와 documentElement 모두)
    document.body.setAttribute('data-theme', mode);
    document.documentElement.setAttribute('data-theme', mode);

    // HTML 클래스 적용 (다른 라이브러리 호환성)
    if (isDark) {
      document.documentElement.classList.add('dark');
      document.documentElement.classList.remove('light');
      document.body.classList.add('dark');
      document.body.classList.remove('light');
    } else {
      document.documentElement.classList.add('light');
      document.documentElement.classList.remove('dark');
      document.body.classList.add('light');
      document.body.classList.remove('dark');
    }

    // 메타 태그 업데이트 (브라우저 테마 색상)
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    const themeColor = isDark ? '#141414' : primaryColor;

    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', themeColor);
    } else {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.content = themeColor;
      document.head.appendChild(meta);
    }

    // 로컬스토리지 동기화 (빠른 초기 로딩을 위해)
    try {
      localStorage.setItem('theme-mode', mode);
      localStorage.setItem('theme-colors', JSON.stringify({
        primary: primaryColor,
        success: successColor,
        warning: warningColor,
        error: errorColor
      }));
    } catch (error) {
      console.warn('Failed to save theme to localStorage:', error);
    }

    // 전역 이벤트 발생 (다른 컴포넌트에서 구독 가능)
    window.dispatchEvent(new CustomEvent('theme-changed', {
      detail: {
        mode,
        theme: {
          primary: primaryColor,
          success: successColor,
          warning: warningColor,
          error: errorColor
        },
        isDark
      }
    }));

  }, [mode, primaryColor, successColor, warningColor, errorColor]);

  // Ant Design 테마 객체 생성 (원시값이 실제로 바뀔 때만 새 객체 생성)
  const antdTheme = useMemo(() => {
    const isDark = mode === 'dark';

    return {
      algorithm: isDark ? theme.darkAlgorithm : theme.defaultAlgorithm,
      token: {
        colorPrimary: primaryColor,
        colorSuccess: successColor,
        colorWarning: warningColor,
        colorError: errorColor,
        colorInfo: primaryColor,

        // 레이아웃
        borderRadius: 6,
        borderRadiusLG: 8,
        borderRadiusSM: 4,

        // 폰트
        fontSize: compactMode ? 12 : 14,
        fontSizeLG: compactMode ? 14 : 16,
        fontSizeSM: compactMode ? 10 : 12,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif',

        // 간격
        padding: compactMode ? 12 : 16,
        paddingLG: compactMode ? 16 : 24,
        paddingSM: compactMode ? 8 : 12,
        paddingXS: compactMode ? 4 : 8,

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
          siderBg: '#001529', // 사이드바는 항상 다크
          bodyBg: isDark ? '#000000' : '#f5f5f5',
          headerHeight: 64,
          headerPadding: '0 24px',
        },
        Menu: {
          darkItemBg: '#001529',
          darkSubMenuItemBg: '#000c17',
          darkItemSelectedBg: primaryColor,
          darkItemHoverBg: 'rgba(255, 255, 255, 0.06)',
          darkItemColor: 'rgba(255, 255, 255, 0.88)',
          darkItemSelectedColor: '#ffffff',
          darkGroupTitleColor: 'rgba(255, 255, 255, 0.67)',
        },
        Button: {
          borderRadius: 6,
          controlHeight: compactMode ? 28 : 32,
          controlHeightLG: compactMode ? 36 : 40,
          controlHeightSM: compactMode ? 20 : 24,
        },
        Card: {
          borderRadius: 8,
          paddingLG: compactMode ? 16 : 24,
          headerBg: isDark ? '#141414' : '#fafafa',
          colorBgContainer: isDark ? '#141414' : '#ffffff',
        },
        Table: {
          cellPaddingBlock: compactMode ? 8 : 12,
          cellPaddingInline: compactMode ? 8 : 16,
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
          itemSelectedColor: primaryColor,
          itemHoverColor: primaryColor,
        }
      },
    };
  }, [mode, primaryColor, successColor, warningColor, errorColor, compactMode]);

  return {
    antdTheme,
    applyTheme: () => {
      const root = document.documentElement;
      root.style.setProperty('--ant-primary-color', primaryColor);
      root.style.setProperty('--ant-success-color', successColor);
      root.style.setProperty('--ant-warning-color', warningColor);
      root.style.setProperty('--ant-error-color', errorColor);
    }
  };
}
