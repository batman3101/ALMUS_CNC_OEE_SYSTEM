/**
 * save_daily_production_v2 (감사 2026-11-14 F-02) 의 계약을 정적으로 고정한다.
 * 실제 잠금 경합은 scripts/verify-daily-save-concurrency-local.mjs 가 진짜 Postgres 로 본다.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const sql = readFileSync(resolve(root, 'supabase/migrations/20261114100000_save_daily_production_v2.sql'), 'utf8');
const route = readFileSync(resolve(root, 'src/app/api/production-records/daily/route.ts'), 'utf8');
const recordRoute = readFileSync(resolve(root, 'src/app/api/production-records/[recordId]/route.ts'), 'utf8');

const body = sql.slice(sql.indexOf('create or replace function public.save_daily_production_v2('));

const columnsOf = (source: string, name: string) => {
  const match = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\]`));
  if (!match) throw new Error(`${name} not found`);
  return [...match[1].matchAll(/'([a-z_]+)'/g)].map(m => m[1]).sort();
};

describe('save_daily_production_v2 migration', () => {
  it('기존 v1 시그니처는 건드리지 않는다 (오버로드·DROP 창 금지)', () => {
    expect(sql).not.toMatch(/function public\.save_daily_production\(/i);
    expect(sql).not.toMatch(/drop function/i);
  });

  it('마감 경로와 같은 advisory lock 을 설비 → A → B 순서로 대조보다 먼저 잡는다', () => {
    const machine = body.indexOf("hashtextextended(p_machine_id::text, 0)");
    const shiftA = body.indexOf("p_date::text || 'A', 0)");
    const shiftB = body.indexOf("p_date::text || 'B', 0)");
    const firstCheck = body.indexOf('record_changed');
    expect(machine).toBeGreaterThan(0);
    expect(shiftA).toBeGreaterThan(machine);
    expect(shiftB).toBeGreaterThan(shiftA);
    expect(firstCheck).toBeGreaterThan(shiftB);
  });

  it('지문 컬럼은 라우트·[recordId] 의 CONCURRENCY_GUARD_COLUMNS 와 같은 집합이다 (좁은 지문 금지)', () => {
    const sqlColumns = [...body.matchAll(/v_row\.([a-z_]+)(?:::numeric)?\s+is distinct from \(v_exp ->> '([a-z_]+)'\)/g)]
      .map(m => {
        expect(m[1]).toBe(m[2]);
        return m[1];
      })
      .filter(c => c !== 'record_id')
      .sort();
    expect(sqlColumns).toEqual(columnsOf(route, 'EXPECTED_RECORD_COLUMNS'));
    expect(sqlColumns).toEqual(columnsOf(recordRoute, 'CONCURRENCY_GUARD_COLUMNS'));
    expect(body).toMatch(/v_row\.record_id::text is distinct from \(v_exp ->> 'record_id'\)/);
  });

  it('"기록 없음"을 본 화면은 그 사이 생긴 기록을 덮지 않는다', () => {
    expect(body).toMatch(/jsonb_typeof\(v_exp\) = 'null' then\s+if v_found then\s+return jsonb_build_object\('ok', false, 'reason', 'record_changed'/);
  });

  it('저장하는 교대는 잠금 아래에서 비가동 지문을 다시 계산해 대조한다', () => {
    expect(body).toMatch(/public\.downtime_window_digest\(\s*p_machine_id/);
    expect(body).toMatch(/'source_changed'/);
  });

  it('대조를 통과한 뒤에만 v1 으로 쓴다 (쓰기 규칙은 한 곳)', () => {
    const write = body.indexOf('public.save_daily_production(');
    expect(write).toBeGreaterThan(body.lastIndexOf("'source_changed'"));
    expect(body).not.toMatch(/insert into public\.production_records|delete from public\.production_records/i);
  });

  it('서비스 롤만 실행할 수 있다', () => {
    expect(sql).toMatch(/revoke all on function public\.save_daily_production_v2\([^)]*\)\s+from public, anon, authenticated;/);
    expect(sql).toMatch(/grant execute on function public\.save_daily_production_v2\([^)]*\)\s+to service_role;/);
  });

  it('라우트는 v2 만 부르고 v1 을 직접 부르지 않는다', () => {
    expect(route).toMatch(/rpc\(\s*'save_daily_production_v2'/);
    expect(route).not.toMatch(/rpc\(\s*'save_daily_production'\s*,/);
  });
});
