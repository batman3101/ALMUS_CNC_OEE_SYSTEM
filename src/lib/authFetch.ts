'use client';

import { supabase } from '@/lib/supabase';

/**
 * 현재 Supabase 세션의 access token 을 Authorization 헤더로 붙여 요청한다.
 *
 * 관리자 전용 API 라우트는 서비스 롤(RLS 우회)로 동작하므로 라우트가 직접 토큰을 검사한다.
 * 이 헬퍼를 쓰지 않으면 그 라우트들은 401 을 돌려준다.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(input, { ...init, headers });
}
