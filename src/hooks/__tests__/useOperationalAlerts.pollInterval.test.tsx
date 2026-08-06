/**
 * 운영 알림 폴링 주기가 `notification.alert_check_interval_seconds` 를 실제로 따르는가.
 *
 * 2026-08-06 감사: 라이브 설정은 120초인데 `useOperationalAlerts.ts` 에는 60초가 상수로
 * 박혀 있었다. 설정이 저장은 되는데 아무 일도 하지 않았다.
 *
 * 여기서는 "설정 훅이 불렸다"가 아니라 **fetch 가 그 주기로 실제 발생하는가**를 본다.
 */
import { act, renderHook } from '@testing-library/react';
import { useOperationalAlerts } from '@/hooks/useOperationalAlerts';

const authFetchMock = jest.fn();
jest.mock('@/lib/authFetch', () => ({
  authFetch: (...args: unknown[]) => authFetchMock(...args),
}));

// 설정 원장을 그대로 통과시켜 `useNotificationPreferences` → `resolveAlertPollIntervalMs`
// 경로가 실제로 돌게 한다. 새 훅을 통째로 모킹하면 정작 검증하려던 배선이 빠진다.
let notificationSettings = {
  email: false,
  browser: false,
  sound: false,
  checkInterval: 60 as unknown,
  emailAddress: '',
};

jest.mock('@/hooks/useSystemSettings', () => ({
  useSystemSettings: () => ({
    getNotificationSettings: () => notificationSettings,
  }),
}));

const okResponse = () => ({
  ok: true,
  status: 200,
  json: async () => ({ alerts: [] }),
});

describe('useOperationalAlerts 폴링 주기', () => {
  beforeEach(() => {
    authFetchMock.mockReset();
    authFetchMock.mockImplementation(async () => okResponse());
    notificationSettings = {
      email: false, browser: false, sound: false, checkInterval: 60, emailAddress: '',
    };
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const flush = async () => {
    await act(async () => {
      await Promise.resolve();
    });
  };

  const advance = async (ms: number) => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
      await Promise.resolve();
    });
  };

  it('설정이 120초면 120초 주기로 조회한다 (60초에는 아무 일도 없다)', async () => {
    notificationSettings.checkInterval = 120;

    renderHook(() => useOperationalAlerts());
    await flush();

    // 마운트 시 최초 1회.
    expect(authFetchMock).toHaveBeenCalledTimes(1);

    // 옛 하드코딩 주기. 여기서 늘어나면 설정이 여전히 무시되고 있다는 뜻이다.
    await advance(60_000);
    expect(authFetchMock).toHaveBeenCalledTimes(1);

    await advance(60_000);
    expect(authFetchMock).toHaveBeenCalledTimes(2);

    await advance(120_000);
    expect(authFetchMock).toHaveBeenCalledTimes(3);
  });

  it('설정이 런타임에 바뀌면 새 주기로 다시 걸고, 옛 타이머는 남지 않는다', async () => {
    notificationSettings.checkInterval = 120;

    const { rerender } = renderHook(() => useOperationalAlerts());
    await flush();
    expect(authFetchMock).toHaveBeenCalledTimes(1);

    // 관리자가 설정을 30초로 바꾸고, Realtime 으로 설정이 다시 읽혀 재렌더된다.
    notificationSettings = { ...notificationSettings, checkInterval: 30 };
    rerender();
    await flush();

    // 주기만 바뀐 것으로 즉시 재조회가 일어나면 설정 저장이 트래픽 스파이크가 된다.
    expect(authFetchMock).toHaveBeenCalledTimes(1);

    await advance(30_000);
    expect(authFetchMock).toHaveBeenCalledTimes(2);

    // 옛 120초 타이머가 살아 있었다면 여기(누적 120초)에서 한 번 더 튄다.
    // 30초 주기만 살아 있어야 하므로 90초를 더 흘려 정확히 3회가 추가돼야 한다.
    await advance(90_000);
    expect(authFetchMock).toHaveBeenCalledTimes(5);
  });

  it('설정이 0 이어도 0ms 타이머를 만들지 않는다', async () => {
    // 손상된 값이 그대로 setInterval 에 닿으면 API 를 상대로 한 바쁜 대기가 된다.
    notificationSettings.checkInterval = 0;

    renderHook(() => useOperationalAlerts());
    await flush();
    expect(authFetchMock).toHaveBeenCalledTimes(1);

    // 기본값(60초)으로 떨어진다.
    await advance(59_000);
    expect(authFetchMock).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(authFetchMock).toHaveBeenCalledTimes(2);
  });

  it('언마운트하면 타이머가 멈춘다', async () => {
    notificationSettings.checkInterval = 30;

    const { unmount } = renderHook(() => useOperationalAlerts());
    await flush();
    expect(authFetchMock).toHaveBeenCalledTimes(1);

    unmount();
    await advance(300_000);
    expect(authFetchMock).toHaveBeenCalledTimes(1);
  });
});
