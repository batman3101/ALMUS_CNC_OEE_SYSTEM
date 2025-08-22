// 개발 환경에서 특정 경고 메시지를 억제합니다
if (typeof window !== 'undefined') {
  const originalError = console.error;
  const originalWarn = console.warn;
  const originalLog = console.log;

  // console.error 오버라이드
  console.error = (...args) => {
    // 첫 번째 인자를 문자열로 변환
    const message = args.map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg && typeof arg === 'object' && arg.message) return arg.message;
      return String(arg);
    }).join(' ');
    
    // Ant Design React 19 호환성 경고 억제
    if (
      message.includes('antd v5 support React is 16 ~ 18') ||
      message.includes('see https://u.ant.design/v5-for-19') ||
      message.includes('Static function can not consume context') ||
      message.includes('[antd: compatible]') ||
      message.includes('Warning: [antd:')
    ) {
      return;
    }
    originalError.apply(console, args);
  };

  // console.warn 오버라이드
  console.warn = (...args) => {
    const message = args.map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg && typeof arg === 'object' && arg.message) return arg.message;
      return String(arg);
    }).join(' ');
    
    // 특정 경고 메시지 억제
    if (
      message.includes('antd v5 support React is 16 ~ 18') ||
      message.includes('Static function can not consume context') ||
      message.includes('[antd: compatible]') ||
      message.includes('see https://u.ant.design/v5-for-19') ||
      message.includes('Warning: [antd:')
    ) {
      return;
    }
    originalWarn.apply(console, args);
  };
  
  // console.log 오버라이드 (일부 경고가 log로 출력될 수 있음)
  console.log = (...args) => {
    const message = args.map(arg => {
      if (typeof arg === 'string') return arg;
      if (arg && typeof arg === 'object' && arg.message) return arg.message;
      return String(arg);
    }).join(' ');
    
    if (
      message.includes('antd v5 support React is 16 ~ 18') ||
      message.includes('[antd: compatible]')
    ) {
      return;
    }
    originalLog.apply(console, args);
  };

  // 전역 React 객체 버전 패치 (Ant Design 호환성용)
  if (typeof (window as any).React !== 'undefined') {
    try {
      const ReactObj = (window as any).React;
      if (ReactObj.version && ReactObj.version.startsWith('19')) {
        Object.defineProperty(ReactObj, 'version', {
          get() { return '18.3.1'; },
          configurable: true
        });
      }
    } catch (e) {
      // 에러 무시
    }
  }
}