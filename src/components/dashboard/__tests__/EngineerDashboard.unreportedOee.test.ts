import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('EngineerDashboard unavailable OEE contract', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/components/dashboard/EngineerDashboard.tsx'),
    'utf8'
  );

  it('does not grade or render unreported machines as 0% OEE', () => {
    expect(source).toMatch(/reported_records\s*>\s*0/);
    expect(source).toMatch(/avg_oee\s*!==\s*null/);
    expect(source).toMatch(/oeeUnavailable/);
    expect(source).not.toMatch(/const hasData = Boolean\(stat && stat\.total_records > 0\)/);
  });
});
