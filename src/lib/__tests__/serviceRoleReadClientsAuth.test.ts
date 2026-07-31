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

  /**
   * 2026-07-31: 이 검사는 "설비마다 한 번씩 부른다"를 고정하고 있었다. 그 방식이 바로
   * 결함이었다 — 운영자는 전원 800대를 배정받아 800번의 순차 요청이 됐고 대시보드가
   * 뜨지 않았다. 스코프는 이제 라우트가 건다.
   *
   * 이 파일의 관심사는 "보호된 읽기에 세션을 실어 보내는가"이므로 그것만 남긴다.
   * 요청이 한 벌인지는 useRealtimeData.helpers.test.ts 가 동작으로 검사한다.
   */
  it('loads operator OEE records through authFetch with a single server-scoped call', () => {
    const source = read('src/hooks/useRealtimeData.ts');

    expect(source).toMatch(/fetchAllRecentProductionRecords\s*=\s*async\s*\(\)/);
    expect(source).toMatch(/authFetch\(`\/api\/oee-data/);
    // 스코프를 클라이언트가 다시 붙이면 URL 이 30 KB 가 되어 게이트웨이가 거절한다.
    expect(source).not.toMatch(/machine_id:\s*machineId/);
  });
});
