/**
 * 페이지 접근 권한의 **단일 원천**.
 *
 * ## 왜 이 파일이 생겼나
 *
 * 규칙이 두 곳에 따로 적혀 있었다. 하나는 `Sidebar.tsx` 의 `switch (userRole)`(무엇이
 * 보이는가), 다른 하나는 각 페이지의 `<ProtectedRoute allowedRoles>` / `<RoleGuard
 * allowedRoles>`(무엇에 도달하는가). 둘은 이미 어긋나 있었다:
 *
 *   /settings      사이드바: 전원  ·  페이지 가드: 없음    → 운영자가 시스템 설정을 열 수 있었다
 *   /data-input    사이드바: 전원  ·  페이지 가드: 없음    → 운영자도 접근
 *   /operator-view 사이드바: admin ·  페이지 가드: admin   → 운영자가 자기 콘솔에 못 갔다
 *   /analytics     사이드바: admin ·  페이지 가드: a+eng   → 엔지니어는 메뉴 없이 URL 로만
 *
 * 어긋남 자체가 결함이 아니라, **어긋날 수 있다는 구조**가 결함이다. 그래서 규칙을 여기
 * 한 표에만 두고, 사이드바와 접근 가드가 **같은 표를 읽는다**. 한쪽만 고치는 일이
 * 물리적으로 불가능해진다.
 *
 * ## 등급 (2026-07-31 사용자 확정)
 *
 *   admin    시스템 관리자 — 전체 페이지 + CRUD
 *   engineer 관리자        — '설정'을 제외한 모든 페이지 CRUD
 *   operator 사용자        — 대시보드 / 설비 현황 / 생산 기록 관리 / 운영자 화면 보기
 *
 * 사이드바에는 **모든 역할이 같은 메뉴 목록**을 본다. 권한이 없는 항목은 사라지지 않고
 * 자물쇠와 함께 비활성으로 남는다 — 메뉴가 역할마다 달라지면 "내 화면에는 그 메뉴가
 * 없다"는 문의가 곧바로 생기고, 무엇이 존재하는지조차 알 수 없다.
 */

export type UserRole = 'admin' | 'engineer' | 'operator';

export const ALL_ROLES: readonly UserRole[] = ['admin', 'engineer', 'operator'];

/** 시스템 관리자 전용. */
const ADMIN_ONLY: readonly UserRole[] = ['admin'];
/** 시스템 관리자 + 관리자. 운영자에게는 닫힌다. */
const MANAGERS: readonly UserRole[] = ['admin', 'engineer'];

export interface PageAccessEntry {
  /** 라우트 경로. `src/app/.../page.tsx` 와 1:1 로 대응한다. */
  readonly path: string;
  /** 이 경로에 도달할 수 있는 역할. */
  readonly roles: readonly UserRole[];
  /** 사이드바 메뉴에 올릴 때 쓰는 common 네임스페이스 i18n 키. 없으면 메뉴에 없는 경로. */
  readonly labelKey?: string;
}

/**
 * 사이드바 노출 순서 = 이 배열의 순서. 메뉴 순서를 바꾸려면 여기서 줄을 옮긴다.
 *
 * `labelKey` 가 없는 항목은 메뉴에 뜨지 않지만 **접근 규칙은 그대로 적용된다**. 메뉴에
 * 없다는 것이 접근할 수 없다는 뜻은 아니므로, 링크로만 도달하는 경로도 반드시 등록한다.
 */
export const PAGE_ACCESS: readonly PageAccessEntry[] = [
  { path: '/dashboard', roles: ALL_ROLES, labelKey: 'nav.dashboard' },
  { path: '/machines', roles: ALL_ROLES, labelKey: 'nav.machines' },
  { path: '/data-input', roles: MANAGERS, labelKey: 'nav.dataInput' },
  { path: '/production-records', roles: ALL_ROLES, labelKey: 'nav.productionRecords' },
  { path: '/model-info', roles: MANAGERS, labelKey: 'nav.modelInfo' },
  { path: '/reports', roles: MANAGERS, labelKey: 'nav.reports' },
  { path: '/analytics', roles: MANAGERS, labelKey: 'nav.analytics' },
  { path: '/operator-view', roles: ALL_ROLES, labelKey: 'nav.operatorView' },
  { path: '/admin', roles: MANAGERS, labelKey: 'nav.management' },
  { path: '/settings', roles: ADMIN_ONLY, labelKey: 'nav.settings' },

  // ── 메뉴에 없는 경로 (링크·직접 URL 로만 도달) ────────────────────────────
  // 설비 마스터 일괄 등록. /admin 의 '설비 관리' 탭과 같은 권한이어야 한다 —
  // 탭에서는 막고 URL 로는 열어 두면 막은 것이 아니다.
  { path: '/machines/bulk-upload', roles: MANAGERS },
  // 최초 관리자 계정 생성. 사용자 관리와 같은 등급으로 묶는다.
  { path: '/admin/setup-user', roles: ADMIN_ONLY },
];

