import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import {
  ALL_ROLES,
  PAGE_ACCESS,
  assignableRoles,
  canAccessPath,
  canChangeUserRole,
  canManageAccountWithRole,
  canManageUsers,
  findPageAccess,
  getNavEntries,
  isPublicPath,
  USER_MANAGEMENT_ROLES,
} from '../pageAccess';

const repoRoot = process.cwd();
const read = (relative: string) => readFileSync(resolve(repoRoot, relative), 'utf8');

/**
 * 등급별 접근 규칙 (2026-07-31 사용자 확정)
 *
 *   시스템 관리자(admin)    전체 페이지
 *   관리자(engineer)        '설정'을 제외한 모든 페이지
 *   사용자(operator)        대시보드 / 설비 현황 / 생산 기록 관리 / 운영자 화면 보기
 */
describe('등급별 페이지 접근', () => {
  const OPERATOR_PAGES = [
    '/dashboard',
    '/machines',
    '/production-records',
    '/operator-view',
  ];

  it('사용자(operator)는 정해진 네 페이지만 연다', () => {
    const opened = PAGE_ACCESS
      .filter((entry) => entry.roles.includes('operator'))
      .map((entry) => entry.path)
      .sort();

    expect(opened).toEqual([...OPERATOR_PAGES].sort());
  });

  it('관리자(engineer)는 설정만 못 연다', () => {
    const closed = PAGE_ACCESS
      .filter((entry) => !entry.roles.includes('engineer'))
      .map((entry) => entry.path);

    // /admin/setup-user 는 최초 시스템 관리자 계정 생성이라 사용자 관리와 같은 등급이다.
    expect(closed.sort()).toEqual(['/admin/setup-user', '/settings']);
  });

  it('시스템 관리자(admin)는 모든 페이지를 연다', () => {
    for (const entry of PAGE_ACCESS) {
      expect(canAccessPath('admin', entry.path)).toBe(true);
    }
  });

  it('운영자는 설정에 들어갈 수 없다 — 예전에는 가드가 없어 열려 있었다', () => {
    expect(canAccessPath('operator', '/settings')).toBe(false);
    expect(canAccessPath('engineer', '/settings')).toBe(false);
    expect(canAccessPath('admin', '/settings')).toBe(true);
  });

  it('운영자는 자기 콘솔에 들어갈 수 있다 — 예전에는 admin 전용이었다', () => {
    expect(canAccessPath('operator', '/operator-view')).toBe(true);
  });

  it('로그인하지 않은 상태(role undefined)는 어떤 보호 경로도 열지 못한다', () => {
    for (const entry of PAGE_ACCESS) {
      expect(canAccessPath(undefined, entry.path)).toBe(false);
    }
  });
});

describe('경로 매칭', () => {
  it('하위 경로는 가장 긴 접두사를 따른다 — /machines 의 느슨한 규칙을 물려받지 않는다', () => {
    expect(findPageAccess('/machines/bulk-upload')?.path).toBe('/machines/bulk-upload');
    expect(canAccessPath('operator', '/machines')).toBe(true);
    // 설비 마스터 일괄 등록은 운영자에게 열려 있으면 안 된다.
    expect(canAccessPath('operator', '/machines/bulk-upload')).toBe(false);
  });

  it('등록되지 않은 하위 경로는 상위 규칙을 따른다', () => {
    expect(findPageAccess('/dashboard/anything')?.path).toBe('/dashboard');
  });

  it('등록되지 않은 경로는 거부한다 (fail-closed)', () => {
    expect(findPageAccess('/nope')).toBeNull();
    for (const role of ALL_ROLES) {
      expect(canAccessPath(role, '/nope')).toBe(false);
    }
  });

  it('끝의 슬래시는 같은 경로로 본다', () => {
    expect(findPageAccess('/settings/')?.path).toBe('/settings');
    expect(isPublicPath('/login/')).toBe(true);
  });

  it('접두사가 겹치는 다른 경로를 잘못 물지 않는다', () => {
    // '/machines-archive' 는 '/machines' 로 시작하지만 하위 경로가 아니다.
    expect(findPageAccess('/machines-archive')).toBeNull();
  });
});

