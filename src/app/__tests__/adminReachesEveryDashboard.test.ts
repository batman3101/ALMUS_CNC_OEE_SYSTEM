import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (relative: string) => readFileSync(resolve(process.cwd(), relative), 'utf8');

/**
 * 총괄 관리자는 자기 시스템의 모든 화면을 열어볼 수 있어야 한다. 볼 수 없는 화면은
 * 유지보수할 수 없다.
 *
 * DashboardRouter 는 user.role 로만 화면을 고른다. 그래서 엔지니어 화면은 /analytics
 * 라는 우회 경로가 있었지만 운영자 화면은 없었고, 관리자에게 OperatorDashboard 는
 * 도달 자체가 불가능했다 (2026-07-17 발견).
 */
describe('관리자는 모든 역할의 대시보드에 도달할 수 있다', () => {
  const DASHBOARDS = [
    { name: 'EngineerDashboard', page: 'src/app/analytics/page.tsx' },
    { name: 'OperatorDashboard', page: 'src/app/operator-view/page.tsx' },
  ];

  it.each(DASHBOARDS)('$name 을 여는 관리자 경로가 존재한다', ({ name, page }) => {
    expect(existsSync(resolve(process.cwd(), page))).toBe(true);

    const source = read(page);
    expect(source).toContain(name);

    // RoleGuard 가 admin 을 허용해야 한다.
    const guard = /allowedRoles=\{\[([^\]]*)\]\}/.exec(source);
    expect(guard).not.toBeNull();
    expect(guard![1]).toContain("'admin'");
  });

  it('사이드바가 관리자에게 그 경로들을 실제로 노출한다', () => {
    const sidebar = read('src/components/layout/Sidebar.tsx');
    // admin 분기(case 'admin' 이후 break 까지)만 검사한다. 경로가 파일 어딘가에
    // 존재하는 것과 관리자 메뉴에 실제로 뜨는 것은 다르다.
    const adminBlock = /case 'admin':([\s\S]*?)break;/.exec(sidebar);
    expect(adminBlock).not.toBeNull();
    expect(adminBlock![1]).toContain("'/analytics'");
    expect(adminBlock![1]).toContain("'/operator-view'");
  });

  it('운영자 화면 보기는 관리자 전용이다 (운영자·엔지니어에게 열지 않는다)', () => {
    const guard = /allowedRoles=\{\[([^\]]*)\]\}/.exec(read('src/app/operator-view/page.tsx'));
    expect(guard![1]).not.toContain("'operator'");
    expect(guard![1]).not.toContain("'engineer'");
  });

  it('메뉴 라벨이 ko/vi 양쪽에 있다', () => {
    for (const locale of ['ko', 'vi']) {
      const nav = JSON.parse(read(`public/locales/${locale}/common.json`)).nav;
      expect(typeof nav.operatorView).toBe('string');
      expect(nav.operatorView.length).toBeGreaterThan(0);
    }
  });
});
