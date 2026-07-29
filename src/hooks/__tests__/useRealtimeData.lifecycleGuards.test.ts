import { act, renderHook, waitFor } from '@testing-library/react';

// setupRealtimeSubscriptions() 는 URL 이 없거나 자리표시자면 구독을 건너뛴다.
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';

type StatusCallback = (status: string, error?: unknown) => void;
type PayloadHandler = (payload: Record<string, unknown>) => void;

/**
 * 채널 생명주기 가드(재연결 스코프·로드 순번·payload 세대) 검증.
 *
 * reconnectLoop.test.ts 는 "정리가 유발한 CLOSED 가 재연결을 재장전하지 않는가" 하나만
 * 본다. 이 파일은 그 뒤 검수에서 나온 세 구멍을 각각 고정한다. mock 이 더 필요해서
 * (userId 경로 = user_profiles.single(), payload 핸들러 캡처, 지연 가능한 조회)
 * 파일을 나눴다.
 */

// ── Supabase 채널 mock ────────────────────────────────────────────────────
// on() 으로 등록된 payload 핸들러를 순서대로 보관한다. 세대 가드 검증에 필요하다 —
// "이전에 열렸던 채널의 핸들러"를 직접 불러야 하기 때문이다.
const payloadHandlers: PayloadHandler[] = [];
const subscribeCallbacks: StatusCallback[] = [];

const channel: { on: jest.Mock; subscribe: jest.Mock; unsubscribe: jest.Mock } = {
  on: jest.fn(),
  subscribe: jest.fn(),
  unsubscribe: jest.fn(),
};
channel.on.mockImplementation((_event, _config, handler: PayloadHandler) => {
  payloadHandlers.push(handler);
  return channel;
});
channel.subscribe.mockImplementation((cb: StatusCallback) => {
  subscribeCallbacks.push(cb);
  return channel;
});
// 실제 unsubscribe() 도 정리 대상 채널의 상태 콜백을 CLOSED 로 발화시킨다.
channel.unsubscribe.mockImplementation(() => {
  subscribeCallbacks[subscribeCallbacks.length - 1]?.('CLOSED');
});

// ── Supabase 쿼리 mock ────────────────────────────────────────────────────
// 어떤 체인이 와도 자기 자신을 돌려주고, await 되면 빈 결과를 준다.
// single() 은 user_profiles 조회 전용이라 따로 제어할 수 있게 뺀다.
const CHAIN_METHODS = ['select', 'eq', 'neq', 'not', 'is', 'in', 'gte', 'lt', 'or', 'order', 'range', 'limit'];

/** user_profiles.single() 이 반환할 프로미스를 테스트가 갈아끼울 수 있게 한다. */
let nextProfileResult: () => Promise<{ data: unknown; error: unknown }> =
  () => Promise.resolve({ data: null, error: null });

/** eq('user_id', X) 로 전달된 값을 기록한다 — 재연결이 어느 사용자로 조회했는지 확인용. */
const profileUserIds: unknown[] = [];

const makeQuery = () => {
  const q: Record<string, unknown> = {};
  for (const method of CHAIN_METHODS) {
    q[method] = jest.fn((...args: unknown[]) => {
      if (method === 'eq' && args[0] === 'user_id') profileUserIds.push(args[1]);
      return q;
    });
  }
  q.single = jest.fn(() => nextProfileResult());
  // await 가능하게 만든다. 종단 메서드가 무엇이든(range/order/...) 그대로 await 된다.
  q.then = (
    resolve: (v: { data: unknown[]; error: unknown }) => unknown,
    reject?: (e: unknown) => unknown,
  ) => Promise.resolve({ data: [], error: null }).then(resolve, reject);
  return q;
};

// 인자 타입을 명시한다 — jest.fn(() => …) 로 두면 "0개 인자" 로 추론돼 from(table) 호출이
// 타입 오류가 된다(reconnectLoop.test.ts 와 동일 이유).
const fromMock = jest.fn((_table: string) => makeQuery());

jest.mock('@/lib/supabase', () => ({
  supabase: {
    channel: jest.fn(() => channel),
    from: (table: string) => fromMock(table),
  },
}));
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));

import { useRealtimeData } from '../useRealtimeData';

const renderHookFor = (userId?: string, userRole?: string) =>
  renderHook(
    ({ id, role }: { id?: string; role?: string }) =>
      useRealtimeData(id, role as never, {
        includeMachineLogs: false,
        includeProductionRecords: false,
      }),
    { initialProps: { id: userId, role: userRole } }
  );