/**
 * 이 검사가 이 파일의 핵심이다.
 *
 * "운영자가 설정에 못 들어간다"는 **오늘의** 규칙을 확인할 뿐이다. 내일 누군가
 * `src/app/새페이지/page.tsx` 를 만들고 표에 등록하지 않으면, 그 페이지는 fail-closed
 * 규칙 때문에 아무에게도 안 열리고 원인을 찾느라 시간을 쓴다. 라우트를 파일 시스템에서
 * **전수로** 읽어 검사 대상을 스스로 만들게 하면, 등록 누락이 즉시 이름과 함께 드러난다.
 */
describe('모든 라우트가 권한 표에 등록돼 있다', () => {
  const collectRoutes = (dir: string, prefix = ''): string[] => {
    const routes: string[] = [];
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.isDirectory()) {
        // 라우트 그룹 `(name)` 과 비공개 폴더 `_name` 은 URL 에 나타나지 않는다.
        if (item.name.startsWith('_') || item.name === 'api' || item.name === '__tests__') continue;
        const segment = item.name.startsWith('(') ? '' : `/${item.name}`;
        routes.push(...collectRoutes(join(dir, item.name), `${prefix}${segment}`));
      } else if (item.name === 'page.tsx') {
        routes.push(prefix === '' ? '/' : prefix);
      }
    }
    return routes;
  };

  const routes = collectRoutes(resolve(repoRoot, `src${sep}app`));

  it('라우트를 실제로 찾아냈다 (검사가 빈손으로 통과하지 않는다)', () => {
    expect(routes.length).toBeGreaterThanOrEqual(10);
    expect(routes).toContain('/settings');
  });

  it.each(routes)('%s 가 권한 표 또는 공개 경로에 있다', (route) => {
    if (isPublicPath(route)) return;
    const registered = PAGE_ACCESS.some((entry) => entry.path === route);
    expect(registered).toBe(true);
  });

  it('표에 있는 경로는 모두 실제 페이지다 (죽은 규칙을 남기지 않는다)', () => {
    for (const entry of PAGE_ACCESS) {
      expect(routes).toContain(entry.path);
    }
  });
});

describe('사이드바 메뉴', () => {
  it('메뉴 목록은 역할과 무관하게 동일하다', () => {
    // 목록을 만드는 함수가 역할을 인자로 받지 않는다는 것이 이 성질의 근거다.
    expect(getNavEntries).toHaveLength(0);
    expect(getNavEntries().map((e) => e.path)).toEqual([
      '/dashboard',
      '/machines',
      '/data-input',
      '/production-records',
      '/model-info',
      '/reports',
      '/analytics',
      '/operator-view',
      '/admin',
      '/settings',
    ]);
  });

  it('모든 메뉴 라벨 키가 ko/vi 양쪽에 있다', () => {
    for (const locale of ['ko', 'vi']) {
      const common = JSON.parse(read(`public/locales/${locale}/common.json`));
      for (const entry of getNavEntries()) {
        const value = entry.labelKey!
          .split('.')
          .reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], common);
        expect(typeof value).toBe('string');
        expect((value as string).length).toBeGreaterThan(0);
      }
      // 잠긴 메뉴의 안내 문구.
      expect(common.nav.restrictedTo).toContain('{{roles}}');
    }
  });
});

/**
 * 등급 체계가 스스로를 부정하지 않는지 본다.
 *
 * 관리자(engineer)는 사용자를 만들고 지운다. 하지만 시스템 관리자 계정을 만들 수 있으면
 * 그 비밀번호로 로그인해 설정에 도달하고, 기존 시스템 관리자를 편집할 수 있으면 이메일을
 * 자기 것으로 바꿔 비밀번호를 재설정하면 된다. 어느 쪽이든 '설정 제외'가 무너진다.
 */
