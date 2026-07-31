'use client';

/**
 * "세션이 끝났다"를 앱 전체에 한 번만 알리는 통로.
 *
 * ## 왜 필요한가 (2026-07-31 실측)
 *
 * 운영 로그에서 09:03~09:07 사이 `/downtime`, `/production-progress`,
 * `/production-records/pending`, `/machines`, `/auth/profile-admin` 이 **전부 401** 이었다
 * (같은 24시간 동안 500 은 0건). 토큰이 만료된 채 화면이 30초마다 폴링하고 있었던 것이다.
 *
 * 그런데 사용자가 본 것은 "비가동 내역을 불러오지 못했습니다" 였다. 각 컴포넌트가 자기
 * 도메인 언어로 실패를 옮겨 적었기 때문이다. 원인은 비가동이 아니라 로그인인데 화면은
 * 데이터가 깨진 것처럼 말했고, 그래서 새로고침·재시도만 반복하게 된다.
 *
 * ## 왜 컴포넌트가 아니라 여기인가
 *
 * 401 을 컴포넌트마다 해석하면 해석이 컴포넌트 수만큼 생기고, 새 화면이 추가될 때마다
 * 또 하나 빠진다. 인증 요청은 전부 `authFetch` 한 곳을 지나므로 거기서 한 번 판정하고
 * 여기로 알린다. 화면은 "세션이 끝났다"는 사실 하나만 받는다.
 *
 * ## 한 번만 알린다
 *
 * 만료되면 진행 중이던 요청이 동시에 여러 개 401 을 받는다(위 로그에서 매 30초마다 3개씩).
 * 그때마다 알리면 로그아웃 처리가 겹쳐 실행된다. 그래서 `reset()` 전까지는 첫 번째만
 * 통과시킨다 — 로그인에 성공하면 `resetSessionExpiryNotice()` 로 다시 열어 준다.
 */

type Listener = () => void;

const listeners = new Set<Listener>();
let alreadyNotified = false;

/** 세션 만료를 구독한다. 반환값을 호출하면 구독이 해제된다. */
export function onSessionExpired(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 세션이 끝났음을 알린다. 두 번째부터는 `reset` 전까지 무시된다. */
export function notifySessionExpired(): void {
  if (alreadyNotified) return;
  alreadyNotified = true;
  // 구독 목록을 복사해서 순회한다 — 리스너가 자기 구독을 해제해도 안전하다.
  for (const listener of [...listeners]) {
    listener();
  }
}

/** 로그인에 성공했을 때 호출한다. 다음 만료를 다시 알릴 수 있게 된다. */
export function resetSessionExpiryNotice(): void {
  alreadyNotified = false;
}

/** 테스트용 — 모듈 상태가 테스트 사이에 새지 않게 한다. */
export function __resetSessionExpiryForTests(): void {
  listeners.clear();
  alreadyNotified = false;
}
