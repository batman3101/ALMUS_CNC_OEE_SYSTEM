import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('GET /api/machines read contract', () => {
  test('authenticates and reads every Supabase page', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/machines/route.ts'), 'utf8');
    // 이 Route 는 공장 인지 계약으로 전환됐다. 역할 목록은 그대로이고 공장 경계가
    // 추가된 것이다 — requireUser 로 되돌아가면 그 경계가 사라진다.
    expect(source).toMatch(/requireFactoryUser\(request, \['admin', 'engineer', 'operator'\]\)/);
    expect(source).toMatch(/\.eq\('factory_id', authenticatedUser\.factoryId\)/);
    expect(source).toMatch(/\.range\(from, from \+ pageSize - 1\)/);
    expect(source).toMatch(/authenticatedUser\.assignedMachineIds/);
  });
});
