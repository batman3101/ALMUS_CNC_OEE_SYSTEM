/**
 * NotificationContext - 로그인 후 설비 상태 변경이 알림에 반영되는가 (#8)
 *                       비정상 설비가 10대를 넘으면 나머지가 숨겨지는가 (#9)
 *
 * 이 경로는 로그인된 사용자(user.id)가 있어야만 실행되므로 브라우저에서 확인하지 못했다.
 * 대신 여기서 실제로 코드를 실행시켜 검증한다.
 *
 * (jest-dom 매처는 쓰지 않는다. tsconfig 에 타입이 등록돼 있지 않아 tsc 를 깨뜨린다)
 */
import React from 'react';
import { render, act, waitFor } from '@testing-library/react';
import { NotificationProvider, useNotifications } from '../NotificationContext';
import { fetchMachines } from '@/lib/machinesCache';
import { supabase } from '@/lib/supabase';
import type { Notification } from '@/types/notifications';

jest.mock('@/lib/machinesCache', () => ({
  fetchMachines: jest.fn(),
  invalidateMachinesCache: jest.fn()
}));

// Realtime 구독을 가로채, 서버가 보낸 변경 이벤트를 테스트가 직접 발사할 수 있게 한다.
let realtimeHandler: (() => void) | null = null;
const subscribeMock = jest.fn();
const unsubscribeMock = jest.fn();

jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: jest.fn(() => ({
      on: jest.fn((_event: string, _filter: unknown, handler: () => void) => {
        realtimeHandler = handler;
        return {
          subscribe: (...args: unknown[]) => {
            subscribeMock(...args);
            return { unsubscribe: unsubscribeMock };
          }
        };
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

const machine = (n: number, state: string) => ({
  id: `machine-${n}`,
  name: `CNC-${String(n).padStart(3, '0')}`,
  current_state: state
});

const mockMachines = (machines: ReturnType<typeof machine>[]) => {
  (fetchMachines as jest.Mock).mockResolvedValue(machines);
};

/** 현재 알림 목록을 테스트에서 직접 들여다보기 위한 프로브 */
const renderProvider = () => {
  const seen: { current: Notification[] } = { current: [] };

  const Probe: React.FC = () => {
    seen.current = useNotifications().notifications;
    return null;
  };

  const utils = render(
    <NotificationProvider>
      <Probe />
    </NotificationProvider>
  );

  return { ...utils, seen };
};

describe('NotificationContext', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    realtimeHandler = null;
    localStorage.clear();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('#9 비정상 설비가 10대를 넘어도 전부 알림으로 나온다 (이전: slice(0,10) 으로 잘림)', async () => {
    mockMachines([
      ...Array.from({ length: 12 }, (_, i) => machine(i + 1, 'BREAKDOWN_REPAIR')),
      machine(99, 'NORMAL_OPERATION')
    ]);

    const { seen } = renderProvider();

    await waitFor(() => expect(seen.current).toHaveLength(12));
  });

  it('#9 심각도가 높은 알림이 위로 온다', async () => {
    mockMachines([
      machine(1, 'INSPECTION'), // low
      machine(2, 'BREAKDOWN_REPAIR'), // critical
      machine(3, 'TEMPORARY_STOP') // high
    ]);

    const { seen } = renderProvider();

    await waitFor(() => expect(seen.current).toHaveLength(3));
    expect(seen.current.map(n => n.severity)).toEqual(['critical', 'high', 'low']);
  });

  it('#8 로그인 후 설비가 고장나면 Realtime 이벤트로 새 알림이 생긴다 (새로고침 없이)', async () => {
    mockMachines([machine(1, 'NORMAL_OPERATION')]);

    const { seen } = renderProvider();
    await waitFor(() => expect(seen.current).toHaveLength(0));

    // machines 테이블 구독이 실제로 걸렸는지 확인
    expect(supabase.channel).toHaveBeenCalledWith('notification-machine-changes');
    expect(subscribeMock).toHaveBeenCalled();
    expect(realtimeHandler).not.toBeNull();

    // 이제 설비가 고장났다고 서버가 알려온다
    mockMachines([machine(1, 'BREAKDOWN_REPAIR')]);

    jest.useFakeTimers();
    act(() => {
      realtimeHandler!();
      jest.advanceTimersByTime(1_000); // 디바운스
    });
    jest.useRealTimers();

    await waitFor(() => expect(seen.current).toHaveLength(1));
    expect(seen.current[0].machine_name).toBe('CNC-001');
  });

  it('#8 Realtime 이 죽어도 폴백 폴링(60초)이 상태 변경을 따라잡는다', async () => {
    // 폴링 interval 은 마운트 시점에 걸리므로, 렌더 전부터 가짜 타이머여야 한다
    jest.useFakeTimers();
    mockMachines([machine(1, 'NORMAL_OPERATION')]);

    const { seen } = renderProvider();
    await waitFor(() => expect(seen.current).toHaveLength(0));

    mockMachines([machine(1, 'BREAKDOWN_REPAIR')]);

    // Realtime 이벤트는 한 번도 발사하지 않는다. 오직 시간만 흐른다.
    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    await waitFor(() => expect(seen.current).toHaveLength(1));
  });

  it('언마운트 시 구독을 해제한다 (채널 누수 방지)', async () => {
    mockMachines([]);

    const { unmount } = renderProvider();
    await waitFor(() => expect(subscribeMock).toHaveBeenCalled());

    unmount();
    expect(unsubscribeMock).toHaveBeenCalled();
  });
});
