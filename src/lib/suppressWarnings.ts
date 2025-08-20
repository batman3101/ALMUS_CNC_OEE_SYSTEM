// 개발 환경에서 특정 경고 메시지를 억제합니다
if (typeof window !== 'undefined') {
  const originalError = console.error;
  const originalWarn = console.warn;

  console.error = (...args) => {
    const message = typeof args[0] === 'string' ? args[0] : String(args[0]);
    
    // Ant Design React 19 호환성 경고 억제
    if (
      message.includes('antd v5 support React is 16 ~ 18') ||
      message.includes('see https://u.ant.design/v5-for-19') ||
      message.includes('Static function can not consume context') ||
      message.includes('[antd: compatible]')
    ) {
      return;
    }
    originalError.apply(console, args);
  };

  console.warn = (...args) => {
    const message = typeof args[0] === 'string' ? args[0] : String(args[0]);
    
    // 특정 경고 메시지 억제
    if (
      message.includes('antd v5 support React is 16 ~ 18') ||
      message.includes('Static function can not consume context') ||
      message.includes('[antd: compatible]') ||
      message.includes('see https://u.ant.design/v5-for-19')
    ) {
      return;
    }
    originalWarn.apply(console, args);
  };

  // 런타임 시점에서도 경고 억제
  const suppressAntdWarnings = () => {
    if (window && (window as any).antd) {
      const antd = (window as any).antd;
      if (antd.version && antd.version.startsWith('5')) {
        // Ant Design v5 React 호환성 체크 비활성화
        Object.defineProperty(React, 'version', {
          value: '18.3.1',
          writable: false,
          configurable: false
        });
      }
    }
  };

  // DOM 로드 후 실행
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', suppressAntdWarnings);
  } else {
    suppressAntdWarnings();
  }
}