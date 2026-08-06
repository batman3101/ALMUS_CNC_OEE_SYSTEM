import React from 'react';
import { render } from '@testing-library/react';
import Sidebar from '../Sidebar';

/**
 * `general.company_logo_url` 이 **사이드바 로고에 실제로 쓰이는지** 본다.
 *
 * 관리자 화면에는 로고 업로드 UI 가 있고 저장도 성공했지만, 사이드바는
 * `/ALMUS symbol.png` 를 하드코딩하고 있어 어떤 값을 올려도 화면이 바뀌지 않았다
 * (2026-08-06 설정 적용 감사).
 *
 * ■ `next/image` 를 일부러 대역으로 바꾸지 않는다
 *   업로드된 로고는 Supabase Storage 의 **원격 URL** 이고, `next/image` 의 기본 로더는
 *   `next.config.js` 에 등록되지 않은 호스트를 예외로 막는다. `unoptimized` 를 빼면 이
 *   검사가 렌더 예외로 깨진다 — 즉 "설정 URL 을 쓴다"만이 아니라 "쓸 수 있는 방식으로
 *   쓴다"까지 이 검사가 지킨다. 대역으로 바꾸면 그 성질이 통째로 사라진다.
 */

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn() }),
  usePathname: () => '/dashboard',
}));

jest.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { role: 'admin', name: '테스트' } }),
}));

jest.mock('@/contexts/LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key }),
}));

// `string` 만 받지 않는다 — 아래 "값이 아예 없을 때" 조항이 이 훅의 타입을 믿지 않는 것이
// 이 검사의 요점이다.
const mockLogo = jest.fn<string | null | undefined, []>();

jest.mock('@/hooks/useSystemSettings', () => ({
  useSystemSettings: () => ({
    getCompanyInfo: () => ({ name: 'TEST CO', logo: mockLogo() }),
    isLoading: false,
  }),
}));

const logoImg = (container: HTMLElement) => {
  const img = container.querySelector('img[alt="ALMUS Logo"]');
  if (!img) throw new Error('사이드바에 로고 이미지가 없다');
  return img as HTMLImageElement;
};

const renderWithLogo = (logo: string | null | undefined) => {
  mockLogo.mockReturnValue(logo);
  return render(<Sidebar collapsed={false} />);
};

describe('사이드바 회사 로고 (general.company_logo_url)', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(['', '   '])(
    '설정이 비어 있으면(%p) 기존 기본 심볼을 그대로 쓴다',
    (empty) => {
      // 현재 운영값이 빈 문자열이다. 이 경로에서 화면이 조금이라도 달라지면 회귀다.
      const { container } = renderWithLogo(empty);
      expect(decodeURIComponent(logoImg(container).getAttribute('src') ?? ''))
        .toContain('/ALMUS symbol.png');
    }
  );

  /**
   * 회사 로고는 **장식**이다. 장식 하나가 내비게이션 전체를 무너뜨릴 수 있으면 안 된다.
   *
   * 실제로 그렇게 됐다 — `logo` 키를 주지 않는 호출자 하나에서 `resolveLogo` 가
   * `undefined.trim()` 을 부르며 사이드바가 통째로 TypeError 로 죽었고, 메뉴·이동·권한
   * 표시가 전부 사라졌다. 타입상으로는 항상 문자열이지만, 타입은 이 자리에서 지켜야 할
   * 성질이 아니다.
   */
  it.each([undefined, null])('값이 아예 없어도(%p) 사이드바가 죽지 않고 기본 심볼로 물러난다', (missing) => {
    const { container } = renderWithLogo(missing);
    expect(decodeURIComponent(logoImg(container).getAttribute('src') ?? ''))
      .toContain('/ALMUS symbol.png');
    // 메뉴가 남아 있어야 한다 — 로고가 터지면 이 목록이 통째로 사라졌다.
    expect(container.querySelectorAll('li.ant-menu-item').length).toBeGreaterThan(0);
  });

  it('설정에 업로드된 Supabase Storage URL 이 있으면 그 URL 을 쓴다', () => {
    // `/api/upload/image` 가 저장하는 실제 모양(공개 URL)이다.
    const uploaded =
      'https://wmtkkefsorrdlzprhlpr.supabase.co/storage/v1/object/public/company-assets/1754400000000-abcd1234-logo.png';
    const { container } = renderWithLogo(uploaded);

    // 원격 URL 은 최적화를 거치지 않고 그대로 나가야 한다. 최적화 경로로 보내면
    // next.config.js 의 remotePatterns 에 없는 호스트라 렌더가 막힌다.
    expect(logoImg(container).getAttribute('src')).toBe(uploaded);
  });

  it('설정에 로컬 경로가 들어 있으면 그 경로를 쓴다', () => {
    const { container } = renderWithLogo('/custom-logo.png');
    expect(decodeURIComponent(logoImg(container).getAttribute('src') ?? ''))
      .toContain('/custom-logo.png');
  });

  it('설정된 로고는 기본 심볼을 대체한다', () => {
    // "설정 URL 을 쓴다"와 "기본값도 같이 남아 있다"는 다른 명제다.
    const { container } = renderWithLogo('https://cdn.example.com/logo.png');
    expect(logoImg(container).getAttribute('src')).not.toContain('ALMUS');
  });
});
