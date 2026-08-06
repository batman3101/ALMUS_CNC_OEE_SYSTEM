/**
 * 알림 설정 3종이 **실제로 소비되는가** (2026-08-06 감사).
 *
 * 감사 결과 `alert_check_interval_seconds` / `browser_notifications_enabled` /
 * `sound_notifications_enabled` 는 저장은 되는데 아무 일도 하지 않았다. 라이브 값이 120초인데
 * 앱이 60초로 돈 것이 그 증거였다(기본값 우연 일치가 아니다).
 *
 * 그래서 여기서는 게터가 불렸는지가 아니라 **관측 가능한 결과**를 본다 —
 * 조회가 그 주기로 실제 발생하는가, `Notification` 이 실제로 생성되는가, 소리가 실제로
 * 시작되는가.
 */
import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { NotificationProvider, useNotifications } from '../NotificationContext';
import { fetchMachines } from '@/lib/machinesCache';
import { playNotificationSound } from '@/utils/notificationSound';

jest.mock('@/lib/machinesCache', () => ({
  fetchMachines: jest.fn(),
  invalidateMachinesCache: jest.fn()
}));

// 소리는 "시작됐는가"만 본다. 자동재생 차단 자체의 동작은
// src/utils/__tests__/notificationSound.test.ts 가 따로 고정한다.
jest.mock('@/utils/notificationSound', () => ({
  playNotificationSound: jest.fn(async () => true)
}));

let realtimeHandler: (() => void) | null = null;
const unsubscribeMock = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: jest.fn(() => ({
      on: jest.fn((_event: string, _filter: unknown, handler: () => void) => {
        realtimeHandler = handler;
        return { subscribe: () => ({ unsubscribe: unsubscribeMock }) };
      })
    }))
  }
}));

jest.mock('../AuthContext', () => ({
  useAuth: () => ({ user: { id: 'test-user-1' } })
}));

jest.mock('../LanguageContext', () => ({
  useLanguage: () => ({ t: (key: string) => key })
}));

jest.mock('@/components/notifications', () => ({
  showToast: jest.fn()
}));

// 설정 원장 → useNotificationPreferences → resolveAlertPollIntervalMs 경로를 실제로 태운다.
let notificationSettings: {
  email: boolean;
  browser: boolean;
  sound: boolean;
  checkInterval: unknown;
  emailAddress: string;
};

jest.mock('@/hooks/useSystemSettings', () => ({
  useSystemSettings: () => ({
    getNotificationSettings: () => notificationSettings
  })
}));

const scope = window as unknown as Record<string, unknown>;
let constructedNotifications: Array<{ title: string; options?: NotificationOptions }> = [];

/** jsdom 에는 Notification 이 없다. 권한 상태를 지정해 심는다. */
function installNotificationApi(permission: NotificationPermission | null) {
  if (permission === null) {
    delete scope.Notification;
    return;
  }
  const NotificationMock = function (this: unknown, title: string, options?: NotificationOptions) {
    constructedNotifications.push({ title, options });
  } as unknown as { permission: NotificationPermission };
  NotificationMock.permission = permission;
  scope.Notification = NotificationMock;
}

const machine = (n: number, state: string) => ({
  id: `machine-${n}`,
  name: `CNC-${String(n).padStart(3, '0')}`,
  current_state: state
});

const mockMachines = (machines: ReturnType<typeof machine>[]) => {
  (fetchMachines as jest.Mock).mockResolvedValue(machines);
};

const renderProvider = () => {
  const controls: { refresh: () => Promise<void> } = { refresh: async () => undefined };
  const seen = { count: 0 };

  const Probe: React.FC = () => {
    const context = useNotifications();
    seen.count = context.notifications.length;
    controls.refresh = context.refreshNotifications;
    return null;
  };

  // 매번 새 엘리먼트를 만든다. 같은 엘리먼트 객체를 rerender 에 다시 넘기면 React 는
  // 참조가 같다는 이유로 서브트리 렌더를 건너뛰고, 설정 변경이 전파되지 않는다.
  const makeTree = () => (
    <NotificationProvider>
      <Probe />
    </NotificationProvider>
  );

  const utils = render(makeTree());

  return {
    ...utils,
    controls,
    seen,
    /** 같은 Provider 인스턴스를 유지한 채 다시 렌더한다(설정 변경 전파 재현). */
    rerenderProvider: () => utils.rerender(makeTree())
  };
};

