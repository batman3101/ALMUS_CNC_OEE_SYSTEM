/**
 * `/api/machines` 는 **읽기 전용**이다.
 *
 * ## 무엇이 있었나
 *
 * 이 파일은 원래 `DELETE /api/machines`(설비 일괄 비활성화)를 검사했다. 그 핸들러는
 * 2026-08-24 에 제거됐다 — 어느 화면도 부르지 않는데 공장을 묻지 않는 통로였기 때문이다:
 *
 *   await requireUser(request, ['admin', 'engineer']);   // 공장을 묻지 않는다
 *   supabaseAdmin.from('machines')                       // Service Role = RLS 우회
 *     .update({ is_active: false })
 *     .in('id', machineIds);                             // factory_id 조건 없음
 *
 * ALV 의 engineer 가 ALT 설비 ID 만 알면 ALT 설비 800대를 비활성화할 수 있었다.
 * 같은 파일의 POST 도 `factory_id` 를 넣지 않아 NOT NULL 로 실패했고, 설비명 중복 검사가
 * 공장을 보지 않아 두 공장이 같은 이름을 쓰는 순간 `.single()` 이 "2행"으로 터졌다.
 *
 * ## 왜 삭제 대신 이 검사를 남기는가
 *
 * 삭제만 하면 다음 사람이 "설비 삭제 API 가 없네" 하고 **같은 자리에 같은 것을 다시 만든다.**
 * 그때 공장 인지를 빠뜨릴 이유는 처음과 똑같이 남아 있다. 그래서 자리 자체를 지킨다.
 *
 * 이 결함은 `factoryScopedRoutes` 원장이 **파일 단위**로 판정해서 숨어 있었다 — 같은 파일의
 * GET 이 전환돼 있으면 파일 전체가 "전환됨"으로 세어졌다. 그 원장은 핸들러 단위로 고쳤고
 * (`factoryScopedRoutes.test.ts`), 이 검사는 그것과 별개로 이 경로 하나를 못 박는다.
 */
// route.ts 는 `next/server` 를 import 한다. 그 모듈은 전역 `Request` 를 요구하는데 jsdom
// 환경에는 없어서, 모듈을 불러오는 것만으로 ReferenceError 가 난다. 여기서 필요한 것은
// **어떤 핸들러가 export 되는가**뿐이므로 최소한으로 대체한다.
jest.mock('next/server', () => ({
  NextResponse: { json: (body: unknown) => ({ json: async () => body }) },
}));

// Supabase Admin 은 import 시점에 환경변수를 검증하고 없으면 throw 한다. 이 검사는 핸들러를
// 실행하지 않으므로 클라이언트가 실제로 동작할 필요가 없다.
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: {} }));

import * as machinesRoute from '../route';

describe('/api/machines 는 읽기 전용이다', () => {
  it('GET 만 내보낸다', () => {
    const handlers = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].filter(
      method => typeof (machinesRoute as Record<string, unknown>)[method] === 'function'
    );

    // POST/DELETE 가 여기 다시 나타났다면, 그것을 만든 사람이 공장 인지를 넣었는지
    // 확인해야 한다. 설비 등록·비활성화는 이미 공장 인지로 전환된 `admin/machines` 계열이
    // 맡는다 — 통로를 늘리기 전에 그쪽을 먼저 보라.
    expect(handlers).toEqual(['GET']);
  });
});
