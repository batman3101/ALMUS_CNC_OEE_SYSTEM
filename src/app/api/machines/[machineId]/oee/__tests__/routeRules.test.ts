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
    // 공장 인지 계약으로 전환됐다(2026-08-24). 이름만 바뀐 것이 아니라 **공장까지** 확정
    // 하므로, 옛 이름을 그대로 두면 이 검사가 이제 존재하지 않는 것을 요구하게 된다.
    expect(source).toMatch(/requireFactoryUser\(request, \['admin', 'engineer', 'operator'\]\)/);
    expect(source).toMatch(/assertFactoryMachineAccess/);
    // 설비를 확인했다고 자식(production_records)이 안전한 것은 아니다 — 공장 조건이
    // 자식 조회에도 걸려 있어야 한다.
    expect(source).toMatch(/\.eq\('factory_id', authenticatedUser\.factoryId\)/);
    expect(source).toMatch(/current_cycle:\s*null/);
  });

  it('uses the configured business date instead of the server UTC calendar date', () => {
    expect(source).toMatch(/getBusinessDateAt/);
    expect(source).toMatch(/business_date:\s*businessDate/);
    expect(source).not.toMatch(/currentTime\.toISOString\(\)\.split\('T'\)\[0\]/);
  });
});