describe('NotificationContext 알림 설정 소비', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    realtimeHandler = null;
    constructedNotifications = [];
    localStorage.clear();
    notificationSettings = {
      email: false,
      browser: false,
      sound: false,
      checkInterval: 60,
      emailAddress: ''
    };
  });

  afterEach(() => {
    jest.useRealTimers();
    delete scope.Notification;
  });

  // ── 폴링 주기 ─────────────────────────────────────────────────────────────

  describe('폴링 주기', () => {
    const advance = async (ms: number) => {
      await act(async () => {
        jest.advanceTimersByTime(ms);
        await Promise.resolve();
      });
    };

    it('설정이 120초면 120초 주기로 조회한다 (60초에는 아무 일도 없다)', async () => {
      notificationSettings.checkInterval = 120;
      jest.useFakeTimers();
      mockMachines([machine(1, 'NORMAL_OPERATION')]);

      renderProvider();
      await act(async () => { await Promise.resolve(); });
      expect(fetchMachines).toHaveBeenCalledTimes(1); // 마운트 시 최초 1회

      // 옛 하드코딩 주기. 여기서 늘어나면 설정이 여전히 무시되고 있다는 뜻이다.
      await advance(60_000);
      expect(fetchMachines).toHaveBeenCalledTimes(1);

      await advance(60_000);
      expect(fetchMachines).toHaveBeenCalledTimes(2);
    });

    it('설정이 런타임에 바뀌면 새 주기로 다시 걸고, 옛 타이머는 남지 않는다', async () => {
      notificationSettings.checkInterval = 120;
      jest.useFakeTimers();
      mockMachines([machine(1, 'NORMAL_OPERATION')]);

      const { rerenderProvider } = renderProvider();
      await act(async () => { await Promise.resolve(); });
      expect(fetchMachines).toHaveBeenCalledTimes(1);

      // Realtime 으로 설정 변경 신호가 와서 설정이 다시 읽혔다.
      notificationSettings = { ...notificationSettings, checkInterval: 30 };
      await act(async () => {
        rerenderProvider();
        await Promise.resolve();
      });

      // 주기만 바뀐 것으로 즉시 재조회가 일어나면 설정 저장이 트래픽 스파이크가 된다.
      expect(fetchMachines).toHaveBeenCalledTimes(1);

      await advance(30_000);
      expect(fetchMachines).toHaveBeenCalledTimes(2);

      // 옛 120초 타이머가 살아 있었다면 누적 120초 지점에서 한 번 더 튄다.
      // 30초 주기 하나만 남아야 하므로 90초 동안 정확히 3회가 추가된다.
      await advance(90_000);
      expect(fetchMachines).toHaveBeenCalledTimes(5);
    });

    it('설정이 0 이어도 0ms 타이머를 만들지 않는다', async () => {
      notificationSettings.checkInterval = 0;
      jest.useFakeTimers();
      mockMachines([machine(1, 'NORMAL_OPERATION')]);

      renderProvider();
      await act(async () => { await Promise.resolve(); });
      expect(fetchMachines).toHaveBeenCalledTimes(1);

      await advance(59_000);
      expect(fetchMachines).toHaveBeenCalledTimes(1);
      await advance(1_000);
      expect(fetchMachines).toHaveBeenCalledTimes(2);
    });
  });

  // ── 브라우저 알림 ─────────────────────────────────────────────────────────

  describe('브라우저 알림', () => {
    /** 첫 조회는 기준선만 세운다. 새 고장을 만들어 두 번째 조회를 돌린다. */
    const raiseNewAlert = async () => {
      mockMachines([machine(1, 'NORMAL_OPERATION')]);
      const rendered = renderProvider();
      await waitFor(() => expect(rendered.seen.count).toBe(0));

      mockMachines([machine(1, 'BREAKDOWN_REPAIR')]);
      await act(async () => { await rendered.controls.refresh(); });
      await waitFor(() => expect(rendered.seen.count).toBe(1));
      return rendered;
    };

    it('설정이 꺼져 있으면 권한이 granted 여도 Notification 을 만들지 않는다', async () => {
      // 권한 상태와 앱 설정은 다른 것이다. 관리자가 껐으면 권한이 있어도 뜨지 않는다.
      installNotificationApi('granted');
      notificationSettings.browser = false;

      await raiseNewAlert();

      expect(constructedNotifications).toHaveLength(0);
    });

    it('설정이 켜져 있고 권한이 granted 면 새 알림을 띄운다', async () => {
      installNotificationApi('granted');
      notificationSettings.browser = true;

      await raiseNewAlert();

      expect(constructedNotifications).toHaveLength(1);
      // 문구는 기존 번역 키를 쓴다(테스트의 t 는 키를 그대로 돌려준다).
      expect(constructedNotifications[0].title).toBe('notifications.machineState.title');
      expect(constructedNotifications[0].options?.tag).toBe('machine-1_BREAKDOWN_REPAIR');
    });

    it('설정이 켜져 있어도 권한이 denied 면 띄우지 않는다 (버그가 아니다)', async () => {
      installNotificationApi('denied');
      notificationSettings.browser = true;

      await raiseNewAlert();

      expect(constructedNotifications).toHaveLength(0);
    });

    it('설정이 켜졌다는 이유로 권한을 요청하지 않는다', async () => {
      installNotificationApi('default');
      const requestPermission = jest.fn();
      (scope.Notification as unknown as { requestPermission: unknown }).requestPermission =
        requestPermission;
      notificationSettings.browser = true;

      await raiseNewAlert();

      expect(requestPermission).not.toHaveBeenCalled();
      expect(constructedNotifications).toHaveLength(0);
    });

    it('첫 조회는 기준선만 세운다 — 로그인 시 기존 고장을 한꺼번에 띄우지 않는다', async () => {
      installNotificationApi('granted');
      notificationSettings.browser = true;

      mockMachines([machine(1, 'BREAKDOWN_REPAIR'), machine(2, 'TEMPORARY_STOP')]);
      const { seen } = renderProvider();
      await waitFor(() => expect(seen.count).toBe(2));

      expect(constructedNotifications).toHaveLength(0);
    });

    it('같은 알림이 계속 조회돼도 다시 띄우지 않는다', async () => {
      installNotificationApi('granted');
      notificationSettings.browser = true;

      const { controls } = await raiseNewAlert();
      expect(constructedNotifications).toHaveLength(1);

      // 고장은 그대로다. 폴링은 매 주기 같은 목록을 돌려준다.
      await act(async () => { await controls.refresh(); });
      await act(async () => { await controls.refresh(); });

      expect(constructedNotifications).toHaveLength(1);
    });
  });

  // ── 소리 ─────────────────────────────────────────────────────────────────

  describe('알림음', () => {
    const raiseNewAlert = async () => {
      mockMachines([machine(1, 'NORMAL_OPERATION')]);
      const rendered = renderProvider();
      await waitFor(() => expect(rendered.seen.count).toBe(0));

      mockMachines([machine(1, 'BREAKDOWN_REPAIR')]);
      await act(async () => { await rendered.controls.refresh(); });
      await waitFor(() => expect(rendered.seen.count).toBe(1));
      return rendered;
    };

    it('설정이 꺼져 있으면 소리를 시작하지 않는다', async () => {
      notificationSettings.sound = false;

      await raiseNewAlert();

      expect(playNotificationSound).not.toHaveBeenCalled();
    });

    it('설정이 켜져 있으면 새 알림에 소리를 낸다', async () => {
      notificationSettings.sound = true;

      await raiseNewAlert();

      expect(playNotificationSound).toHaveBeenCalledTimes(1);
    });

    it('새 알림이 여러 건이어도 조회당 한 번만 울린다', async () => {
      notificationSettings.sound = true;

      mockMachines([machine(99, 'NORMAL_OPERATION')]);
      const { controls, seen } = renderProvider();
      await waitFor(() => expect(seen.count).toBe(0));

      mockMachines([
        machine(1, 'BREAKDOWN_REPAIR'),
        machine(2, 'BREAKDOWN_REPAIR'),
        machine(3, 'TEMPORARY_STOP')
      ]);
      await act(async () => { await controls.refresh(); });
      await waitFor(() => expect(seen.count).toBe(3));

      expect(playNotificationSound).toHaveBeenCalledTimes(1);
    });

    it('같은 알림이 계속 조회돼도 다시 울리지 않는다 (현장이 소리를 꺼 버리는 이유)', async () => {
      notificationSettings.sound = true;

      const { controls } = await raiseNewAlert();
      expect(playNotificationSound).toHaveBeenCalledTimes(1);

      await act(async () => { await controls.refresh(); });
      await act(async () => { await controls.refresh(); });

      expect(playNotificationSound).toHaveBeenCalledTimes(1);
    });

    it('Realtime 으로 들어온 새 고장에도 울린다', async () => {
      notificationSettings.sound = true;
      mockMachines([machine(1, 'NORMAL_OPERATION')]);

      const { seen } = renderProvider();
      await waitFor(() => expect(seen.count).toBe(0));
      expect(realtimeHandler).not.toBeNull();

      mockMachines([machine(1, 'BREAKDOWN_REPAIR')]);
      jest.useFakeTimers();
      await act(async () => {
        realtimeHandler!();
        jest.advanceTimersByTime(1_000); // 디바운스
      });
      jest.useRealTimers();

      await waitFor(() => expect(playNotificationSound).toHaveBeenCalledTimes(1));
    });
  });
});
