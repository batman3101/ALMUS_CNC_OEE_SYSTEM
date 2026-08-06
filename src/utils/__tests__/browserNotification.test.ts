/**
 * 브라우저 알림 — **권한 상태와 앱 설정은 다른 것**이다.
 *
 * 이 모듈은 권한만 본다. 설정 판정은 호출자(NotificationContext)가 하며, 그 경계가 흐려지면
 * "권한을 줬는데 왜 설정을 껐는데도 뜨느냐" 또는 그 반대가 된다.
 */
import {
  getBrowserNotificationPermission,
  isBrowserNotificationSupported,
  showBrowserNotification,
} from '@/utils/browserNotification';

const scope = window as unknown as Record<string, unknown>;

let constructed: Array<{ title: string; options?: NotificationOptions }> = [];

function installNotification(permission: NotificationPermission | null, throwOnConstruct = false) {
  if (permission === null) {
    delete scope.Notification;
    return;
  }
  const NotificationMock = function (this: unknown, title: string, options?: NotificationOptions) {
    if (throwOnConstruct) throw new Error('Illegal constructor');
    constructed.push({ title, options });
  } as unknown as { permission: NotificationPermission };
  NotificationMock.permission = permission;
  scope.Notification = NotificationMock;
}

describe('showBrowserNotification', () => {
  beforeEach(() => {
    constructed = [];
  });

  afterAll(() => {
    delete scope.Notification;
  });

  it('권한이 granted 면 알림을 띄운다', () => {
    installNotification('granted');

    expect(showBrowserNotification({ title: '제목', body: '본문', tag: 'machine-1_BREAKDOWN_REPAIR' }))
      .toBe(true);
    expect(constructed).toHaveLength(1);
    expect(constructed[0].title).toBe('제목');
    // 같은 사건이 다시 보고돼도 겹쳐 쌓이지 않게 tag 를 넘긴다.
    expect(constructed[0].options?.tag).toBe('machine-1_BREAKDOWN_REPAIR');
  });

  it('권한이 denied 면 띄우지 않는다 — 그리고 그것은 버그가 아니다', () => {
    installNotification('denied');

    expect(showBrowserNotification({ title: '제목', body: '본문' })).toBe(false);
    expect(constructed).toHaveLength(0);
  });

  it('권한이 default(미결정)면 띄우지 않고 요청도 하지 않는다', () => {
    installNotification('default');

    expect(showBrowserNotification({ title: '제목', body: '본문' })).toBe(false);
    expect(constructed).toHaveLength(0);
  });

  it('Notification API 가 없는 환경에서는 조용히 false 를 돌려준다', () => {
    installNotification(null);

    expect(isBrowserNotificationSupported()).toBe(false);
    // 미지원은 "거부"와 다르다. 그 차이를 타입으로 남긴다.
    expect(getBrowserNotificationPermission()).toBeNull();
    expect(showBrowserNotification({ title: '제목', body: '본문' })).toBe(false);
  });

  it('생성자가 던지는 브라우저에서도 예외를 밖으로 내보내지 않는다', () => {
    // 모바일 Chrome 은 Service Worker 없이 new Notification 을 부르면 던진다.
    // 여기서 예외가 새면 알림 조회 전체가 실패로 끝나 앱 내 목록까지 갱신되지 않는다.
    installNotification('granted', true);
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(showBrowserNotification({ title: '제목', body: '본문' })).toBe(false);
    warn.mockRestore();
  });
});
