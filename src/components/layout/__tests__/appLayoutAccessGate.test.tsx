import React from 'react';
import { render, screen } from '@testing-library/react';
import { App } from 'antd';
import AppLayout from '../AppLayout';
import type { UserRole } from '@/lib/pageAccess';

/**
 * `AppLayout` 이 페이지 접근 규칙을 **실제로 적용하는지** 본다.
 *
 * 왜 렌더링해서 보나 — 처음에는 소스에 'canAccessPath' 문자열이 있는지만 확인했다.
 * 그런데 검사를 시험해 보니(`!canAccessPath(...)` → `false` 로 바꿔 봄) **통과했다**.
 * import 줄에 그 이름이 남아 있었기 때문이다. 문자열 존재는 그 규칙이 동작한다는 증거가
 * 아니다. 페이지의 역할 가드를 전부 걷어냈으므로 이 배선이 끊기면 **모든 페이지가 열린다**
 * — 가장 비싼 실패이므로 가장 확실한 방법으로 검사한다.
 */

const mockPathname = jest.fn<string, []>();
const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  usePathname: () => mockPathname(),
  useRouter: () => ({ push: mockPush }),
}));

const mockUser = jest.fn<{ role: UserRole; name: string } | null, []>();
const mockAuthError = jest.fn<string | null, []>();

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    user: mockUser(),
    logout: jest.fn(),
    loading: false,
    error: mockAuthError(),
  }),
}));

jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

// AppLayout 은 `display.sidebar_collapsed` 를 읽는다. 이 검사의 대상은 아니지만, 대역이
// 없으면 SystemSettingsContext → supabase 로 이어져 `.env.local` 없이는 import 자체가
// 실패한다. 접힘 상태 검사는 `appLayoutSidebarCollapsed.test.tsx` 가 따로 본다.
jest.mock('@/contexts/SystemSettingsContext', () => ({
  useSystemSettings: () => ({
    settings: {},
    isLoading: false,
    error: null,
    getSetting: () => null,
  }),
}));

// 사이드바와 로그인 폼은 이 검사의 대상이 아니다. 각자 컨텍스트를 많이 요구하므로
// 표식만 남기고 대체한다 — 관문이 열렸는지 닫혔는지만 보면 된다.
jest.mock('../Sidebar', () => ({
  __esModule: true,
  default: () => <div data-testid="sidebar" />,
}));
jest.mock('@/components/auth/LoginForm', () => ({
  __esModule: true,
  default: () => <div data-testid="login-form" />,
}));
jest.mock('../LanguageToggle', () => ({ __esModule: true, default: () => null }));
jest.mock('../ThemeToggle', () => ({ __esModule: true, default: () => null }));
// FactorySwitcher 는 authFetch -> supabase 클라이언트를 끌어와 env 검증에 걸린다.
// 이 테스트들이 보는 것은 레이아웃 게이트이지 공장 표시가 아니다.
jest.mock('../FactorySwitcher', () => ({ __esModule: true, default: () => null }));

const PAGE = 'PAGE_CONTENT';

const renderAt = (pathname: string, role: UserRole | null, authError: string | null = null) => {
  mockPathname.mockReturnValue(pathname);
  mockUser.mockReturnValue(role ? { role, name: '테스트' } : null);
  mockAuthError.mockReturnValue(authError);
  return render(
    <App>
      <AppLayout>
        <div>{PAGE}</div>
      </AppLayout>
    </App>
  );
};

