import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  canChangeUserRole,
  canManageAccountWithRole,
  USER_MANAGEMENT_ROLES,
} from '@/lib/pageAccess';

/**
 * API Route 인증/인가 헬퍼 (서버 전용).
 *
 * src/proxy.ts 는 matcher 에서 `/api` 를 명시적으로 제외하므로 API 라우트에는
 * 어떤 인증도 자동 적용되지 않는다. 서비스 롤(RLS 우회) 클라이언트를 쓰는 라우트가
 * 세션을 직접 검사하지 않으면 그 라우트는 사실상 공개 엔드포인트가 된다.
 *
 * 이 모듈은 supabase-admin(서비스 롤 키)을 import 하므로 절대 클라이언트 컴포넌트에서
 * 사용하면 안 된다.
 */

export type UserRole = 'admin' | 'engineer' | 'operator';

export interface AuthenticatedUser {
  userId: string;
  role: UserRole;
  assignedMachineIds: string[];
}

export class ApiAuthError extends Error {
  constructor(
    message: string,
    readonly status: 401 | 403
  ) {
    super(message);
    this.name = 'ApiAuthError';
  }
}

/**
 * Authorization: Bearer <access_token> 헤더를 검증하고 사용자 역할을 반환한다.
 * 허용 역할을 넘기면 그 역할이 아닐 때 403 을 던진다.
 */
export async function requireUser(
  request: NextRequest,
  allowedRoles?: UserRole[]
): Promise<AuthenticatedUser> {
  const authHeader = request.headers.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

  if (!token) {
    throw new ApiAuthError('인증이 필요합니다', 401);
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data?.user) {
    throw new ApiAuthError('유효하지 않은 세션입니다', 401);
  }

  const { data: profile, error: profileError } = await supabaseAdmin
    .from('user_profiles')
    .select('role, assigned_machines, is_active')
    .eq('user_id', data.user.id)
    .single();

  if (profileError || !profile?.role) {
    throw new ApiAuthError('사용자 프로필을 찾을 수 없습니다', 403);
  }

  if (profile.is_active !== true) {
    throw new ApiAuthError('비활성화된 계정입니다', 403);
  }

  if (!isUserRole(profile.role)) {
    throw new ApiAuthError('유효하지 않은 사용자 역할입니다', 403);
  }

  const role = profile.role;

  if (allowedRoles && !allowedRoles.includes(role)) {
    throw new ApiAuthError('권한이 없습니다', 403);
  }

  const assignedMachineIds = Array.isArray(profile.assigned_machines)
    ? profile.assigned_machines.filter(
        (machineId): machineId is string => typeof machineId === 'string' && machineId.length > 0
      )
    : [];

  return { userId: data.user.id, role, assignedMachineIds };
}

function isUserRole(value: unknown): value is UserRole {
  return value === 'admin' || value === 'engineer' || value === 'operator';
}

/** 요청 본문의 역할 값을 검증한다. 알 수 없는 값은 통과시키지 않는다. */
export function parseUserRole(value: unknown): UserRole {
  if (!isUserRole(value)) {
    throw new ApiAuthError('유효하지 않은 사용자 역할입니다', 403);
  }
  return value;
}

/** 운영자는 관리자에게 배정된 설비만 변경할 수 있다. */
export function assertMachineAccess(user: AuthenticatedUser, machineId: string): void {
  if (user.role === 'operator' && !user.assignedMachineIds.includes(machineId)) {
    throw new ApiAuthError('담당 설비에 대한 권한이 없습니다', 403);
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * 사용자 관리 인가 (서버 강제)
 *
 * 화면에서 버튼을 감추는 것은 경계가 아니다. `/admin` 에 정상 접근하는 관리자라면
 * 브라우저 콘솔에서 `POST /api/admin/users` 를 그대로 부를 수 있으므로, UI 제한만으로는
 * "관리자는 역할을 못 바꾼다"가 참이 되지 않는다. 규칙은 `@/lib/pageAccess` 한 곳에
 * 있고 화면과 이 서버 층이 **같은 함수**를 부른다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 사용자 관리 API 의 공통 진입 검사. 시스템 관리자 + 관리자만 통과한다. */
export function requireUserManager(request: NextRequest): Promise<AuthenticatedUser> {
  return requireUser(request, [...USER_MANAGEMENT_ROLES]);
}

/**
 * 대상 계정의 **현재 역할**을 읽는다. 인가 판단의 재료이므로 요청 본문이 아니라 DB 에서
 * 가져온다 — 본문의 role 은 호출자가 마음대로 적을 수 있고, 그걸 믿으면 검사 자체가
 * 무의미해진다(관리자가 admin 계정을 지우면서 본문에 role:'operator' 를 적는 식).
 */
export async function fetchAccountRole(userId: string): Promise<UserRole> {
  const { data, error } = await supabaseAdmin
    .from('user_profiles')
    .select('role')
    .eq('user_id', userId)
    .single();

  if (error || !data?.role || !isUserRole(data.role)) {
    throw new ApiAuthError('대상 사용자를 찾을 수 없습니다', 403);
  }
  return data.role;
}

/**
 * `actor` 가 `targetRole` 계정을 생성·삭제·수정해도 되는가.
 *
 * 관리자(engineer)에게 admin 계정을 열면 승격 경로가 남는다 — 새 admin 계정을 만들어 그
 * 비밀번호로 로그인하거나, 기존 admin 의 이메일을 자기 것으로 바꿔 비밀번호를 재설정하면
 * 역할 변경과 결과가 같다. 그래서 admin 계정은 **손대는 것 자체**를 막는다.
 */
export function assertCanManageAccount(actor: UserRole, targetRole: UserRole): void {
  if (!canManageAccountWithRole(actor, targetRole)) {
    throw new ApiAuthError('시스템 관리자 계정은 시스템 관리자만 관리할 수 있습니다', 403);
  }
}

/** 역할 변경 요청인지 판별하고, 맞다면 시스템 관리자만 통과시킨다. */
export function assertCanAssignRole(
  actor: UserRole,
  currentRole: UserRole,
  nextRole: unknown
): void {
  if (nextRole === undefined || nextRole === null) return;
  if (!isUserRole(nextRole)) {
    throw new ApiAuthError('유효하지 않은 사용자 역할입니다', 403);
  }
  // 바꾸지 않는 요청은 통과. 편집 화면이 role 을 항상 함께 보내기 때문에, 변경 여부를
  // 보지 않으면 관리자는 이름 하나도 고칠 수 없게 된다.
  if (nextRole === currentRole) return;
  if (!canChangeUserRole(actor)) {
    throw new ApiAuthError('역할 변경은 시스템 관리자만 할 수 있습니다', 403);
  }
  assertCanManageAccount(actor, nextRole);
}

/** 인증/인가 예외를 기존 API 응답 모양으로 변환한다. */
export function apiAuthErrorResponse(error: unknown): NextResponse | null {
  if (!(error instanceof ApiAuthError)) return null;

  return NextResponse.json(
    { success: false, error: error.message },
    { status: error.status }
  );
}
