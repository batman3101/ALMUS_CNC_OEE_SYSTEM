/**
 * 스냅샷 교체와 그동안 버퍼에 쌓인 실시간 이벤트를 하나의 상태로 합친다.
 *
 * 배경 — `useRealtimeData` 는 "조회↔구독 갭" 을 없애려고 구독을 스냅샷 조회보다 **먼저**
 * 연다. 그런데 스냅샷 적용은 `machines` / `machineLogs` / `productionRecords` 를 배열째
 * 교체하므로, 스냅샷이 도는 동안 도착해 이미 반영된 이벤트가 통째로 지워졌다
 * (Codex 감사 2026-07-29 #8). 구독을 먼저 여는 설계가 오히려 이 경로를 만들었다.
 *
 * 규칙은 하나다: **스냅샷을 먼저 깔고, 그 위에 버퍼를 도착 순서대로 재생한다.**
 * 훅 바깥의 순수 함수로 떼어낸 이유는 이 순서 규칙이 결함의 핵심이기 때문이다 —
 * React 렌더 타이밍을 흉내내지 않고 규칙만 직접 검증할 수 있다.
 */
export function replayBufferedUpdates<S>(
  snapshot: S,
  buffered: ReadonlyArray<(state: S) => S>
): S {
  return buffered.reduce((acc, apply) => apply(acc), snapshot);
}
