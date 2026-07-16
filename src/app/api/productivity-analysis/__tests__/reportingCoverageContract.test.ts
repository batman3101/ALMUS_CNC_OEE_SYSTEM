import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('productivity analysis reporting coverage contract', () => {
  const route = readFileSync(resolve(process.cwd(), 'src/app/api/productivity-analysis/route.ts'), 'utf8');
  const migration = readFileSync(
    resolve(process.cwd(), 'supabase/migrations/20260715170000_oee_completeness_and_alert_acknowledgements.sql'),
    'utf8'
  );

  it('keeps all production totals but uses only reported output for OEE quality', () => {
    expect(migration).toMatch(/sum\(output_qty\)[\s\S]+total_output_qty/i);
    expect(migration).toMatch(/sum\(output_qty\) FILTER \(WHERE oee_reported AND NOT invalid\)[\s\S]+reported_output_qty/i);
    expect(route).toMatch(/totalOutput:\s*reportedOutputQty/);
    expect(route).toMatch(/total_output_qty:\s*totalOutputQty/);
  });

  it('exposes total, reported, and unreported counts to dashboard callers', () => {
    expect(route).toMatch(/reporting_coverage:\s*\{/);
    expect(route).toMatch(/reporting_rate:/);
    expect(route).toMatch(/invalid_records/);
    expect(route).toMatch(/excluded_records/);
    expect(route).toMatch(/incomplete:\s*excludedRecords\s*>\s*0/);
  });
});
