/**
 * `id in (...)` 필터를 안전한 크기로 자른다.
 *
 * ## 왜 필요한가 (2026-07-31 실측)
 *
 * PostgREST 는 필터를 **URL 쿼리스트링**으로 받는다. 그래서 `.in('id', ids)` 는 아이디
 * 개수만큼 URL 이 길어지고, 어느 지점부터 Supabase 게이트웨이가 PostgREST 에 닿기도 전에
 * 요청을 거절한다. 운영 프로젝트에서 이분 탐색으로 잰 경계:
 *
 *   650개 → URL 24,125자 → 200
 *   700개 → URL 25,975자 → 400 Bad Request
 *
 * 즉 한계는 URL 길이 약 24 KiB 다. 이 프로젝트의 운영자에게는 설비 **800대**가 배정돼
 * 있으므로 `id=in.(800개 UUID)` 는 약 30 KB 가 되어 **항상** 넘었다. 그 결과
 * `GET /api/machines` 가 운영자에게만 500 을 냈고(운영자 대시보드가 통째로 실패했다),
 * 로그에는 `{ message: 'Bad Request' }` 만 남았다.
 *
 * ## 이 오류를 알아보는 법
 *
 * 게이트웨이가 거절한 것이라 PostgREST 오류 모양이 아니다. **`code` 도 `details` 도 없이
 * `message: 'Bad Request'` 만 있으면** 쿼리 문법이 아니라 요청 크기를 의심할 것.
 *
 * ## 왜 상수가 아니라 함수인가
 *
 * "200개씩 잘라야 한다"를 사람이 기억하게 두면 다음에 추가되는 `.in()` 에서 또 터진다.
 * 이 프로젝트에서 실제로 그랬다 — Realtime 채널 필터에는 이미 같은 성격의 상한
 * (`REALTIME_FILTER_MAX_IDS`, useRealtimeData.ts)이 있었는데 REST 쪽에는 없었다.
 * 두 전송 방식의 한계가 다르므로 상수는 둘이지만, **"아이디 목록을 필터로 보낼 때는
 * 개수를 확인한다"** 는 규칙은 하나다.
 *
 * ## RLS 가 스코프를 거는 경로에서는 이 함수가 필요 없다
 *
 * 브라우저 클라이언트(anon/authenticated 키)는 `machines`·`machine_logs`·
 * `production_records` 의 `Scoped read` 정책이 이미 담당 설비로 좁혀 준다. 거기서
 * 클라이언트가 같은 필터를 다시 붙이면 방어가 두 겹이 되는 게 아니라 **URL 만 길어진다.**
 * 이 함수는 RLS 를 우회하는 서비스 롤 경로(= API 라우트)를 위한 것이다.
 */

/**
 * 한 요청에 실을 최대 아이디 수.
 *
 * 실측 경계(650~700)의 약 1/3 로 잡았다. 여유를 크게 둔 이유는 URL 길이가 아이디 개수만이
 * 아니라 **함께 실리는 select 절**에도 좌우되기 때문이다 — `/api/machines` 는 중첩 관계까지
 * 포함한 긴 select 를 쓰므로 같은 개수라도 경계가 더 낮다. 개수로 자르면서 길이 한계를
 * 지키려면 개수 쪽을 넉넉히 낮춰 두는 수밖에 없다.
 */
export const REST_IN_FILTER_MAX_IDS = 200;

/**
 * 아이디 목록을 요청 단위로 자른다. 빈 목록은 빈 배열을 돌려준다 —
 * 호출자가 `[]` 로 조회를 돌려 "필터 없음"과 헷갈리지 않게 하기 위함이다.
 *
 * 중복은 제거한다. 같은 아이디를 두 번 보내면 URL 만 길어지고, 청크가 나뉘면 결과에
 * 같은 행이 두 번 들어온다.
 */
export function chunkIdsForInFilter(
  ids: readonly string[],
  maxPerRequest: number = REST_IN_FILTER_MAX_IDS
): string[][] {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const size = Math.max(1, maxPerRequest);
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += size) {
    chunks.push(unique.slice(i, i + size));
  }
  return chunks;
}
