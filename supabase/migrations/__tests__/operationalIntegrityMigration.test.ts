import fs from 'fs';
import path from 'path';

const migrationPath = path.join(
  process.cwd(),
  'supabase/migrations/20260715170000_oee_completeness_and_alert_acknowledgements.sql'
);

describe('OEE completeness and alert acknowledgement migration', () => {
  it('exists as a migration artifact without requiring live database application', () => {
    expect(fs.existsSync(migrationPath)).toBe(true);
  });

  it('persists per-user alert acknowledgement with constrained actions and indexed ownership', () => {
    if (!fs.existsSync(migrationPath)) return;
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/create table if not exists public\.alert_acknowledgements/i);
    expect(sql).toMatch(/unique\s*\(alert_key,\s*user_id\)/i);
    expect(sql).toMatch(/check\s*\(action in \('acknowledge', 'dismiss'\)\)/i);
    expect(sql).toMatch(/create index if not exists alert_acknowledgements_user_id_idx/i);
    expect(sql).toMatch(/enable row level security/i);
  });

  it('requires runtime and a process standard in addition to downtime before OEE is reported', () => {
    if (!fs.existsSync(migrationPath)) return;
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/downtime_minutes\s+is\s+not\s+null[\s\S]+planned_runtime\s+is\s+not\s+null[\s\S]+actual_runtime\s+is\s+not\s+null[\s\S]+ideal_runtime\s+is\s+not\s+null/i);
    expect(sql).toContain("'reporting_coverage'");
    expect(sql).toMatch(/unreported_records\s+bigint/i);
    expect(sql).toMatch(/sum\(output_qty\) filter \(where oee_reported and not invalid\)[\s\S]*reported_output_qty/i);
    expect(sql).toMatch(/from base\s*\n\), machine_shift/i);
  });

  it('keeps invalid legacy rows visible in overall, machine, shift, and daily coverage', () => {
    if (!fs.existsSync(migrationPath)) return;
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/count\(\*\)\s+filter\s*\(where invalid\)::bigint\s+as invalid_records/i);
    expect((sql.match(/invalid_records/g) || []).length).toBeGreaterThanOrEqual(5);
    expect(sql).not.toMatch(/where pr\.date >= p_start_date[\s\S]{0,500}and not \(coalesce\(pr\.output_qty/i);
  });

  it('returns NULL OEE metrics when a group has no complete reported rows', () => {
    if (!fs.existsSync(migrationPath)) return;
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).not.toMatch(/COALESCE\(availability,\s*0\)/i);
    expect(sql).not.toMatch(/COALESCE\(performance,\s*0\)/i);
    expect(sql).not.toMatch(/COALESCE\(quality,\s*0\)/i);
    expect(sql).toMatch(/reported_records[\s\S]+impossible_records/i);
  });

  it('keeps confirmed zero-production shifts as real zero OEE samples', () => {
    if (!fs.existsSync(migrationPath)) return;
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect((sql.match(/when reported_records = 0/gi) || []).length).toBeGreaterThanOrEqual(6);
    expect(sql).toMatch(/when metric_actual = 0 then 0::float8/i);
    expect(sql).toMatch(/when metric_output = 0 then 0::float8/i);
    expect(sql).toMatch(/machine_shift_metrics[\s\S]+when actual_runtime = 0 then 0::float8[\s\S]+when output_qty = 0 then 0::float8/i);
    expect(sql).toMatch(/filter \(where oee is not null\)/i);
  });

  it('separates negative quantities and defects above output as invalid data', () => {
    if (!fs.existsSync(migrationPath)) return;
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/coalesce\(pr\.actual_runtime, 0\) < 0/i);
    expect(sql).toMatch(/coalesce\(pr\.output_qty, 0\) < 0/i);
    expect(sql).toMatch(/coalesce\(pr\.defect_qty, 0\) < 0/i);
    expect(sql).toMatch(/coalesce\(pr\.defect_qty, 0\) > coalesce\(pr\.output_qty, 0\)/i);
  });

  it('keeps invalid rows in coverage but excludes their quantities from every production total', () => {
    if (!fs.existsSync(migrationPath)) return;
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/count\(\*\) filter \(where invalid\)::bigint as invalid_records/i);
    expect(sql).toMatch(/sum\(output_qty\) filter \(where not invalid\)[\s\S]{0,80}as total_output_qty/i);
    expect(sql).toMatch(/sum\(defect_qty\) filter \(where not invalid\)[\s\S]{0,80}as total_defect_qty/i);
    expect(sql).toMatch(/sum\(b\.output_qty\) filter \(where not b\.invalid\)[\s\S]{0,80}as total_output/i);
    expect(sql).toMatch(/sum\(b\.defect_qty\) filter \(where not b\.invalid\)[\s\S]{0,80}as total_defect_qty/i);
    expect((sql.match(/sum\(output_qty - defect_qty\) filter \(where not invalid\)/gi) || []).length).toBeGreaterThanOrEqual(2);
    expect((sql.match(/sum\(output_qty\) filter \(where not invalid\)/gi) || []).length).toBeGreaterThanOrEqual(4);
    expect((sql.match(/sum\(defect_qty\) filter \(where not invalid\)/gi) || []).length).toBeGreaterThanOrEqual(4);
  });

  it('keeps security-definer analytics callable only by the server role', () => {
    if (!fs.existsSync(migrationPath)) return;
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/revoke all on function public\.analytics_oee_by_machine[\s\S]*from public, anon, authenticated;/i);
    expect(sql).toMatch(/grant execute on function public\.analytics_oee_by_machine[\s\S]*to service_role;/i);
    expect(sql).not.toMatch(/to service_role, authenticated/i);
  });

  it('replaces the daily aggregation fallback with weighted runtime and output totals', () => {
    if (!fs.existsSync(migrationPath)) return;
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/analytics_oee_daily/i);
    expect(sql).toMatch(/total_ideal_runtime/i);
    expect(sql).toMatch(/reported_records/i);
    expect(sql).not.toMatch(/then 480/i);
  });
});
