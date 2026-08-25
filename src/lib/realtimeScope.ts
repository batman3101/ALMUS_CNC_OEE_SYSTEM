/**
 * Realtime 구독의 공장 범위 규칙 — **한 곳에만** 둔다.
 *
 * ## 이것은 보안 경계가 아니다
 *
 * 먼저 분명히 해 둔다. `postgres_changes` 이벤트는 Supabase Realtime 이 **구독자마다 RLS 를
 * 평가**해서 배달한다. RLS 컷오버(20260821160000)로 `machines`·`machine_logs`·
 * `production_records`·`system_settings` 전부 공장 범위 정책을 갖고 있으므로, 필터가 없어도
 * 다른 공장 행은 배달되지 않는다. **경계는 RLS 다.**
 *
 * 그러면 왜 필터를 거는가:
 *
 * 1. **팬아웃 절감.** 필터가 없으면 서버는 모든 공장의 모든 변경에 대해 이 구독의 RLS 를
 *    평가한 뒤 버린다. ALT 800대 + ALV 350대 체제에서 그 평가가 두 배가 된다. 필터를 걸면
 *    평가 이전에 걸러진다.
 * 2. **의도를 코드에 적어 둔다.** "왜 다른 공장 이벤트가 안 오는가"의 답이 RLS 정책 파일에만
 *    있으면, 다음 사람은 이 구독이 전역인 줄 알고 읽는다.
 *
 * 그러니 필터를 못 걸 때(공장 미확정) 구독을 막지는 않는다. 좁히지 못했을 뿐 경계는 그대로다.
 *
 * ## 필터는 하나만 걸 수 있다
 *
 * `postgres_changes` 의 `filter` 는 조건 **한 개**만 받는다. 그래서 담당 설비 필터와 공장
 * 필터를 함께 걸 수 없고, 둘 중 **더 좁은 쪽**을 고른다.
 *
 * 담당 설비 필터가 더 좁다 — 배정은 공장을 넘지 못한다(`user_machine_assignments` 의 복합
 * FK, `supabase/tests/factory_isolation.sql` 6번). 그래서 담당 필터가 있으면 그것을 쓴다.
 *
 * ## DELETE 는 필터에 걸리지 않는다
 *
 * DELETE 이벤트에는 replica identity(PK)만 실린다. 그래서 PK 가 아닌 컬럼(`factory_id`,
 * `machine_id`) 으로 필터를 걸면 DELETE 가 **통째로 걸러진다**. 이것은 이 파일이 만든 문제가
 * 아니라 기존 담당 설비 필터가 이미 갖고 있던 성질이고(useRealtimeData 주석), 삭제 반영은
 * 주기 새로고침이 맡는다. 공장 필터도 같은 규율을 따른다.
 */

/** 공장이 확정되지 않았을 때 채널 이름에 쓰는 표시. */
const UNSCOPED = 'unscoped';

/**
 * 채널 이름에 공장을 싣는다.
 *
 * 이름 자체는 보안과 무관하다(토픽 이름은 권한이 아니다). 그런데 두 공장이 같은 이름을 쓰면
 * 로그·디버깅에서 어느 공장의 구독인지 구분할 수 없고, 나중에 누가 같은 토픽으로
 * `broadcast` 를 붙이면 그때는 실제로 섞인다. 이름을 미리 갈라 둔다.
 *
 * 공장이 아직 확정되지 않았으면 `unscoped` 로 둔다 — 임의의 공장 코드를 지어내면 그 이름이
 * 거짓이 된다.
 */
export function factoryChannelName(base: string, factoryCode: string | null): string {
  return `${base}:${factoryCode ?? UNSCOPED}`;
}

/**
 * `factory_id` 서버 측 필터. 공장이 확정되지 않았으면 `undefined`(필터 없음).
 */
export function factoryEqFilter(factoryId: string | null): string | undefined {
  return factoryId ? `factory_id=eq.${factoryId}` : undefined;
}

/**
 * 실제로 걸 필터 하나를 고른다.
 *
 * 담당 설비 필터가 있으면 그것이 더 좁으므로 우선한다. 없으면 공장 필터, 둘 다 없으면
 * 필터 없음(전 범위 구독 + RLS).
 */
export function pickRealtimeFilter(
  machineFilter: string | undefined,
  factoryId: string | null,
): string | undefined {
  return machineFilter ?? factoryEqFilter(factoryId);
}

/** `postgres_changes` 설정에 그대로 펼쳐 넣을 수 있는 형태. */
export function realtimeFilterOption(
  machineFilter: string | undefined,
  factoryId: string | null,
): { filter: string } | Record<string, never> {
  const filter = pickRealtimeFilter(machineFilter, factoryId);
  return filter ? { filter } : {};
}

/**
 * ## broadcast 는 이야기가 다르다
 *
 * `postgres_changes` 는 RLS 를 타지만 `broadcast` 는 **타지 않는다.** 토픽에 붙은 모든
 * 클라이언트가 메시지를 받는다. 그래서 broadcast 에서는 토픽 이름이 곧 경계다 —
 * `system_settings_changes` 하나를 두 공장이 공유하면, ALV 의 설정 저장이 ALT 클라이언트를
 * 재조회시킨다(데이터가 새는 건 아니다. 재조회는 RLS 를 타므로. 다만 남의 공장 사건에
 * 반응한다).
 *
 * 보내는 쪽(`systemSettings.ts`)은 React 밖에 있어 Context 를 읽을 수 없다. 그래서 현재
 * 공장을 모듈 값으로 둔다.
 *
 * ## 왜 전역 가변 값이 여기서는 옳은가
 *
 * 한 페이지 로드에 공장은 **정확히 하나**다 — 공장 전환은 `location.replace` 로 전체 페이지를
 * 다시 열기 때문이다(FactorySwitcher). 그래서 이 값은 "한 번 정해지면 안 바뀌는 상수"이고,
 * 두 소비자가 서로 다른 값을 볼 수 있는 창이 없다.
 *
 * 확정 전에 저장이 일어나면 보내는 쪽과 듣는 쪽이 둘 다 `unscoped` 토픽을 쓰므로 여전히
 * 맞는다. 한쪽만 확정된 짧은 창에서는 **재조회를 놓칠** 수 있다 — 다음 화면 진입에서
 * 다시 읽으므로 오래된 값이 남을 뿐이고, 남의 공장 사건에 반응하는 것보다 낫다.
 */
let currentFactoryScope: string | null = null;

export function setCurrentFactoryScope(factoryCode: string | null): void {
  currentFactoryScope = factoryCode;
}

export function getCurrentFactoryScope(): string | null {
  return currentFactoryScope;
}
