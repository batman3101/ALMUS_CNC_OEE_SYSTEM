/**
 * 여러 구독이 **모두** 준비될 때까지 기다리는 일회용 게이트.
 *
 * ## 왜 필요한가 (적대적 재감사 2026-07-29 #8)
 *
 * `useRealtimeData` 는 담당 설비가 확정되면 구독을 열고 **곧바로** 스냅샷을 조회했다.
 * 그런데 `channel.subscribe()` 는 비동기다 — 실제 준비 완료는 나중에 `SUBSCRIBED` 콜백으로
 * 온다. 그 사이(스냅샷이 DB 를 읽은 뒤 ~ 구독이 실제로 열리기 전)에 커밋된 변경은
 * **어디에도 나타나지 않는다.** 스냅샷은 그 변경 이전을 읽었고, 구독은 아직 안 열려서
 * 이벤트를 받지 못한다. 사용자는 다음 새로고침(또는 다음 이벤트)까지 낡은 화면을 본다.
 *
 * ## 왜 기존 버퍼로는 못 막나 — 두 창은 다른 창이다
 *
 * 같은 훅에 이미 `pendingRealtimeUpdatesRef` 버퍼가 있다. 그건 "**전달은 됐는데** 스냅샷이
 * 아직 적용 안 된" 이벤트를 모아 뒀다가 스냅샷 교체와 같은 갱신에서 재생한다.
 * 여기서 문제 삼는 창은 그 앞이다 — 이벤트가 **전달 자체가 안 된다.** 보존할 것이 없으니
 * 버퍼가 아무리 완벽해도 소용이 없다. 순서를 바꿔 창을 없애는 수밖에 없다.
 *
 * 두 장치는 겹치지 않고 이어 붙는다:
 *   [구독 준비 전] ← 이 게이트가 스냅샷을 미뤄서 없앤다
 *   [준비 후 ~ 스냅샷 적용 전] ← 버퍼가 모았다가 재생한다
 *
 * ## 왜 타임아웃이 있나
 *
 * Realtime 이 죽어 있으면 `SUBSCRIBED` 가 영영 오지 않는다. 그때 스냅샷을 무한정 미루면
 * 화면이 빈 채로 멈춘다 — 몇 초 낡은 데이터보다 훨씬 나쁘다. 그래서 기다리되 포기한다.
 * 포기해도 잃는 것은 **원래 있던 그 창**뿐이고, 재연결 로직이 뒤이어 다시 로드한다.
 */
export interface ReadinessGate {
  /** 구독 하나가 준비됨. `expected` 만큼 모이면 게이트가 열린다. */
  markReady(): void;
  /** 게이트가 열리거나 타임아웃될 때까지 기다린다. 여러 번 불러도 같은 약속을 준다. */
  wait(): Promise<'ready' | 'timeout'>;
  /** 더 기다릴 이유가 없어졌을 때(정리·재구독) 즉시 풀어 준다 — 대기 중인 로드가 멈추지 않게. */
  cancel(): void;
}

export function createReadinessGate(expected: number, timeoutMs: number): ReadinessGate {
  let remaining = Math.max(0, expected);
  let settled = remaining === 0;
  let resolveFn: ((outcome: 'ready' | 'timeout') => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  // 기다릴 구독이 없으면(예: Supabase 미설정으로 채널을 하나도 열지 않는 경우) 즉시 통과한다.
  const promise: Promise<'ready' | 'timeout'> = settled
    ? Promise.resolve('ready')
    : new Promise(resolve => { resolveFn = resolve; });

  const settle = (outcome: 'ready' | 'timeout') => {
    if (settled) return;
    settled = true;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    resolveFn?.(outcome);
  };

  return {
    markReady() {
      if (settled) return;
      remaining -= 1;
      if (remaining <= 0) settle('ready');
    },
    wait() {
      // 타이머는 **기다리는 사람이 생겼을 때** 건다. 아무도 기다리지 않는 게이트가
      // 타이머를 붙잡고 있으면 테스트에서 열린 핸들로 남고, 운영에서도 의미가 없다.
      if (!settled && timer === null) {
        timer = setTimeout(() => settle('timeout'), timeoutMs);
      }
      return promise;
    },
    cancel() {
      settle('timeout');
    },
  };
}
