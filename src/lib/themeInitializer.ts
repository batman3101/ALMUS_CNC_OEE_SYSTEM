/**
 * 페이지 로드 시 테마 깜박임 방지를 위한 초기화 스크립트
 * 이 파일은 가능한 한 빨리 실행되어야 하므로 동기적으로 처리됩니다.
 */

interface ThemeColors {
  primary: string;
  success: string;
  warning: string;
  error: string;
}

interface SavedTheme {
  mode: 'light' | 'dark';
  colors: ThemeColors;
}

const DEFAULT_THEME: SavedTheme = {
  mode: 'light',
  colors: {
    primary: '#1890ff',
    success: '#52c41a',
    warning: '#faad14',
    error: '#ff4d4f'
  }
};

/**
 * 로컬스토리지에서 테마 설정을 가져옵니다.
 */
function getSavedTheme(): SavedTheme {
  if (typeof window === 'undefined') return DEFAULT_THEME;

  try {
    const savedMode = localStorage.getItem('theme-mode') as 'light' | 'dark' | null;
    const savedColors = localStorage.getItem('theme-colors');
    
    let colors = DEFAULT_THEME.colors;
    if (savedColors) {
      try {
        colors = JSON.parse(savedColors);
      } catch {
        console.warn('Failed to parse saved theme colors, using defaults');
      }
    }

    return {
      mode: savedMode || DEFAULT_THEME.mode,
      colors
    };
  } catch (error) {
    console.warn('Failed to load theme from localStorage:', error);
    return DEFAULT_THEME;
  }
}

/**
 * 시스템 테마 선호도를 확인합니다.
 */
function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/**
 * CSS 변수와 클래스를 즉시 적용합니다.
 */
function applyThemeImmediate(theme: SavedTheme): void {
  if (typeof document === 'undefined') return;

  const { mode, colors } = theme;
  const isDark = mode === 'dark';

  // CSS 변수 설정
  const root = document.documentElement;
  root.style.setProperty('--ant-primary-color', colors.primary);
  root.style.setProperty('--ant-success-color', colors.success);
  root.style.setProperty('--ant-warning-color', colors.warning);
  root.style.setProperty('--ant-error-color', colors.error);

  // 테마별 추가 CSS 변수
  root.style.setProperty('--theme-bg-primary', isDark ? '#000000' : '#ffffff');
  root.style.setProperty('--theme-bg-secondary', isDark ? '#141414' : '#f5f5f5');
  root.style.setProperty('--theme-bg-elevated', isDark ? '#1f1f1f' : '#ffffff');
  root.style.setProperty('--theme-text-primary', isDark ? 'rgba(255, 255, 255, 0.88)' : 'rgba(0, 0, 0, 0.88)');
  root.style.setProperty('--theme-text-secondary', isDark ? 'rgba(255, 255, 255, 0.65)' : 'rgba(0, 0, 0, 0.65)');
  root.style.setProperty('--theme-border', isDark ? '#424242' : '#d9d9d9');

  // HTML 클래스 설정
  const htmlElement = document.documentElement;
  const bodyElement = document.body;

  // 기존 테마 클래스 제거
  htmlElement.classList.remove('light', 'dark');
  bodyElement?.classList.remove('light', 'dark');

  // 새 테마 클래스 추가
  htmlElement.classList.add(mode);
  bodyElement?.classList.add(mode);

  // data 속성 설정
  htmlElement.setAttribute('data-theme', mode);
  bodyElement?.setAttribute('data-theme', mode);

  // meta 태그 업데이트 (브라우저 테마 색상)
  const themeColor = isDark ? '#141414' : colors.primary;
  let metaThemeColor = document.querySelector('meta[name="theme-color"]');
  
  if (!metaThemeColor) {
    metaThemeColor = document.createElement('meta');
    metaThemeColor.setAttribute('name', 'theme-color');
    document.head.appendChild(metaThemeColor);
  }
  metaThemeColor.setAttribute('content', themeColor);
}

/**
 * 테마 초기화를 수행합니다.
 * 이 함수는 페이지 로드 시 가장 먼저 실행되어야 합니다.
 */
export function initializeTheme(useSystemTheme: boolean = false): void {
  if (typeof window === 'undefined') return;

  const savedTheme = getSavedTheme();
  
  // 시스템 테마 사용 옵션이 활성화된 경우
  if (useSystemTheme) {
    const systemTheme = getSystemTheme();
    savedTheme.mode = systemTheme;
  }

  // 즉시 테마 적용
  applyThemeImmediate(savedTheme);

  // 로컬스토리지 업데이트
  try {
    localStorage.setItem('theme-mode', savedTheme.mode);
    localStorage.setItem('theme-colors', JSON.stringify(savedTheme.colors));
  } catch (error) {
    console.warn('Failed to save initial theme to localStorage:', error);
  }
}

/**
 * 시스템 테마 변경 감지 리스너를 설정합니다.
 */
export function setupSystemThemeListener(callback?: (isDark: boolean) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  
  const handleChange = (e: MediaQueryListEvent) => {
    console.log('System theme changed:', e.matches ? 'dark' : 'light');
    callback?.(e.matches);
  };

  mediaQuery.addEventListener('change', handleChange);
  
  // cleanup 함수 반환
  return () => {
    mediaQuery.removeEventListener('change', handleChange);
  };
}

/**
 * 테마가 다크 모드인지 확인합니다.
 */
export function isDarkTheme(): boolean {
  if (typeof document === 'undefined') return false;
  
  return document.documentElement.classList.contains('dark') || 
         document.documentElement.getAttribute('data-theme') === 'dark';
}

/**
 * 현재 적용된 테마 정보를 가져옵니다.
 */
export function getCurrentTheme(): SavedTheme {
  const savedTheme = getSavedTheme();
  const actualMode = isDarkTheme() ? 'dark' : 'light';
  
  return {
    ...savedTheme,
    mode: actualMode
  };
}