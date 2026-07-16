import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('GET /api/machines read contract', () => {
  test('authenticates and reads every Supabase page', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/app/api/machines/route.ts'), 'utf8');
    expect(source).toMatch(/requireUser\(request, \['admin', 'engineer', 'operator'\]\)/);
    expect(source).toMatch(/\.range\(from, from \+ pageSize - 1\)/);
    expect(source).toMatch(/authenticatedUser\.assignedMachineIds/);
  });
});
