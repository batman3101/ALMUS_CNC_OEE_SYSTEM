import fs from 'fs';
import path from 'path';

describe('machine OEE route operational rules', () => {
  const source = fs.readFileSync(path.join(__dirname, '../route.ts'), 'utf8');

  it('does not invent a 480-minute runtime or derive downtime from missing values', () => {
    expect(source).not.toMatch(/\|\| 480/);
    expect(source).toMatch(/downtime_minutes:\s*record\.downtime_minutes/);
  });

  it('uses weighted period metrics and exposes reporting coverage', () => {
    expect(source).toMatch(/calculateWeightedOEE/);
    expect(source).toMatch(/unreported_records/);
    expect(source).not.toMatch(/reduce\(\(sum, data\) => sum \+ data\.oee, 0\) \/ totalRecords/);
  });

  it('protects service-role reads and does not fabricate an active cycle', () => {
    expect(source).toMatch(/requireUser\(request, \['admin', 'engineer', 'operator'\]\)/);
    expect(source).toMatch(/assertMachineAccess/);
    expect(source).toMatch(/current_cycle:\s*null/);
  });

  it('uses the configured business date instead of the server UTC calendar date', () => {
    expect(source).toMatch(/getBusinessDateAt/);
    expect(source).toMatch(/business_date:\s*businessDate/);
    expect(source).not.toMatch(/currentTime\.toISOString\(\)\.split\('T'\)\[0\]/);
  });
});
