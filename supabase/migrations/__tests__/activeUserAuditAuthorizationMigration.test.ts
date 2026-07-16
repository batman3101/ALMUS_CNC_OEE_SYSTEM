import fs from 'fs';
import path from 'path';

describe('active user system settings audit authorization migration', () => {
  const migrationPath = path.resolve(
    process.cwd(),
    'supabase/migrations/20260715190000_active_user_audit_authorization.sql'
  );

  it('removes every existing permissive policy before installing the replacement policies', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/FROM\s+pg_policies[\s\S]*tablename\s*=\s*'system_settings_audit'/i);
    expect(sql).toMatch(/DROP POLICY IF EXISTS %I ON public\.system_settings_audit/i);
  });

  it('allows audit reads only for active administrators and engineers', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');

    expect(sql).toMatch(/FOR\s+SELECT[\s\S]*TO\s+authenticated[\s\S]*role\s+IN\s*\(\s*'admin'\s*,\s*'engineer'\s*\)[\s\S]*is_active\s+IS\s+TRUE/i);
  });

  it('blocks authenticated direct inserts and reserves the insert policy for service_role', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const insertPolicy = Array.from(sql.matchAll(/CREATE\s+POLICY[\s\S]*?;/gi))
      .map(match => match[0])
      .find(policy => /FOR\s+INSERT/i.test(policy)) ?? '';

    expect(insertPolicy).toMatch(/TO\s+service_role/i);
    expect(insertPolicy).toMatch(/WITH\s+CHECK\s*\(\s*true\s*\)/i);
    expect(insertPolicy).not.toMatch(/TO[\s\S]*authenticated/i);
    expect(sql).toMatch(/REVOKE\s+INSERT\s*,\s*UPDATE\s*,\s*DELETE\s*,\s*TRUNCATE[\s\S]*FROM\s+authenticated/i);
    expect(sql).toMatch(/GRANT\s+SELECT\s+ON\s+TABLE\s+public\.system_settings_audit\s+TO\s+authenticated/i);
    expect(sql).not.toMatch(/GRANT\s+SELECT\s*,\s*INSERT[\s\S]*TO\s+authenticated/i);
  });

  it('forces the client audit view through underlying active-user RLS', () => {
    const sql = fs.readFileSync(migrationPath, 'utf8');
    const settingsClient = fs.readFileSync(
      path.resolve(process.cwd(), 'src/lib/systemSettings.ts'),
      'utf8'
    );

    expect(settingsClient).toMatch(/\.from\(\s*['"]recent_settings_changes['"]\s*\)/);
    expect(sql).toMatch(/ALTER\s+VIEW\s+public\.recent_settings_changes\s+SET\s*\(\s*security_invoker\s*=\s*true\s*\)/i);
    expect(sql).toMatch(/REVOKE\s+ALL\s+ON(?:\s+TABLE)?\s+public\.recent_settings_changes\s+FROM\s+anon/i);
    expect(sql).toMatch(/GRANT\s+SELECT\s+ON(?:\s+TABLE)?\s+public\.recent_settings_changes\s+TO\s+authenticated/i);
  });
});
