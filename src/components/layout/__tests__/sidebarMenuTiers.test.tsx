import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import Sidebar from '../Sidebar';
import { getNavEntries, type UserRole } from '@/lib/pageAccess';

/**
 * 사이드바 규칙 (2026-07-31 사용자 확정)
 *
 *   1. **모든 역할이 같은 메뉴 목록을 본다.** 역할마다 메뉴가 달라지면 "내 화면에는 그
 *      메뉴가 없다"는 문의가 생기고, 무엇이 존재하는지조차 알 수 없다.
 *   2. 권한 없는 항목은 사라지는 대신 **비활성 + 자물쇠**로 남는다.
 *
 * 두 번째가 실제로 동작하는지는 렌더링해서 봐야 한다. `disabled: !allowed` 를
 * `disabled: false` 로 바꿔도 표(pageAccess) 검사는 전부 통과했다 — 표가 옳은 것과
 * 화면이 표를 따르는 것은 다른 명제다.
 */

const mockPush = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
  usePathname: () => '/dashboard',
}));

const mockRole = jest.fn<UserRole, []>();

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: mockRole(), name: '테스트' } }),
}));

jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({
    // 라벨 키를 그대로 돌려주면 화면에서 항목을 키로 찾을 수 있다.
    t: (key: string) => key,
  }),
}));

jest.mock('@/hooks/useSystemSettings', () => ({
  useSystemSettings: () => ({
    getCompanyInfo: () => ({ name: 'TEST CO' }),
    isLoading: false,
  }),
}));

jest.mock('next/image', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

const NAV = getNavEntries();

const renderAs = (role: UserRole) => {
  mockRole.mockReturnValue(role);
  return render(<Sidebar collapsed={false} />);
};

/** 메뉴 항목의 DOM 요소. antd 는 `li[role="menuitem"]` 로 그린다. */
const menuItems = () => Array.from(document.querySelectorAll('li.ant-menu-item'));

const itemFor = (labelKey: string) =>
  menuItems().find((el) => el.textContent?.includes(labelKey));

const isLocked = (labelKey: string) => {
  const el = itemFor(labelKey);
  if (!el) throw new Error(`메뉴에 ${labelKey} 가 없다`);
  return el.classList.contains('ant-menu-item-disabled');
};

describe('사이드바 메뉴 등급', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each<UserRole>(['admin', 'engineer', 'operator'])(
    '%s 도 같은 메뉴 목록을 본다',
    (role) => {
      renderAs(role);
      expect(menuItems()).toHaveLength(NAV.length);
      for (const entry of NAV) {
        expect(screen.getByText(entry.labelKey!)).toBeInTheDocument();
      }
    }
  );

  it('사용자(operator)에게는 담당 네 항목만 열려 있다', () => {
    renderAs('operator');
    const open = NAV.filter((e) => !isLocked(e.labelKey!)).map((e) => e.path);
    expect(open.sort()).toEqual(
      ['/dashboard', '/machines', '/operator-view', '/production-records'].sort()
    );
  });

  it('관리자(engineer)에게는 설정만 잠겨 있다', () => {
    renderAs('engineer');
    const locked = NAV.filter((e) => isLocked(e.labelKey!)).map((e) => e.path);
    expect(locked).toEqual(['/settings']);
  });

  it('시스템 관리자(admin)에게는 아무것도 잠겨 있지 않다', () => {
    renderAs('admin');
    expect(NAV.filter((e) => isLocked(e.labelKey!))).toEqual([]);
  });

  it('잠긴 항목을 눌러도 이동하지 않는다', () => {
    renderAs('operator');
    fireEvent.click(itemFor('nav.settings')!);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('열린 항목은 정상적으로 이동한다', () => {
    renderAs('operator');
    fireEvent.click(itemFor('nav.operatorView')!);
    expect(mockPush).toHaveBeenCalledWith('/operator-view');
  });

  it('잠긴 항목에는 필요한 등급이 안내로 붙는다', () => {
    renderAs('operator');
    // t 가 키를 그대로 돌려주므로 안내 문구 키가 title 에 들어간다.
    expect(itemFor('nav.settings')?.getAttribute('title')).toContain('nav.restrictedTo');
  });
});
