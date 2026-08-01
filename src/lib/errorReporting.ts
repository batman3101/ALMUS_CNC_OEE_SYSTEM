'use client';

import { isSessionExpired } from '@/lib/sessionExpiry';

/**
 * 실패를 도메인 언어로 옮겨 적어도 되는지 판정하는 **한 곳**.
 *
 * ## 무엇이 문제였나 (2026-07-31)
 *
 * 저장소에는 실패를 자기 도메인 언어로 옮겨 적는 자리가 **30개 파일 88곳** 있었고
 * (`message.error` 69 + `useMessage()` 의 `showError` 19), 그중 어느 곳도 **원인을
 * 구분하지 않았다.** `showError` 로 감싸인 19곳은 `message.error` 만 세면 보이지 않아
 * 앞선 조사에서 통째로 빠졌었다 — 래퍼는 호출 수를 줄이지 않고 **숨긴다.**
 *
 * 그래서 토큰이 만료돼 401 이 쏟아지는 동안 사용자가 본 것은
 *
 *   "비가동 내역을 불러오지 못했습니다"
 *   "대시보드 데이터를 불러오는데 실패했습니다"
 *
 * 였다. 원인은 비가동도 대시보드도 아니라 로그인인데 화면은 데이터가 깨진 것처럼 말했고,
 * 그래서 사용자는 4분 동안 새로고침만 반복했다(운영 로그 09:03~09:07).
 *
 * 이전 수정은 전환 시점에 `message.destroy()` 로 떠 있는 토스트를 걷는 것이었다. 그건
 * **증상 정리**였다 — 만료 시점에 이미 날아가 있던 요청들은 조금 늦게 깨어나 다시 토스트를
 * 띄웠고, 만료 안내 위에 잠깐 겹쳐 보였다.
 *
 * ## 왜 여기 한 곳인가
 *
 * 원인 구분을 호출 지점에 맡기면 해석이 71개 생기고, 새 화면이 추가될 때마다 또 하나가
 * 빠진다. 판정은 여기 하나만 두고 호출 지점은 **결정하지 않고 물어보기만** 한다.
 *
 * ## 판정 규칙
 *
 * 1. **세션이 이미 끝났으면 아무 말도 하지 않는다.** 화면에는 이미 만료 안내가 떠 있고,
 *    그 위에 도메인 실패를 겹쳐 놓으면 이야기가 둘로 갈린다. 순서는 보장된다 —
 *    `authFetch` 는 응답을 돌려주기 전에 `notifySessionExpired()` 를 동기적으로 부르므로
 *    401 때문에 실행되는 `catch` 는 예외 없이 참이 된 값을 본다. 늦게 도착한 토스트도
 *    같은 값을 보므로 여기서 함께 걸린다.
 *
 * 2. **오류 자체가 세션 문제라고 말하면 그것도 믿는다.** `authFetch` 를 지나지 않는 경로가
 *    아직 세 곳 있다(`AuthContext`, `MachineDetail`, `lib/systemSettings`). 이들은 (1) 을
 *    울리지 못하므로 오류 모양으로 한 번 더 거른다.
 *
 * 3. **그 외에는 전부 말한다.** 권한 부족(403)·중복(23505)·검증 실패는 서버가 준 **진짜
 *    도메인 답**이다. 조용히 삼키면 그게 더 나쁜 버그가 된다 — 판정을 좁게 잡는 이유다.
 */

/** 401 로 끝나는 인증 실패만 고른다. */
const SESSION_HTTP_STATUS = 401;

/**
 * PostgREST 가 JWT 문제에 붙이는 코드.
 *
 * 권한 부족(`42501`)이나 RLS 거부는 여기 넣지 않는다 — 그건 "당신은 이걸 볼 수 없다"는
 * 답이지 "로그인이 끝났다"가 아니다. 삼키면 사용자는 이유 없이 빈 화면을 본다.
 */
const JWT_EXPIRED_CODE = 'PGRST301';

/**
 * 이 오류가 **세션** 문제인가.
 *
 * 401 과 `PGRST301` 만 본다. 넓게 잡을수록 진짜 도메인 실패를 조용히 삼킬 위험이 커지고,
 * 삼켜진 실패는 아무 흔적을 남기지 않아 재현조차 못 한다.
 */
export function isSessionFailure(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;

  /**
   * `instanceof Response` 로 갈라 보지 않는다.
   *
   * `Response` 는 **전역이 있을 때만** 성립하는 검사다. jsdom 처럼 그 전역이 없는 환경에서
   * `instanceof` 는 값이 뭐든 `ReferenceError` 로 터진다 — 판정을 하러 들어온 함수가
   * 판정 대신 예외를 던지면, 원래 실패는 그 예외에 묻혀 사라진다.
   *
   * 필요하지도 않다. `Response` 는 이미 숫자 `status` 를 가진 객체이므로 아래 한 줄이
   * `Response` 와 Supabase `AuthError` 를 **같은 모양으로** 함께 받는다.
   */
  const shape = error as { status?: unknown; code?: unknown };
  if (shape.status === SESSION_HTTP_STATUS) return true;
  if (shape.code === JWT_EXPIRED_CODE) return true;

  return false;
}

/**
 * 이 실패를 도메인 언어로 알려도 되는가.
 *
 * `error` 는 넘기지 않아도 된다 — 규칙 (1) 만으로도 `authFetch` 를 지나는 경로는 전부
 * 걸린다. 손에 오류 객체가 있으면 넘기는 편이 낫다(규칙 2).
 */
export function shouldReportFailure(error?: unknown): boolean {
  if (isSessionExpired()) return false;
  if (isSessionFailure(error)) return false;
  return true;
}