/**
 * 로그인 없이 열리는 경로. 여기 없는 모든 경로는 **로그인을 요구한다**.
 *
 * 허용 목록으로 쓰는 이유: 새 페이지를 만들었는데 등록을 잊으면 "누구나 열림"이 아니라
 * "아무도 못 엶"이 된다. 잊었을 때 데이터가 새는 쪽이 아니라 화면이 안 열리는 쪽으로
 * 실패해야 한다.
 */
export const PUBLIC_PATHS: readonly string[] = ['/', '/login'];

const stripTrailingSlash = (path: string): string =>
  path.length > 1 && path.endsWith('/') ? path.replace(/\/+$/, '') : path;

/** 로그인 없이 열리는 경로인가. */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.includes(stripTrailingSlash(pathname));
}

/**
 * 경로에 해당하는 규칙을 찾는다. 등록되지 않은 경로면 `null`.
 *
 * **가장 긴 접두사**가 이긴다. `/machines/bulk-upload` 가 `/machines`(전원 허용)를 조용히
 * 물려받으면, 운영자가 설비 마스터를 일괄 등록할 수 있게 된다. 하위 경로는 상위보다
 * 느슨해질 수 없어야 하는 게 아니라, 애초에 **자기 규칙을 스스로 밝혀야** 한다.
 */
export function findPageAccess(pathname: string): PageAccessEntry | null {
  const path = stripTrailingSlash(pathname);
  let best: PageAccessEntry | null = null;

  for (const entry of PAGE_ACCESS) {
    const matches = path === entry.path || path.startsWith(`${entry.path}/`);
    if (!matches) continue;
    if (best === null || entry.path.length > best.path.length) best = entry;
  }

  return best;
}

/**
 * 이 역할이 이 경로를 열 수 있는가.
 *
 * 등록되지 않은 경로는 **거부**한다(fail-closed). 등록을 잊은 새 페이지가 전원에게
 * 열리는 것보다, 아무에게도 안 열려 즉시 드러나는 편이 낫다. 누락은
 * `src/lib/__tests__/pageAccess.test.ts` 가 라우트 전수로 잡는다.
 */
export function canAccessPath(role: UserRole | undefined, pathname: string): boolean {
  if (!role) return false;
  const entry = findPageAccess(pathname);
  return entry !== null && entry.roles.includes(role);
}

/** 사이드바가 그릴 메뉴 항목. 역할과 무관하게 **항상 같은 목록**을 돌려준다. */
export function getNavEntries(): PageAccessEntry[] {
  return PAGE_ACCESS.filter((entry): entry is PageAccessEntry & { labelKey: string } =>
    typeof entry.labelKey === 'string'
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * 사용자 관리 세부 권한
 *
 * 라우트 권한만으로는 표현할 수 없는 층이다. 관리자(engineer)는 `/admin` 페이지 전체를
 * 갖지만, 그 안에서 **할 수 있는 일**은 시스템 관리자와 다르다.
 *
 * 경계를 어디에 그었나 (2026-07-31 사용자 확정):
 *   관리자는 사용자를 **만들고 지운다**. 역할을 바꾸지는 못한다.
 *
 * 왜 그 선에서 멈추나 — 역할 변경을 열면 등급 체계가 스스로를 부정한다. 관리자가 자기
 * `role` 을 admin 으로 바꾸는 순간 '설정 제외'는 사라진다. 같은 이유로 **admin 계정을
 * 만들거나 지우는 것**도 막는다. 새 admin 계정을 만들어 그 비밀번호로 로그인하면
 * 역할 변경과 결과가 같기 때문이다 — 한쪽만 막으면 막은 것이 아니다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 사용자 관리 화면(탭)에 들어갈 수 있는가. */
export function canManageUsers(role: UserRole | undefined): boolean {
  return role === 'admin' || role === 'engineer';
}

/**
 * 사용자 관리 API 가 요구할 역할 목록. `canManageUsers` 에서 **파생**시킨다 —
 * `['admin','engineer']` 를 라우트마다 다시 적으면 규칙이 그만큼 늘어난다.
 */
export const USER_MANAGEMENT_ROLES: readonly UserRole[] = ALL_ROLES.filter(canManageUsers);

/**
 * `actor` 가 `targetRole` 을 가진 계정을 생성·삭제할 수 있는가.
 *
 * 관리자에게 admin 계정 생성/삭제를 열면 승격 경로가 그대로 남는다. 반대로 admin 계정을
 * **지울** 수 있게 두면 시스템 관리자를 전부 지워 아무도 설정에 못 들어가는 상태를 만들 수
 * 있다. 생성과 삭제를 같은 규칙으로 묶는 이유다.
 */
export function canManageAccountWithRole(
  actor: UserRole | undefined,
  targetRole: UserRole
): boolean {
  if (actor === 'admin') return true;
  if (actor === 'engineer') return targetRole !== 'admin';
  return false;
}

/** 기존 계정의 역할을 바꿀 수 있는가 — 시스템 관리자 전용. */
export function canChangeUserRole(actor: UserRole | undefined): boolean {
  return actor === 'admin';
}

/** 관리자에게 선택지로 내줄 역할 목록. admin 은 자기와 같은 등급을 만들 수 있다. */
export function assignableRoles(actor: UserRole | undefined): UserRole[] {
  return ALL_ROLES.filter((role) => canManageAccountWithRole(actor, role));
}
