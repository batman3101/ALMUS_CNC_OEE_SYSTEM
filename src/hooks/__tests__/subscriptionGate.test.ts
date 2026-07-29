import { createReadinessGate } from '../subscriptionGate';

/**
 * 적대적 재감사 2026-07-29 #8 회귀 검사.
 *
 * 구독이 준비되기 **전에** 스냅샷을 조회하면, 그 사이 커밋된 변경은 스냅샷에도 없고
 * 이벤트로도 오지 않아 통째로 사라진다. 이 게이트는 스냅샷을 SUBSCRIBED 이후로 미뤄
 * 그 창을 없앤다.
 *
 * 검사의 초점은 두 가지다: **모두** 모여야 열린다는 것과, 어떤 경우에도 **영원히 막히지
 * 않는다**는 것. 후자가 없으면 Realtime 장애가 곧 빈 화면이 된다.
 */
describe('createReadinessGate', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('기다릴 구독이 없으면 즉시 열린다', async () => {
    // Supabase 미설정 등으로 채널을 하나도 열지 않는 경우. 여기서 타임아웃을 기다리면
    // 데모 환경마다 3초씩 빈 화면이 뜬다.
    await expect(createReadinessGate(0, 3000).wait()).resolves.toBe('ready');
  });

  it('구독이 다 모여야 열린다 — 하나라도 남으면 기다린다', async () => {
    const gate = createReadinessGate(3, 3000);
    let settled: string | null = null;
    void gate.wait().then(v => { settled = v; });

    gate.markReady();
    gate.markReady();
    await Promise.resolve();
    expect(settled).toBeNull();

    gate.markReady();
    await Promise.resolve();
    expect(settled).toBe('ready');
  });

  it('타임아웃이 지나면 포기하고 진행한다 (빈 화면 방지)', async () => {
    const gate = createReadinessGate(2, 3000);
    const waiting = gate.wait();
    gate.markReady(); // 하나만 오고 나머지는 오지 않는 상황

    jest.advanceTimersByTime(3000);
    await expect(waiting).resolves.toBe('timeout');
  });

  it('타임아웃 직전에 준비되면 ready 다', async () => {
    const gate = createReadinessGate(1, 3000);
    const waiting = gate.wait();
    jest.advanceTimersByTime(2999);
    gate.markReady();
    await expect(waiting).resolves.toBe('ready');
  });

  it('열린 뒤의 늦은 markReady 는 결과를 바꾸지 않는다', async () => {
    const gate = createReadinessGate(1, 3000);
    const waiting = gate.wait();
    gate.markReady();
    gate.markReady(); // 이전 세대 콜백이 늦게 도착하는 경우
    await expect(waiting).resolves.toBe('ready');
  });

  it('cancel 은 대기를 즉시 풀어 준다 — 정리·재구독 시 로드가 매달리지 않게', async () => {
    const gate = createReadinessGate(3, 3000);
    const waiting = gate.wait();
    gate.cancel();
    await expect(waiting).resolves.toBe('timeout');
  });

  it('cancel 이후의 markReady 로 다시 열리지 않는다', async () => {
    const gate = createReadinessGate(1, 3000);
    const waiting = gate.wait();
    gate.cancel();
    gate.markReady();
    await expect(waiting).resolves.toBe('timeout');
  });

  it('wait 을 여러 번 불러도 같은 결과를 준다', async () => {
    const gate = createReadinessGate(1, 3000);
    const a = gate.wait();
    const b = gate.wait();
    gate.markReady();
    await expect(a).resolves.toBe('ready');
    await expect(b).resolves.toBe('ready');
  });

  it('아무도 기다리지 않으면 타이머를 걸지 않는다', () => {
    // 열린 핸들이 남으면 테스트가 끝나지 않고, 운영에서도 의미 없는 타이머다.
    createReadinessGate(2, 3000).markReady();
    expect(jest.getTimerCount()).toBe(0);
  });
});
