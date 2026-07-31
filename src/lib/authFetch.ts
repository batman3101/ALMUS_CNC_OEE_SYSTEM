'use client';

import { supabase } from '@/lib/supabase';
import { notifySessionExpired } from '@/lib/sessionExpiry';

/**
 * 현재 Supabase 세션의 access token 을 Authorization 헤더로 붙여 요청한다.
 *
 * 관리자 전용 API 라우트는 서비스 롤(RLS 우회)로 동작하므로 라우트가 직접 토큰을 검사한다.
 * 이 헬퍼를 쓰지 않으면 그 라우트들은 401 을 돌려준다.
 */
export async function authFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const response = await requestWithToken(input, init);
  if (response.status !== 401) return response;

  /**
   * 401 은 **세션 문제**다 — 권한 부족은 `requireUser` 가 403 으로 구분해서 돌려준다
   * (`@/lib/apiAuth`). 그래서 여기서 401 을 만나면 도메인 오류가 아니라는 것을 알 수 있다.
   *
   * 먼저 토큰 갱신을 **한 번** 시도한다. 만료의 상당수는 갱신으로 회복되는데, 그 경우에도
   * 예전에는 화면이 "…를 불러오지 못했습니다"를 띄우고 사용자가 새로고침을 하고 있었다.
   * 갱신에 성공하면 원래 요청을 그대로 한 번 더 보낸다.
   */
  const { data, error } = await supabase.auth.refreshSession();
  if (!error && data.session?.access_token) {
    const retried = await requestWithToken(input, init);
    if (retried.status !== 401) return retried;
  }

  // 갱신해도 401 이면 세션은 정말 끝났다. 각 화면이 자기 도메인 언어로 옮겨 적기 전에
  // 앱 전체에 한 번 알린다 — 원인은 데이터가 아니라 로그인이다.
  notifySessionExpired();
  return response;
}

async function requestWithToken(input: string, init: RequestInit): Promise<Response> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  const headers = new Headers(init.headers);
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(input, { ...init, headers });
}
