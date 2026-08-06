'use client';

/**
 * OS 브라우저 알림(`Notification`) 표시.
 *
 * ## 권한 상태와 앱 설정은 **다른 것**이다
 *
 * - 권한 `granted` + 설정 꺼짐 → 띄우지 않는다. 관리자가 끄라고 했기 때문이다.
 * - 설정 켜짐 + 권한 `denied` → 띄우지 않는다. 그리고 **그건 버그가 아니다** — 브라우저
 *   수준의 거부를 앱이 되돌릴 방법은 없고, 되돌리려 시도하는 것도 옳지 않다.
 *
 * 그래서 이 모듈은 권한만 본다. 설정 판정은 호출자가 하고
 * (`useNotificationPreferences().browserEnabled`), 둘 다 참일 때만 여기까지 온다.
 *
 * ## 권한을 **요청하지 않는다**
 *
 * 설정이 켜졌다는 이유로 `requestPermission()` 을 부르면, 관리자가 저장 버튼을 누른 순간
 * 다른 사용자 화면에 브라우저 권한 팝업이 뜨는 셈이 된다. 권한 요청은 사용자가 그것을 의도해
 * 누르는 자리(`useOperationalAlerts.requestNotificationPermission`)에서만 일어난다.
 */

/** `Notification` 전역이 있는 환경인가. jsdom·SSR 에는 없다. */
export function isBrowserNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

/** 현재 권한 상태. 미지원 환경은 `null` — "거부"와 "그런 개념이 없음"은 다르다. */
export function getBrowserNotificationPermission(): NotificationPermission | null {
  if (!isBrowserNotificationSupported()) return null;
  return window.Notification.permission;
}

export interface BrowserNotificationInput {
  readonly title: string;
  readonly body: string;
  /**
   * 같은 사건의 재알림을 브라우저가 겹쳐 쌓지 않고 **교체**하게 하는 키.
   * 알림 id(`설비_상태`)를 그대로 쓴다.
   */
  readonly tag?: string;
}

/**
 * 브라우저 알림을 띄운다.
 *
 * @returns 실제로 띄웠으면 `true`. 미지원·권한 미승인·생성 실패는 `false` 이며
 *          **예외를 던지지 않는다** — 알림 표시가 실패해도 앱 내 알림 목록은 그대로 떠야 한다.
 */
export function showBrowserNotification(input: BrowserNotificationInput): boolean {
  if (!isBrowserNotificationSupported()) return false;
  if (window.Notification.permission !== 'granted') return false;

  try {
    new window.Notification(input.title, {
      body: input.body,
      tag: input.tag,
    });
    return true;
  } catch (error) {
    // 일부 브라우저(모바일 Chrome 등)는 Service Worker 없이 생성자를 부르면 던진다.
    console.warn('🔕 브라우저 알림 표시 실패:', error);
    return false;
  }
}
