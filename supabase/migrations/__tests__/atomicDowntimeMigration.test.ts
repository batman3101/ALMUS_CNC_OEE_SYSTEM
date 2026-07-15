import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260715120000_atomic_downtime_save.sql'
);

describe('atomic production and downtime migration', () => {
  const readMigration = (): string => readFileSync(migrationPath, 'utf8');

  test('provides a separate backwards-compatible atomic save RPC', () => {
    const sql = readMigration();

    expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.save_daily_production_with_downtime/i);
    expect(sql).toContain('p_day_downtime_entries jsonb DEFAULT NULL::jsonb');
    expect(sql).toContain('p_night_downtime_entries jsonb DEFAULT NULL::jsonb');
    expect(sql).toMatch(/public\.save_daily_production\s*\(/i);
    expect(sql).toContain("jsonb_typeof(v_entries) <> 'array'");
  });

  test('replaces downtime only after production save inside the same function', () => {
    const sql = readMigration();
    const productionSave = sql.indexOf('public.save_daily_production(');
    const downtimeDelete = sql.indexOf('DELETE FROM public.downtime_entries');
    const downtimeInsert = sql.indexOf('INSERT INTO public.downtime_entries');

    expect(productionSave).toBeGreaterThan(-1);
    expect(downtimeDelete).toBeGreaterThan(productionSave);
    expect(downtimeInsert).toBeGreaterThan(downtimeDelete);
    expect(sql).toMatch(/IF\s+v_entries\s+IS\s+NULL\s+THEN\s+CONTINUE/i);
  });

  test('rejects orphan and overlapping downtime at the database boundary', () => {
    const sql = readMigration();

    expect(sql).toContain("ERRCODE = '23503'");
    expect(sql).toContain("ERRCODE = '23P01'");
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+validate_downtime_entry_before_write/i);
    expect(sql).toMatch(/existing\.machine_id\s*=\s*NEW\.machine_id/i);
    expect(sql).toMatch(/existing\.date\s*=\s*NEW\.date/i);
    expect(sql).toMatch(/existing\.shift\s*=\s*NEW\.shift/i);
    expect(sql).toMatch(/tstzrange\([\s\S]+&&\s*tstzrange\(/i);
  });

  test('derives ownership fields and duration on the server', () => {
    const sql = readMigration();

    expect(sql).toMatch(/p_machine_id,\s*p_date,\s*v_shift/i);
    expect(sql).toMatch(/EXTRACT\s*\(\s*EPOCH\s+FROM\s*\(v_end_time\s*-\s*v_start_time\)\s*\)/i);
    expect(sql).toContain("NULLIF(v_item ->> 'operator_id', '')::uuid");
  });
});