beforeEach(() => {
  jest.clearAllMocks();
  payloadHandlers.length = 0;
  subscribeCallbacks.length = 0;
  profileUserIds.length = 0;
  nextProfileResult = () => Promise.resolve({ data: null, error: null });
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

// ── R3 ────────────────────────────────────────────────────────────────────
describe('해제 중인 이전 세대 채널의 payload', () => {
  it('이전 세대 핸들러의 이벤트는 상태를 바꾸지 않고, 현재 세대는 반영한다', async () => {
    const { result } = renderHookFor();
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(payloadHandlers).toHaveLength(1); // 1세대

    // 재연결 1회 → 2세대 채널이 열린다(1세대는 cleanup 으로 해제됨).
    await act(async () => { subscribeCallbacks[0]('CLOSED'); });
    await act(async () => { await jest.advanceTimersByTimeAsync(5000); });
    expect(payloadHandlers).toHaveLength(2);

    const before = result.current.machines.length;

    // 실제 unsubscribe() 는 비동기다 — 해제 중인 1세대가 아직 이벤트를 흘릴 수 있다.
    await act(async () => {
      payloadHandlers[0]({
        eventType: 'INSERT',
        new: { id: 'stale-machine', name: 'STALE', is_active: true },
        old: {},
      });
    });
    expect(result.current.machines.length).toBe(before);
    expect(result.current.machines.some(m => m.id === 'stale-machine')).toBe(false);

    // 현재 세대(2세대)의 이벤트는 정상 반영되어야 한다 — 가드가 과하게 막으면 안 된다.
    await act(async () => {
      payloadHandlers[1]({
        eventType: 'INSERT',
        new: { id: 'live-machine', name: 'LIVE', is_active: true },
        old: {},
      });
    });
    expect(result.current.machines.some(m => m.id === 'live-machine')).toBe(true);
  });
});

// ── R1 ────────────────────────────────────────────────────────────────────
describe('재연결 시 사용자·역할 스코프', () => {
  it('사용자가 바뀐 뒤 재연결하면 이전 사용자가 아니라 새 사용자로 조회한다', async () => {
    nextProfileResult = () =>
      Promise.resolve({ data: { assigned_machines: [] }, error: null });

    const { result, rerender } = renderHookFor('user-old', 'operator');
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(profileUserIds).toEqual(['user-old']);

    // 로그인 사용자 전환 (admin→operator 등 역할 변경도 같은 경로).
    rerender({ id: 'user-new', role: 'operator' });
    await waitFor(() => expect(profileUserIds).toContain('user-new'));
    const afterRerender = profileUserIds.length;

    // 진짜 끊김 → 재연결. scheduleReconnect 의 타임아웃 클로저는 최초 렌더에 고정돼 있어,
    // ref 로 최신 함수를 읽지 않으면 여기서 'user-old' 로 다시 조회한다.
    await act(async () => { subscribeCallbacks[subscribeCallbacks.length - 1]('CLOSED'); });
    await act(async () => { await jest.advanceTimersByTimeAsync(5000); });

    expect(profileUserIds.length).toBeGreaterThan(afterRerender);
    expect(profileUserIds[profileUserIds.length - 1]).toBe('user-new');
  });
});

// ── R2 ────────────────────────────────────────────────────────────────────
describe('겹친 로드의 순번', () => {
  it('늦게 끝난 옛 로드는 채널을 다시 열지 않는다', async () => {
    // 첫 로드의 프로필 조회를 붙잡아 둔다.
    let releaseFirst: (() => void) | null = null;
    nextProfileResult = () =>
      new Promise(resolve => {
        releaseFirst = () => resolve({ data: { assigned_machines: [] }, error: null });
      });

    const { result } = renderHookFor('user-1', 'operator');
    await waitFor(() => expect(releaseFirst).not.toBeNull());
    // 아직 afterScopeResolved 전이라 채널이 열리지 않았다.
    expect(subscribeCallbacks).toHaveLength(0);

    // 더 새 로드를 시작한다 — 즉시 끝나는 프로필로 갈아끼운다.
    nextProfileResult = () =>
      Promise.resolve({ data: { assigned_machines: [] }, error: null });
    await act(async () => { result.current.refresh(); });
    await waitFor(() => expect(subscribeCallbacks.length).toBe(1));

    // 이제 붙잡아 둔 첫 로드를 풀어 준다. 순번 가드가 없으면 이 옛 로드가
    // afterScopeResolved 를 불러 채널을 한 번 더(이전 스코프로) 연다.
    await act(async () => {
      releaseFirst?.();
      await jest.advanceTimersByTimeAsync(0);
    });

    expect(subscribeCallbacks).toHaveLength(1);
  });
});
