/* Local production-build UI smoke test. Auth/DB are mocked; source parsing is real.
 * Run `next start --hostname 127.0.0.1 --port 3100` first.
 * Set FORECAST_SAMPLE_PATH and optionally PLAYWRIGHT_MODULE before running.
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/USER/.agents/skills/gstack/node_modules/playwright');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file);
const { parseForecastFile } = require('../src/lib/forecast/parseForecast.ts');
const sample = process.env.FORECAST_SAMPLE_PATH;
if (!sample) throw new Error('Set FORECAST_SAMPLE_PATH to the authorized local workbook.');
const root = 'http://127.0.0.1:3100';
const output = path.resolve('docs/previews/forecast-input');
fs.mkdirSync(output, { recursive: true });
const checks = [];
const id = '11111111-1111-4111-8111-111111111111';
const factory = '22222222-2222-4222-8222-222222222222';
const jwt = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url'), 'local-test-signature'].join('.');

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [role, language] of [['admin', 'ko'], ['engineer', 'vi'], ['operator', 'ko']]) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage(); const errors = []; let uploads = 0;
      page.on('pageerror', e => errors.push(e.message));
      await context.routeWebSocket('**/*', ws => ws.close());
      const user = { id, email: 'ui-test@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
      await context.route('**/*', async route => {
        const url = new URL(route.request().url());
        const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
        if (url.pathname.includes('/auth/v1/token')) return json({ access_token: jwt, refresh_token: 'local-test-refresh', token_type: 'bearer', expires_in: 3600, user });
        if (url.pathname.includes('/auth/v1/user')) return json(user);
        if (url.hostname !== '127.0.0.1') return json([]); // Never call production services.
        if (url.pathname.startsWith('/api/auth/profile')) return json({ success: true, profile: { user_id: id, role, name: 'UI test', assigned_machines: [], is_active: true, language, theme_mode: 'light' } });
        if (url.pathname === '/api/factory-context') return json({ success: true, current: { id: factory, code: 'ALT' }, available: [], canSwitch: false });
        if (url.pathname === '/api/forecasts/preview') {
          uploads++;
          assert.equal(route.request().headers()['x-forecast-factory-id'], factory);
          const preview = parseForecastFile(route.request().postDataBuffer());
          return json({ success: true, preview: { ...preview, factory: { id: factory, code: 'ALT' }, fileName: path.basename(sample), capacityPolicy: { status: 'available', source: 'oee_settings', timezone: 'Asia/Ho_Chi_Minh', shiftAStart: '08:00', shiftBStart: '20:00', breakMinutes: 110, separateEfficiencyMultiplier: false } } });
        }
        if (url.pathname.startsWith('/api/')) return json({ success: true, settings: [], alerts: [], machines: [], data: [] });
        return route.continue();
      });
      await page.goto(root + '/forecast');
      await page.locator('input[autocomplete="email"]').fill(user.email);
      await page.locator('input[type="password"]').fill('local-ui-test');
      await page.locator('button[type="submit"]').click();
      await page.waitForTimeout(1000);
      await page.goto(root + '/forecast');
      if (role === 'operator') {
        await page.waitForTimeout(800);
        assert.equal(await page.locator('input[type="file"]').count(), 0);
        assert.equal(uploads, 0); checks.push('Operator cannot reach the Forecast upload screen');
      } else {
        await page.waitForFunction(() => { const input = document.querySelector('input[type="file"]'); return input && !input.disabled; });
        await page.locator('input[type="file"]').setInputFiles(sample);
        await page.getByRole('button', { name: language === 'ko' ? '파일 검증' : 'Kiểm tra tệp', exact: true }).click();
        await page.getByText(path.basename(sample), { exact: true }).waitFor();
        await page.locator('input[type="date"]').first().fill('2026-09-21');
        await page.locator('input[type="date"]').last().fill('2026-09-27');
        assert.equal(uploads, 1);
        assert.equal(await page.locator('input[type="date"]').first().inputValue(), '2026-09-21');
        await page.locator('.ant-table-row-expand-icon').first().click();
        assert.equal(await page.getByText('W15', { exact: true }).isVisible(), true);
        await page.evaluate(() => { const banner = document.createElement('div'); banner.textContent = 'UI TEST · 가상 계정/설정 · 원본 Excel 파서 사용 · 운영 DB 연결 없음'; banner.style.cssText = 'padding:8px;background:#ffefc5;font:12px sans-serif'; document.body.prepend(banner); });
        await page.screenshot({ path: path.join(output, `${role}-${language}-desktop.png`), fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
        await page.screenshot({ path: path.join(output, `${role}-${language}-mobile.png`), fullPage: true });
        checks.push(`${role}/${language}: upload, source parser, period filter, row details, 390px no overflow`);
      }
      assert.deepEqual(errors, []); await context.close();
    }
    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ result: 'PASS', at: new Date().toISOString(), checks, limitations: ['Authentication and DB/settings responses mocked; not production authorization/RLS evidence', 'CAPA calculation, persistence, optimization and setup publishing remain later phases'] }, null, 2));
    console.log('PASS', checks);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exit(1); });