describe('사용자 관리 권한', () => {
  it('시스템 관리자와 관리자만 사용자 관리 화면에 들어간다', () => {
    expect(canManageUsers('admin')).toBe(true);
    expect(canManageUsers('engineer')).toBe(true);
    expect(canManageUsers('operator')).toBe(false);
    expect(canManageUsers(undefined)).toBe(false);
  });

  it('API 가 요구하는 역할 목록이 화면 규칙에서 파생된다', () => {
    expect([...USER_MANAGEMENT_ROLES].sort()).toEqual(['admin', 'engineer']);
    for (const role of ALL_ROLES) {
      expect(USER_MANAGEMENT_ROLES.includes(role)).toBe(canManageUsers(role));
    }
  });

  it('관리자는 사용자·운영자 계정을 만들고 지울 수 있다', () => {
    expect(canManageAccountWithRole('engineer', 'operator')).toBe(true);
    expect(canManageAccountWithRole('engineer', 'engineer')).toBe(true);
  });

  it('관리자는 시스템 관리자 계정을 만들거나 지울 수 없다 — 승격 경로를 막는다', () => {
    expect(canManageAccountWithRole('engineer', 'admin')).toBe(false);
    expect(assignableRoles('engineer')).toEqual(['engineer', 'operator']);
  });

  it('시스템 관리자는 모든 등급의 계정을 관리한다', () => {
    for (const role of ALL_ROLES) {
      expect(canManageAccountWithRole('admin', role)).toBe(true);
    }
    expect(assignableRoles('admin')).toEqual([...ALL_ROLES]);
  });

  it('역할 변경은 시스템 관리자만 한다', () => {
    expect(canChangeUserRole('admin')).toBe(true);
    expect(canChangeUserRole('engineer')).toBe(false);
    expect(canChangeUserRole('operator')).toBe(false);
  });

  it('운영자는 어떤 계정도 관리할 수 없다', () => {
    for (const role of ALL_ROLES) {
      expect(canManageAccountWithRole('operator', role)).toBe(false);
    }
    expect(assignableRoles('operator')).toEqual([]);
  });
});

/**
 * 규칙이 실제로 적용되는 지점을 고정한다.
 *
 * 페이지에서 역할 가드를 전부 걷어냈으므로, `AppLayout` 이 검사하지 않으면 **모든 페이지가
 * 열린다**. 이 검사는 그 배선이 사라지는 것을 잡는다 — 로직이 아니라 배선을 보는 것이라
 * 소스를 직접 읽는다.
 */
describe('규칙이 적용되는 지점', () => {
  const layout = read('src/components/layout/AppLayout.tsx');

  it('AppLayout 이 모든 페이지에 접근 검사를 건다', () => {
    expect(layout).toContain('canAccessPath');
    expect(layout).toContain('isPublicPath');
  });

  it('사이드바가 같은 표에서 메뉴와 허용 여부를 얻는다', () => {
    const sidebar = read('src/components/layout/Sidebar.tsx');
    expect(sidebar).toContain('getNavEntries');
    expect(sidebar).toContain('canAccessPath');
    // 역할별로 메뉴를 갈라 만들던 분기가 돌아오지 않아야 한다.
    expect(sidebar).not.toMatch(/switch\s*\(\s*userRole\s*\)/);
  });

  it('페이지가 역할을 다시 적지 않는다 — 규칙은 표 한 곳에만 있다', () => {
    const pages = [
      'src/app/settings/page.tsx',
      'src/app/admin/page.tsx',
      'src/app/analytics/page.tsx',
      'src/app/model-info/page.tsx',
      'src/app/operator-view/page.tsx',
      'src/app/production-records/page.tsx',
      'src/app/data-input/page.tsx',
      'src/app/machines/page.tsx',
    ];
    for (const page of pages) {
      expect(read(page)).not.toContain('allowedRoles');
    }
  });
});

/** 서버가 같은 규칙을 강제하는지. 화면 가드는 경계가 아니다. */
describe('사용자 관리 API 가 서버에서 같은 규칙을 강제한다', () => {
  const collection = read('src/app/api/admin/users/route.ts');
  const item = read('src/app/api/admin/users/[userId]/route.ts');

  it('더 이상 admin 만으로 하드코딩하지 않는다', () => {
    for (const source of [collection, item]) {
      expect(source).not.toMatch(/requireUser\(request,\s*\['admin'\]\)/);
      expect(source).toContain('requireUserManager');
    }
  });

  it('생성은 대상 역할을 검사한다', () => {
    expect(collection).toMatch(/assertCanManageAccount\(actor\.role,\s*parseUserRole\(role\)\)/);
  });

  it('삭제·수정은 대상 역할을 DB 에서 읽어 검사한다', () => {
    for (const source of [collection, item]) {
      expect(source).toContain('fetchAccountRole');
    }
    expect(item).toContain('assertCanAssignRole');
  });
});
