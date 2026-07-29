import { act, renderHook, waitFor } from '@testing-library/react';

// setupRealtimeSubscriptions() 는 NEXT_PUBLIC_SUPABASE_URL 이 없으면(또는 demo/자리표시자면)
// 구독 자체를 건너뛴다. next/jest 는 테스트 환경에서 .env.local 을 읽지 않으므로
// (system-settings/update route.test.ts 와 동일하게) 여기서 직접 채워준다.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';

type StatusCallback = (status: string, error?: unknown) => void;

// 실제 Supabase 채널을 흉내낸다: subscribe() 는 상태 콜백을 순서대로 쌓아 두고,
// unsubscribe() 는 "가장 최근에 연" 채널의 콜백을 CLOSED 로 발화시킨다 — 이것이
// cleanupChannels() 가 실제로 겪는 상황이다(자신이 방금 unsubscribe 한 채널의
// 상태 콜백이 CLOSED 로 불린다).
const subscribeCallbacks: StatusCallback[] = [];
const channel: { on: jest.Mock; subscribe: jest.Mock; unsubscribe: jest.Mock } = {
  on: jest.fn(),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
};
channel.on.mockImplementation(() => channel);
channel.subscribe.mockImplementation((cb: StatusCallback) => {
  subscribeCallbacks.push(cb);
  return channel;
});
channel.unsubscribe.mockImplementation(() => {
  const current = subscribeCallbacks[subscribeCallbacks.length - 1];
  current?.('CLOSED');
});

const machinesEq = jest.fn(() => Promise.resolve({ data: [], error: null }));
const machinesSelect = jest.fn(() => ({ eq: machinesEq }));
const fromMock = jest.fn((_table: string) => ({ select: machinesSelect }));

jest.mock('@/lib/supabase', () => ({
  supabase: {
    // 클로저로 감싸 참조한다 — jest.mock 팩토리는 이 파일의 import 가 호이스팅되며
    // fromMock 초기화보다 먼저 실행되므로, 값을 직접 대입하면 TDZ 에 걸린다.
    channel: jest.fn(() => channel),
    from: (table: string) => fromMock(table),
  },
}));
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));

import { useRealtimeData } from '../useRealtimeData';

// includeMachineLogs/includeProductionRecords 를 모두 꺼서 열리는 채널을 machines 채널
// 하나로 좁힌다 — 재연결 루프 자체를 검증하는 데 필요한 것은 그 하나뿐이다.
const renderMinimalHook = () =>
  renderHook(() =>
    useRealtimeData(undefined, undefined, {
      includeMachineLogs: false,
      includeProductionRecords: false,
    })
  );

describe('useRealtimeData: cleanupChannels 가 유발한 CLOSED 로 재연결이 재장전되는 루프', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    subscribeCallbacks.length = 0;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('우리가 정리한(이전 세대) 채널의 CLOSED 는 재연결을 재장전하지 않는다', async () => {
    const { result } = renderMinimalHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(subscribeCallbacks).toHaveLength(1); // 초기 구독 (1세대)

    // 진짜 네트워크 끊김 1회 — 재연결이 예약된다.
    await act(async () => {
      subscribeCallbacks[0]('CLOSED');
    });

    // 5초 후 재연결이 실행된다: loadInitialData → setupRealtimeSubscriptions.
    // setupRealtimeSubscriptions 는 cleanupChannels() 로 1세대 채널을 정리하는데,
    // 그 unsubscribe() 가 1세대 콜백을 다시 CLOSED 로 발화시킨다. 세대 가드가 없으면
    // 이 CLOSED 가 또 재연결을 예약해 무한 루프가 된다.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });

    // 재연결 1회 → 새 채널(2세대)이 정확히 하나 더 열렸다.
    expect(fromMock.mock.calls.length).toBe(2); // 초기 1회 + 재연결 1회
    expect(subscribeCallbacks).toHaveLength(2);

    // 세대 가드가 없다면 cleanup 이 유발한 CLOSED 가 방금 또 다른 재연결 타이머를
    // 예약했을 것이다. 5초를 더 흘려서 세 번째 재연결이 없는지 확인한다.
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });
    expect(fromMock.mock.calls.length).toBe(2);
    expect(subscribeCallbacks).toHaveLength(2);
  });

  it('현재 세대에서 온 진짜 CLOSED 는 여전히 재연결한다 (회복 경로 보존)', async () => {
    const { result } = renderMinimalHook();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fromMock.mock.calls.length).toBe(1);

    // 지금 열려 있는(유일한, 즉 현재 세대) 채널의 CLOSED — 실제 네트워크 끊김.
    await act(async () => {
      subscribeCallbacks[0]('CLOSED');
    });
    await act(async () => {
      await jest.advanceTimersByTimeAsync(5000);
    });

    // 재연결이 실행되어 데이터를 다시 불러오고 새 채널을 열었어야 한다.
    expect(fromMock.mock.calls.length).toBe(2);
    expect(subscribeCallbacks).toHaveLength(2);
  });
});
