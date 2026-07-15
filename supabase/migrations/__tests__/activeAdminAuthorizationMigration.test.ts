import fs from 'fs';
import path from 'path';

describe('active administrator authorization migration', () => {
  it('requires an active profile before is_admin grants administrator access', () => {
    const migrationPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20260715180000_active_admin_authorization.sql'
    );
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION public\.is_admin\(\)/i);
    expect(sql).toMatch(/role\s*=\s*'admin'[\s\S]*is_active\s+IS\s+TRUE/i);
    expect(sql).toMatch(/auth\.jwt\(\)\s*->>\s*'role'[\s\S]*=\s*'service_role'/i);
  });
});
