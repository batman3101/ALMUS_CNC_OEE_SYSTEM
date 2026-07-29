/**
 * 어떤 시각으로부터 지금까지 흐른 분. **음수가 되지 않는다.**
 *
 * 왜 클램프가 필요한가 — 시작 시각은 **서버**가 찍고(`now()`), 경과는 **브라우저** 시계로
 * 잰다. 두 시계는 보통 몇 초씩 어긋나 있다. 브라우저가 서버보다 조금 느리면 상태가 막 바뀐
 * 직후의 `now - start` 가 음수가 되고, 그때 `Math.floor` 는 0 이 아니라 **-1** 을 준다
 * (예: -0.97초 → -0.016분 → floor → -1). 화면에는 "지속 시간: -1분" 이 뜬다.
 *
 * 2026-07-29 브라우저 테스트에서 실제로 재현했다. 운영자 콘솔에서 비가동을 재개한 직후
 * 설비 카드가 "-1분" 을 보여줬고(브라우저 시계가 DB 보다 약 1초 느렸다), 1초 뒤 0분으로
 * 스스로 고쳐졌다. 잠깐이지만 명백히 틀린 숫자다.
 *
 * 이 규칙이 이미 `DowntimeBreakdownCard` 에는 있었고 `OperatorDashboard` 에는 없었다.
 * 같은 규칙이 두 곳에 흩어져 한쪽만 맞는 상태였으므로 한 곳으로 모은다.
 */
export function elapsedMinutesSince(startedAt: string | number | Date, nowMs: number): number {
  const start = startedAt instanceof Date
    ? startedAt.getTime()
    : typeof startedAt === 'number'
      ? startedAt
      : Date.parse(startedAt);

  // 파싱 실패(Invalid Date)는 0 으로 접는다 — NaN 을 화면까지 흘리지 않는다.
  if (!Number.isFinite(start)) return 0;

  return Math.max(0, Math.floor((nowMs - start) / 60_000));
}
