import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260718000002_production_records_defect_nullable.sql'),
  'utf8',
);

describe('production_records.defect_qty NULL 허용 마이그레이션', () => {
  it('defect_qty 의 NOT NULL 을 제거한다', () => {
    expect(sql).toMatch(/alter table\s+public\.production_records\s+alter column\s+defect_qty\s+drop not null/i);
  });
  it('output_qty 등 다른 컬럼은 건드리지 않는다 (defect_qty 만)', () => {
    expect(sql).not.toMatch(/output_qty/i);
  });
});
