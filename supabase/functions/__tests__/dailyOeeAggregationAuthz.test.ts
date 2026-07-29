import fs from 'fs';
import path from 'path';

/**
 * Codex 감사 2026-07-29 #4 회귀 검사.
 *
 * `daily-oee-aggregation` 은 Deno Edge Function 이라 Jest 로 실행할 수 없다. 그래서
 * `machineStateLockProtocol.test.ts` 가 마이그레이션 SQL 에 하는 것과 같은 방식으로
 * **소스를 훑어 규약을 강제**한다. 실행 검증만큼 강하지는 않지만, 인가 블록이 통째로
 * 사라지거나 쓰기보다 뒤로 밀리는 회귀는 확실히 잡는다.
 *
 * 이 함수는 Service Role 로 production_records 를 UPDATE 한다. 호출자 검사가 없으면
 * 유효한 JWT 를 가진 아무 로그인 사용자나 임의 날짜를 지정해 호출할 수 있다.
 */

const SOURCE = fs.readFileSync(
  path.resolve(__dirname, '..', 'daily-oee-aggregation', 'index.ts'),
  'utf8'
);

describe('daily-oee-aggregation 호출자 인가', () => {
  it('소스를 실제로 읽는다 (탐지기 자체가 죽지 않았는지)', () => {
    // 경로가 틀리면 빈 문자열을 훑고 모든 단언이 조용히 통과할 수 있다.
    expect(SOURCE).toContain('serve(async (req)');
    expect(SOURCE.length).toBeGreaterThan(1000);
  });

  it('Authorization 헤더에서 토큰을 읽는다', () => {
    expect(SOURCE).toMatch(/req\.headers\.get\(\s*'Authorization'\s*\)/);
  });

  it('토큰이 없으면 401 로 거부한다', () => {
    expect(SOURCE).toMatch(/status:\s*401/);
  });

  it('관리자가 아니면 403 으로 거부한다', () => {
    expect(SOURCE).toMatch(/profile\.role\s*!==\s*'admin'/);
    expect(SOURCE).toMatch(/status:\s*403/);
  });

  it('비활성 계정은 역할이 admin 이어도 거부한다', () => {
    // apiAuth.requireUser 와 같은 규율 — 퇴사자 계정이 남아 있어도 통과하면 안 된다.
    expect(SOURCE).toMatch(/profile\.is_active\s*!==\s*true/);
  });

  it('pg_cron 의 service_role 호출은 통과시킨다', () => {
    // 이 분기가 없으면 정기 집계(08:30 / 20:30)가 통째로 죽는다 — service_role 토큰에는
    // 대응하는 user_profiles 행이 없기 때문이다.
    expect(SOURCE).toMatch(/service_role/);
    expect(SOURCE).toMatch(/callerRole\s*!==\s*'service_role'/);
  });

  it('인가 검사가 어떤 쓰기보다 먼저 온다', () => {
    // 순서가 뒤집히면 거부당한 호출자도 이미 DB 를 바꾼 뒤가 된다.
    const authzAt = SOURCE.indexOf("req.headers.get('Authorization')");
    const writeAt = SOURCE.indexOf('.update(');

    expect(authzAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(authzAt).toBeLessThan(writeAt);
  });

  it('인가 검사가 대상 데이터 조회보다도 먼저 온다', () => {
    // 거부할 호출자에게 행 개수 같은 정보를 흘리지 않는다.
    const authzAt = SOURCE.indexOf("req.headers.get('Authorization')");
    const readAt = SOURCE.indexOf("from('production_records')");

    expect(readAt).toBeGreaterThan(-1);
    expect(authzAt).toBeLessThan(readAt);
  });
});
