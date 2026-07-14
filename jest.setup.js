import '@testing-library/jest-dom'

// jsdom 에는 matchMedia 가 없다. Ant Design 의 반응형 컴포넌트가 마운트 시 이를 호출하므로
// 폴리필이 없으면 antd 를 쓰는 모든 컴포넌트 테스트가 렌더 단계에서 죽는다.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},      // deprecated
    removeListener: () => {},   // deprecated
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
})

// antd 의 일부 컴포넌트(Table 가상 스크롤 등)가 사용한다.
if (typeof window.ResizeObserver === 'undefined') {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
