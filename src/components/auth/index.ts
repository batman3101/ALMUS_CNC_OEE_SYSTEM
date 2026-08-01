export { default as LoginForm } from './LoginForm';
export { default as LoginFormInline } from './LoginFormInline';

/**
 * `ProtectedRoute` / `RoleGuard` / `withAuth` 는 2026-07-31 에 삭제했다.
 *
 * 셋 다 페이지에 역할 배열을 **다시 적게** 만드는 도구였고, 그래서 규칙이 사이드바와
 * 페이지 두 곳에 흩어져 서로 어긋났다(운영자가 시스템 설정을 열 수 있었고, 정작 자기
 * 콘솔에는 못 갔다). 아무도 쓰지 않게 된 뒤에도 남겨 두면 다음 사람이 집어 들어 같은
 * 구조를 되살린다.
 *
 * 페이지 접근 규칙은 `@/lib/pageAccess` 표 한 곳에 있고 `AppLayout` 이 모든 페이지에
 * 적용한다. 새 페이지를 만들면 그 표에 한 줄을 더하면 된다 — 등록하지 않으면
 * `src/lib/__tests__/pageAccess.test.ts` 가 라우트 전수 검사로 잡는다.
 *
 * 페이지보다 작은 단위(탭·버튼)의 권한은 같은 모듈의 `canManageUsers`,
 * `canManageAccountWithRole`, `canChangeUserRole` 을 쓴다.
 */
