import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const routePath = resolve(process.cwd(), 'src/app/api/downtime-analysis/route.ts');

describe('downtime analysis overlap contract', () => {
  const readRoute = (): string => readFileSync(routePath, 'utf8');

  test('manual and machine-log sources use the same temporal overlap predicate', () => {
    const source = readRoute();
    const machineLogsQuery = source.match(
      /\.from\('machine_logs'\)[\s\S]+?const\s+rawDowntimeLogs/i
    )?.[0] ?? '';
    const manualQuery = source.match(
      /\.from\('downtime_entries'\)[\s\S]+?const\s+rawDowntimeEntries/i
    )?.[0] ?? '';

    for (const query of [machineLogsQuery, manualQuery]) {
      expect(query).toMatch(/\.lt\('start_time',\s*toDate\.toISOString\(\)\)/);
      expect(query).toMatch(/\.or\(`end_time\.is\.null,end_time\.gt\.\$\{fromDate\.toISOString\(\)\}`\)/);
    }
  });

  test('manual events are independent of production records and exact starting shift', () => {
    const source = readRoute();

    expect(source).not.toContain('productionScopeQuery');
    expect(source).not.toContain('validProductionScopes');
    expect(source).not.toMatch(/downtimeEntries\s*=\s*downtimeEntries\.filter\([\s\S]+entry\.shift/i);
  });

  test('an open manual event is clipped at now or the requested range end', () => {
    const source = readRoute();

    expect(source).toMatch(
      /entry\.end_time\s*\?\s*new\s+Date\(entry\.end_time\)\.getTime\(\)\s*:\s*Math\.min\(nowMs,\s*rangeEndMs\)/
    );
    expect(source).toContain("manual_overrides_overlap");
  });
});
