import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

describe('service-role read clients send the authenticated session', () => {
  it.each([
    ['src/lib/requestCache.ts', /authFetch\(url\)/],
    ['src/hooks/useEngineerData.ts', /authFetch\(`\/api\/downtime-analysis/],
    ['src/hooks/useEngineerData.ts', /authFetch\(`\/api\/quality-analysis/],
    ['src/hooks/useMachineOEEStats.ts', /authFetch\(`\/api\/oee-data\/by-machine/],
    ['src/hooks/useRealtimeProductionRecords.ts', /authFetch\(`\/api\/oee-data/],
    ['src/components/dashboard/AdminDashboard.tsx', /authFetch\(`\/api\/productivity-analysis/],
    ['src/components/dashboard/AdminDashboard.tsx', /authFetch\('\/api\/machine-status-descriptions'/],
    ['src/contexts/AuthContext.tsx', /Authorization:\s*`Bearer \$\{accessToken\}`/],
    ['src/lib/systemSettings.ts', /Authorization:\s*`Bearer \$\{token\}`/],
  ])('%s uses authFetch for the protected read', (path, expected) => {
    expect(read(path)).toMatch(expected);
  });

  it('loads operator OEE records one assigned machine at a time', () => {
    const source = read('src/hooks/useRealtimeData.ts');

    expect(source).toMatch(/fetchAllRecentProductionRecords\s*=\s*async\s*\(machineIds\?:\s*string\[\]\)/);
    expect(source).toMatch(/machine_id:\s*machineId/);
    expect(source).toMatch(/userRole\s*===\s*'operator'[\s\S]+assigned_machines/);
    expect(source).toMatch(/authFetch\(`\/api\/oee-data/);
  });
});
