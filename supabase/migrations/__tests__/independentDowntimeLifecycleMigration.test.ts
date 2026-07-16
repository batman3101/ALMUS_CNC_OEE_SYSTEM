import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migrationPath = resolve(
  process.cwd(),
  'supabase/migrations/20260715160000_independent_downtime_lifecycle.sql'
);

describe('independent downtime lifecycle migration', () => {
  const readMigration = (): string => readFileSync(migrationPath, 'utf8');

  test('allows an event to stay open without a production record', () => {
    const sql = readMigration();

    expect(sql).toMatch(/ALTER\s+COLUMN\s+end_time\s+DROP\s+NOT\s+NULL/i);
    expect(sql).toMatch(/ALTER\s+COLUMN\s+duration_minutes\s+DROP\s+NOT\s+NULL/i);
    expect(sql).toMatch(/NEW\.end_time\s+IS\s+NOT\s+NULL[\s\S]+NEW\.end_time\s*<=\s*NEW\.start_time/i);

    const validator = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.validate_downtime_entry_write\(\)[\s\S]+?\$function\$;/i
    )?.[0] ?? '';
    expect(validator).not.toMatch(/FROM\s+public\.production_records/i);
    expect(validator).toMatch(/NEW\.duration_minutes\s*:=\s*NULL/i);
  });

  test('persists working, off, holiday, and missing shift states separately', () => {
    const sql = readMigration();

    expect(sql).toMatch(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+public\.production_shift_states/i);
    expect(sql).toMatch(/CHECK\s*\(\s*status\s+IN\s*\(\s*'WORKING'\s*,\s*'OFF'\s*,\s*'HOLIDAY'\s*,\s*'MISSING'\s*\)\s*\)/i);
    expect(sql).toMatch(/UNIQUE\s*\(\s*machine_id\s*,\s*date\s*,\s*shift\s*\)/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+sync_production_shift_state_after_write/i);
    expect(sql).toMatch(/AFTER\s+INSERT\s+OR\s+UPDATE\s+OR\s+DELETE\s+ON\s+public\.production_records/i);
  });

  test('uses ID-based writes with optimistic version checks', () => {
    const sql = readMigration();

    expect(sql).toMatch(/FUNCTION\s+public\.upsert_downtime_entry\s*\(/i);
    expect(sql).toMatch(/p_expected_version\s+bigint/i);
    expect(sql).toMatch(/WHERE\s+de\.id\s*=\s*p_id[\s\S]+de\.version\s*=\s*p_expected_version/i);
    expect(sql).toMatch(/FUNCTION\s+public\.delete_downtime_entry\s*\(/i);
    expect(sql).toMatch(/DELETE\s+FROM\s+public\.downtime_entries\s+de[\s\S]+de\.id\s*=\s*p_id[\s\S]+de\.version\s*=\s*p_expected_version/i);
    expect(sql).toContain("ERRCODE = '40001'");
    expect(sql).toMatch(/pg_advisory_xact_lock/i);
    expect(sql).toMatch(/idempotent retry/i);
    expect(sql).toMatch(/v_row\.end_time\s+IS\s+NOT\s+DISTINCT\s+FROM\s+p_end_time/i);
  });

  test('blocks new operational writes and closes open activity when a machine is deactivated', () => {
    const sql = readMigration();

    expect(sql).toMatch(/SELECT\s+m\.is_active\s+INTO\s+v_machine_active/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION\s+'MACHINE_INACTIVE'/i);
    expect(sql).toMatch(/CREATE\s+TRIGGER\s+zz_close_machine_activity_when_inactive/i);
    expect(sql).toMatch(/AFTER\s+UPDATE\s+OF\s+is_active\s*,\s*current_state/i);
    expect(sql).toMatch(/UPDATE\s+public\.machine_logs[\s\S]+end_time\s*=\s*v_now/i);
    expect(sql).toMatch(/UPDATE\s+public\.downtime_entries[\s\S]+end_time\s*=\s*v_now/i);
  });

  test('backfills open activity for machines that were already inactive before the trigger existed', () => {
    const sql = readMigration();

    expect(sql).toMatch(
      /UPDATE\s+public\.machine_logs\s+ml[\s\S]+FROM\s+public\.machines\s+m[\s\S]+NOT\s+m\.is_active[\s\S]+ml\.end_time\s+IS\s+NULL/i
    );
    expect(sql).toMatch(
      /UPDATE\s+public\.downtime_entries\s+de[\s\S]+FROM\s+public\.machines\s+m[\s\S]+NOT\s+m\.is_active[\s\S]+de\.end_time\s+IS\s+NULL/i
    );
  });

  test('production save, holiday, off-shift, and production deletion never delete downtime', () => {
    const sql = readMigration();
    const productionSave = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.save_daily_production\s*\([\s\S]+?\$function\$;/i
    )?.[0] ?? '';
    const productionDelete = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.delete_production_record\s*\([\s\S]+?\$function\$;/i
    )?.[0] ?? '';
    const compatibilitySave = sql.match(
      /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+public\.save_daily_production_with_downtime\s*\([\s\S]+?\$function\$;/i
    )?.[0] ?? '';

    expect(productionSave).not.toMatch(/DELETE\s+FROM\s+public\.downtime_entries/i);
    expect(productionDelete).not.toMatch(/DELETE\s+FROM\s+public\.downtime_entries/i);
    expect(compatibilitySave).not.toMatch(/DELETE\s+FROM\s+public\.downtime_entries/i);
    expect(compatibilitySave).not.toMatch(/INSERT\s+INTO\s+public\.downtime_entries/i);
    expect(compatibilitySave).toMatch(/public\.upsert_downtime_entry\s*\(/i);
    expect(compatibilitySave).toMatch(/independent_additive_compatibility/i);
  });
});
