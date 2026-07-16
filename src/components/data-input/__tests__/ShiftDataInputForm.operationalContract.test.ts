import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ShiftDataInputForm operational contract', () => {
  const source = readFileSync(
    resolve(process.cwd(), 'src/components/data-input/ShiftDataInputForm.tsx'),
    'utf8'
  );

  it('preserves explicit zero-minute operating and break settings', () => {
    expect(source).not.toMatch(/Number\(shiftSettings\.breakTime\)\s*\|\|\s*60/);
    expect(source).not.toMatch(/setDayShiftOperatingMinutes\(value\s*\|\|\s*720\)/);
    expect(source).not.toMatch(/setNightShiftOperatingMinutes\(value\s*\|\|\s*720\)/);
  });

  it('does not disable independent downtime entry merely because production is off', () => {
    expect(source).not.toMatch(/disabled=\{\(activeShift === 'DAY' && dayShiftOff\)/);
  });

  it('uses a client generated downtime id so a lost create response can be retried safely', () => {
    expect(source).toMatch(/clientEntryId\s*=\s*downtimeCreateIdRef\.current\s*\?\?\s*crypto\.randomUUID\(\)/);
    expect(source).toMatch(/downtimeCreateIdRef\.current\s*=\s*clientEntryId/);
    expect(source).toMatch(/body:\s*JSON\.stringify\(\{[\s\S]{0,400}id:\s*clientEntryId/);
  });

  it('restores persisted off states and supports an explicit working zero-production shift', () => {
    expect(source).toMatch(/result\.shift_states/);
    expect(source).toMatch(/dayShiftWorkingConfirmed/);
    expect(source).toMatch(/nightShiftWorkingConfirmed/);
    expect(source).toMatch(/shift\.workingZeroConfirmed/);
  });

  it('defaults the form to the configured business date and current shift', () => {
    expect(source).toMatch(/getBusinessDateAt\(Date\.now\(\),\s*businessTimezone/);
    expect(source).toMatch(/getShiftAt\([\s\S]{0,180}shiftSettings\.shiftB\.start/);
    expect(source).toMatch(/\.tz\(businessTimezone, true\)/);
  });

  it('does not ask the operator to confirm that no downtime happened', () => {
    // 현장은 비가동이 발생했을 때만 기록한다. 별도 확인을 요구하면 지켜지지 않고
    // 정상 가동 설비가 OEE 미계산으로 남는다 (2026-07-16: 396건 / 10.3%).
    // 서버가 "비가동 0건 = 비가동 없음"으로 판단한다
    // (daily/downtimeCalculation.ts resolveConfirmedDowntimeMinutes).
    expect(source).not.toMatch(/ZeroDowntimeConfirmed/);
    expect(source).not.toMatch(/downtime_confirmed/);
    expect(source).not.toMatch(/downtime\.confirmZeroOk/);
  });
});