describe('AppLayout 접근 관문', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('사용자(operator)', () => {
    it.each(['/dashboard', '/machines', '/production-records', '/operator-view'])(
      '%s 는 열린다',
      (path) => {
        renderAt(path, 'operator');
        expect(screen.getByText(PAGE)).toBeInTheDocument();
        expect(screen.queryByText('403')).not.toBeInTheDocument();
      }
    );

    it.each(['/settings', '/data-input', '/model-info', '/reports', '/analytics', '/admin'])(
      '%s 는 403 이고 페이지 내용이 렌더링되지 않는다',
      (path) => {
        renderAt(path, 'operator');
        expect(screen.queryByText(PAGE)).not.toBeInTheDocument();
        expect(screen.getByText('403')).toBeInTheDocument();
        // 사이드바는 남는다 — 화면 전체를 갈아치우면 갈 곳을 잃는다.
        expect(screen.getByTestId('sidebar')).toBeInTheDocument();
      }
    );
  });

  describe('관리자(engineer)', () => {
    it('설정만 막힌다', () => {
      renderAt('/settings', 'engineer');
      expect(screen.queryByText(PAGE)).not.toBeInTheDocument();
      expect(screen.getByText('403')).toBeInTheDocument();
    });

    it.each(['/dashboard', '/data-input', '/model-info', '/reports', '/analytics', '/admin', '/operator-view'])(
      '%s 는 열린다',
      (path) => {
        renderAt(path, 'engineer');
        expect(screen.getByText(PAGE)).toBeInTheDocument();
      }
    );
  });

  describe('시스템 관리자(admin)', () => {
    it.each(['/settings', '/admin', '/operator-view', '/machines/bulk-upload'])(
      '%s 는 열린다',
      (path) => {
        renderAt(path, 'admin');
        expect(screen.getByText(PAGE)).toBeInTheDocument();
      }
    );
  });

  describe('등록되지 않은 경로', () => {
    it('아무 역할에도 열리지 않는다 (fail-closed)', () => {
      renderAt('/unregistered-page', 'admin');
      expect(screen.queryByText(PAGE)).not.toBeInTheDocument();
      expect(screen.getByText('403')).toBeInTheDocument();
    });
  });

  describe('로그인하지 않은 상태', () => {
    it('보호된 경로에서는 로그인 폼이 뜨고 페이지가 렌더링되지 않는다', () => {
      // 예전에는 children 을 그대로 렌더링해 페이지마다 처리가 갈렸다.
      // RoleGuard 만 쓰던 /admin·/analytics 등은 빈 화면이 나왔다.
      renderAt('/admin', null);
      expect(screen.queryByText(PAGE)).not.toBeInTheDocument();
      expect(screen.getByTestId('login-form')).toBeInTheDocument();
    });

    it('로그인 페이지는 그대로 통과시킨다', () => {
      renderAt('/login', null);
      expect(screen.getByText(PAGE)).toBeInTheDocument();
      expect(screen.queryByTestId('login-form')).not.toBeInTheDocument();
    });

    it('공개 경로(/)는 그대로 통과시킨다', () => {
      renderAt('/', null);
      expect(screen.getByText(PAGE)).toBeInTheDocument();
    });
  });

  /**
   * 세션이 만료되면 화면이 갑자기 로그인 폼으로 바뀐다. 이유를 말해 주지 않으면 사용자는
   * 무슨 일이 났는지 알 수 없다.
   *
   * 실제로 운영에서 09:03~09:07 사이 모든 요청이 401 이었는데, 화면은 "비가동 내역을
   * 불러오지 못했습니다" 를 띄웠다 — 각 패널이 401 을 자기 도메인 언어로 옮겨 적었기
   * 때문이다. 사용자는 데이터가 깨진 줄 알고 새로고침만 반복하게 된다.
   */
  describe('세션 만료 안내', () => {
    it('만료 메시지가 로그인 화면에 함께 뜬다', () => {
      renderAt('/dashboard', null, '세션이 만료되었습니다. 다시 로그인해 주세요.');
      expect(screen.getByTestId('login-form')).toBeInTheDocument();
      expect(screen.getByText('세션이 만료되었습니다. 다시 로그인해 주세요.')).toBeInTheDocument();
      // 도메인 화면은 애초에 그려지지 않는다 — 오류 카드가 나올 자리가 없다.
      expect(screen.queryByText(PAGE)).not.toBeInTheDocument();
    });

    it('보여줄 오류가 없으면 안내 없이 로그인 폼만 뜬다', () => {
      renderAt('/dashboard', null, null);
      expect(screen.getByTestId('login-form')).toBeInTheDocument();
      expect(document.querySelector('.ant-alert')).toBeNull();
    });
  });
});
