import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { App } from 'antd';
import AppLayout from '../AppLayout';
import type { SettingCategory, SettingKey } from '@/types/systemSettings';

/**
 * `display.sidebar_collapsed` 가 **사이드바의 초기 접힘 상태로 실제로 반영되는지** 본다.
 *
 * 이 설정은 저장은 되지만 읽는 곳이 하나도 없었다 — `AppLayout` 이 `useState(false)` 로
 * 시작했기 때문에, 관리자가 값을 켜고 저장에 성공해도 화면은 아무 반응이 없었다
 * (2026-08-06 설정 적용 감사).
 *
 * 관찰 대상은 **Sidebar 가 실제로 받은 `collapsed`** 다. getter 가 호출됐는지를 보면
 * 배선이 끊겨도 통과한다 — 이 저장소가 반복해서 당한 방식이다.
 */

const mockPathname = jest.fn<string, []>();

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ push: jest.fn() }),
}));

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { role: 'admin', name: '테스트' },
    logout: jest.fn(),
    loading: false,
    error: null,
  }),
}));

jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

// 브레이크포인트를 실제 matchMedia 에 맡기면 jsdom 에서 항상 "모바일"로 굳어, 데스크톱
// 경로(설정이 의미를 갖는 유일한 경로)를 검사할 수 없다.
const mockScreens = jest.fn<Record<string, boolean | undefined>, []>();

jest.mock('antd', () => {
  const actual = jest.requireActual<typeof import('antd')>('antd');
  return {
    ...actual,
    Grid: { ...actual.Grid, useBreakpoint: () => mockScreens() },
  };
});

const mockSettings = jest.fn<{ isLoading: boolean; display: Record<string, unknown> }, []>();

jest.mock('@/contexts/SystemSettingsContext', () => ({
  useSystemSettings: () => {
    const state = mockSettings();
    return {
      settings: { display: state.display },
      isLoading: state.isLoading,
      error: null,
      getSetting: <C extends SettingCategory, K extends SettingKey<C>>(category: C, key: K) =>
        category === 'display' ? (state.display[key as string] ?? null) : null,
    };
  },
}));

/**
 * Sidebar 대역. 받은 `collapsed` 를 그대로 드러내고, 사용자가 사이드바를 접는 경로
 * (모바일 오버레이 클릭)와 같은 콜백을 노출한다.
 */
jest.mock('../Sidebar', () => ({
  __esModule: true,
  default: ({ collapsed, onCollapse }: { collapsed: boolean; onCollapse?: (v: boolean) => void }) => (
    <div data-testid="sidebar" data-collapsed={String(collapsed)}>
      <button type="button" data-testid="sidebar-collapse" onClick={() => onCollapse?.(true)} />
    </div>
  ),
}));
jest.mock('@/components/auth/LoginForm', () => ({ __esModule: true, default: () => null }));
jest.mock('../LanguageToggle', () => ({ __esModule: true, default: () => null }));
jest.mock('../ThemeToggle', () => ({ __esModule: true, default: () => null }));

const DESKTOP = { xs: false, sm: true, md: true, lg: true, xl: true, xxl: false };
const MOBILE = { xs: true, sm: false, md: false, lg: false, xl: false, xxl: false };
/** antd 의 `useBreakpoint` 는 첫 렌더에서 아무것도 확정하지 못한다. */
const UNRESOLVED: Record<string, boolean | undefined> = {};

const collapsedState = () => screen.getByTestId('sidebar').getAttribute('data-collapsed');

const renderLayout = () =>
  render(
    <App>
      <AppLayout>
        <div>PAGE</div>
      </AppLayout>
    </App>
  );

