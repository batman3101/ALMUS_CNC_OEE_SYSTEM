import { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * API Route 인증/인가 헬퍼 (서버 전용).
 *
 * src/middleware.ts 는 matcher 에서 `/api` 를 명시적으로 제외하므로 API 라우트에는
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
    .select('role')
    .eq('user_id', data.user.id)
    .single();

  if (profileError || !profile?.role) {
    throw new ApiAuthError('사용자 프로필을 찾을 수 없습니다', 403);
  }

  const role = profile.role as UserRole;

  if (allowedRoles && !allowedRoles.includes(role)) {
    throw new ApiAuthError('권한이 없습니다', 403);
  }

  return { userId: data.user.id, role };
}
