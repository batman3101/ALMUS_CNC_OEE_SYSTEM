import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { canAccessPath, findPageAccess } from '@/lib/pageAccess';

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8');

/**
 * 총괄 관리자는 자기 시스템의 모든 화면을 열어볼 수 있어야 한다. 볼 수 없는 화면은
 * 유지보수할 수 없다.
 *
 * `DashboardRouter` 는 `user.role` 로만 화면을 고른다. 그래서 각 역할의 대시보드에는
 * 우회 URL 이 있어야 한다 — 엔지니어 화면은 `/analytics`, 운영자 화면은 `/operator-view`.
 *
 * 2026-07-31 개정: 예전 이 파일은 페이지 소스에서 `allowedRoles={[...]}` 를 정규식으로
 * 읽어 검사했다. 그때는 규칙이 페이지에 흩어져 있었기 때문이다. 이제 규칙은
 * `@/lib/pageAccess` 표 한 곳에 있으므로 **표에 직접 묻는다** — 소스 문자열을 긁는
 * 검사는 규칙이 옮겨가면 조용히 무의미해진다.
 *
 * 같은 개정에서 `/operator-view` 는 관리자 전용에서 **전원 접근**으로 바뀌었다.
 * 운영자 본인이 자기 콘솔에 URL 로도 못 가던 것이 원래 결함이었다.
 */
describe('모든 역할의 대시보드에 도달할 수 있다', () => {
  const DASHBOARDS = [
    { name: 'EngineerDashboard', page: 'src/app/analytics/page.tsx', route: '/analytics' },
    { name: 'OperatorDashboard', page: 'src/app/operator-view/page.tsx', route: '/operator-view' },
  ];

  it.each(DASHBOARDS)('$name 을 여는 경로가 존재한다', ({ name, page, route }) => {
    expect(existsSync(resolve(process.cwd(), page))).toBe(true);
    expect(read(page)).toContain(name);

    // 경로가 파일로 존재하는 것과 권한 표에 등록된 것은 다르다. 등록되지 않은 경로는
    // fail-closed 라 아무도 못 연다.
    expect(findPageAccess(route)).not.toBeNull();
    expect(canAccessPath('admin', route)).toBe(true);
  });

  it('사이드바가 그 경로들을 메뉴로 노출한다', () => {
    // 메뉴 목록은 이제 역할과 무관하게 같다. 도달 가능성은 canAccessPath 가 정한다.
    for (const { route } of DASHBOARDS) {
      expect(findPageAccess(route)?.labelKey).toBeTruthy();
    }
  });

  it('운영자는 자기 콘솔을, 엔지니어는 자기 화면을 연다', () => {
    expect(canAccessPath('operator', '/operator-view')).toBe(true);
    expect(canAccessPath('engineer', '/analytics')).toBe(true);
    // 반대로 운영자에게 엔지니어 분석 화면은 열지 않는다.
    expect(canAccessPath('operator', '/analytics')).toBe(false);
  });

  it('메뉴 라벨이 ko/vi 양쪽에 있다', () => {
    for (const locale of ['ko', 'vi']) {
      const nav = JSON.parse(read(`public/locales/${locale}/common.json`)).nav;
      expect(typeof nav.operatorView).toBe('string');
      expect(nav.operatorView.length).toBeGreaterThan(0);
    }
  });
});
