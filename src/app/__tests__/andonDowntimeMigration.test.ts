import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260718000003_toggle_machine_downtime.sql'), 'utf8');

describe('toggle_machine_downtime RPC 계약', () => {
  it('설비별 advisory lock 으로 직렬화', () => expect(sql).toMatch(/pg_advisory_xact_lock/));
  it('machine_logs 와 downtime_entries 를 함께 기록', () => {
    expect(sql).toMatch(/machine_logs/i);
    expect(sql).toMatch(/downtime_entries/i);
  });
  it("start 와 resume 두 동작을 분기", () => {
    expect(sql).toMatch(/'start'/);
    expect(sql).toMatch(/'resume'/);
  });
  it('current_state 를 machine_status 로 캐스트한다', () => {
    expect(sql).toMatch(/::machine_status/);
  });
  it('downtime_entries.date(NOT NULL)를 p_date 로 넣는다', () => {
    expect(sql).toMatch(/insert into public\.downtime_entries[\s\S]*date[\s\S]*p_date/i);
  });
  it('service_role 에만 EXECUTE', () => {
    expect(sql).toMatch(/grant\s+execute[\s\S]*to\s+service_role/i);
    expect(sql).toMatch(/revoke\s+all[\s\S]*anon,\s*authenticated/i);
  });
});