describe('AppLayout 사이드바 초기 접힘 (display.sidebar_collapsed)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPathname.mockReturnValue('/dashboard');
    mockScreens.mockReturnValue(DESKTOP);
    mockSettings.mockReturnValue({ isLoading: false, display: {} });
  });

  it('설정이 켜져 있으면 데스크톱에서도 접힌 채로 시작한다', () => {
    mockSettings.mockReturnValue({ isLoading: false, display: { sidebar_collapsed: true } });
    renderLayout();
    expect(collapsedState()).toBe('true');
  });

  it('설정이 꺼져 있으면 데스크톱에서 펼쳐진 채로 시작한다 (기존 동작)', () => {
    mockSettings.mockReturnValue({ isLoading: false, display: { sidebar_collapsed: false } });
    renderLayout();
    expect(collapsedState()).toBe('false');
  });

  it('설정이 없으면 펼쳐진 채로 시작한다', () => {
    renderLayout();
    expect(collapsedState()).toBe('false');
  });

  it('설정이 늦게 도착해도 반영된다', () => {
    // 설정은 비동기다. 로딩 중에 확정해 버리면 기본값으로 굳는다.
    mockSettings.mockReturnValue({ isLoading: true, display: {} });
    const { rerender } = renderLayout();
    expect(collapsedState()).toBe('false');

    mockSettings.mockReturnValue({ isLoading: false, display: { sidebar_collapsed: true } });
    rerender(
      <App>
        <AppLayout>
          <div>PAGE</div>
        </AppLayout>
      </App>
    );
    expect(collapsedState()).toBe('true');
  });

  it('설정을 기다리는 동안 사용자가 접었으면 설정이 그 선택을 덮지 않는다', () => {
    mockSettings.mockReturnValue({ isLoading: true, display: {} });
    const { rerender } = renderLayout();

    fireEvent.click(screen.getByTestId('sidebar-collapse'));
    expect(collapsedState()).toBe('true');

    // 뒤늦게 "펼침"으로 저장된 설정이 도착한다. 사용자의 선택이 이긴다.
    mockSettings.mockReturnValue({ isLoading: false, display: { sidebar_collapsed: false } });
    rerender(
      <App>
        <AppLayout>
          <div>PAGE</div>
        </AppLayout>
      </App>
    );
    expect(collapsedState()).toBe('true');
  });

  it('한 번 반영된 뒤에는 사용자의 접기/펴기를 설정이 되돌리지 않는다', () => {
    mockSettings.mockReturnValue({ isLoading: false, display: { sidebar_collapsed: true } });
    renderLayout();
    expect(collapsedState()).toBe('true');

    // 설정이 켜져 있으면 데스크톱에도 토글이 남는다 — 없으면 펼 방법이 사라진다.
    fireEvent.click(document.querySelector('button.ant-btn')!);
    expect(collapsedState()).toBe('false');
  });

  it('모바일에서는 설정이 사이드바를 펼치지 못한다', () => {
    // 좁은 화면에서 펼친 사이드바는 콘텐츠를 통째로 덮는다. 폭 규칙이 설정보다 우선한다.
    mockScreens.mockReturnValue(MOBILE);
    mockSettings.mockReturnValue({ isLoading: false, display: { sidebar_collapsed: false } });
    renderLayout();
    expect(collapsedState()).toBe('true');
  });

  it('운영자 콘솔에서는 설정과 무관하게 접힌 채로 시작한다', () => {
    mockPathname.mockReturnValue('/operator-view');
    mockSettings.mockReturnValue({ isLoading: false, display: { sidebar_collapsed: false } });
    renderLayout();
    expect(collapsedState()).toBe('true');
  });

  it('브레이크포인트가 확정되기 전에는 설정을 반영하지 않는다', () => {
    // 확정 전에 반영하면 폭 규칙이 뒤이어 값을 덮어써서 화면이 한 번 깜빡인다.
    mockScreens.mockReturnValue(UNRESOLVED);
    mockSettings.mockReturnValue({ isLoading: false, display: { sidebar_collapsed: true } });
    const { rerender } = renderLayout();
    expect(collapsedState()).toBe('false');

    act(() => {
      mockScreens.mockReturnValue(DESKTOP);
    });
    rerender(
      <App>
        <AppLayout>
          <div>PAGE</div>
        </AppLayout>
      </App>
    );
    expect(collapsedState()).toBe('true');
  });
});
