import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260718000004_toggle_machine_downtime_idempotent.sql'), 'utf8');

// F6(감사): andon start/resume 중복 호출이 유령 구간을 만들지 않게 current_state 기반 멱등 가드.
// 운영 적용된 000003 을 create-or-replace 로 대체한다(적용은 사용자 명시 지시 대기).
describe('toggle_machine_downtime 멱등성(F6)', () => {
  it('create or replace 로 000003 RPC 를 대체한다', () =>
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.toggle_machine_downtime/i));
  it('current_state 를 읽어 분기 판단한다', () =>
    expect(sql).toMatch(/current_state[\s\S]*into\s+v_state/i));
  it('start: 이미 같은 사유로 비가동 중이면 no-op(구간을 새로 열지 않음)', () =>
    expect(sql).toMatch(/v_state\s*=\s*p_reason[\s\S]*?noop/i));
  it('resume: 이미 NORMAL 이면 no-op', () =>
    expect(sql).toMatch(/v_state\s*=\s*'NORMAL_OPERATION'[\s\S]*?noop/i));
  it('advisory lock 으로 여전히 직렬화한다', () =>
    expect(sql).toMatch(/pg_advisory_xact_lock/));
  it('service_role 에만 EXECUTE 유지', () => {
    expect(sql).toMatch(/grant\s+execute[\s\S]*to\s+service_role/i);
    expect(sql).toMatch(/revoke\s+all[\s\S]*anon,\s*authenticated/i);
  });
});
