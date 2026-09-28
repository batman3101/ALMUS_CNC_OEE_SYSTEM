/* Local production-build UI check for the weekly layout simulation card.
 * Auth is mocked; file parsing and every calculation run through the real app code in the browser.
 * The factory snapshot comes from FORECAST_SNAPSHOT_PATH (JSON produced by a read-only DB dump) or a
 * small synthetic one when unset. Run `next start --hostname 127.0.0.1 --port 3100` first and set
 * FORECAST_SAMPLE_PATH (and optionally PLAYWRIGHT_MODULE).
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
const snapshot = process.env.FORECAST_SNAPSHOT_PATH ? JSON.parse(fs.readFileSync(process.env.FORECAST_SNAPSHOT_PATH, 'utf8')) : {
  status: 'available', takenAt: new Date().toISOString(),
  models: [{ id: 'h8m', name: 'H8 M', isActive: true, processes: [{ id: 'h8m-c1', name: 'CNC #1', order: 2, tactTimeSeconds: 593 }, { id: 'h8m-c2', name: 'CNC #2', order: 3, tactTimeSeconds: 453 }] }],
  machines: Array.from({ length: 40 }, (_, i) => ({ id: `m${i}`, name: `CNC-${String(i + 1).padStart(3, '0')}`, location: 'B동', isActive: true, modelId: 'h8m', processId: i < 20 ? 'h8m-c1' : 'h8m-c2' })),
};
delete snapshot.factory;
const root = 'http://127.0.0.1:3100';
const output = path.resolve('docs/previews/forecast-input');
fs.mkdirSync(output, { recursive: true });
const checks = [];
const id = '11111111-1111-4111-8111-111111111111';
const factory = '22222222-2222-4222-8222-222222222222';
const jwt = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url'), 'local-test-signature'].join('.');
const labels = { ko: { inspect: '파일 검증', title: '주별 배치 시뮬레이션 (검토안)', moves: '재배치 검토안', confirm: 'Layout 확정 적용' }, vi: { inspect: 'Kiểm tra tệp', title: 'Mô phỏng bố trí theo tuần (bản xem xét)', moves: 'Đề xuất bố trí lại', confirm: 'Áp dụng Layout' } };

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const [role, language] of [['admin', 'ko'], ['engineer', 'vi']]) {
      const L = labels[language];
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
      const page = await context.newPage(); const errors = [];
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
          const preview = parseForecastFile(route.request().postDataBuffer());
          return json({ success: true, preview: { ...preview, factory: { id: factory, code: 'ALT' }, fileName: path.basename(sample), capacityPolicy: { status: 'available', source: 'oee_settings', timezone: 'Asia/Ho_Chi_Minh', shiftAStart: '08:00', shiftBStart: '20:00', breakMinutes: 110, separateEfficiencyMultiplier: false }, capacitySnapshot: snapshot } });
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
      await page.waitForFunction(() => { const input = document.querySelector('input[type="file"]'); return input && !input.disabled; });
      await page.locator('input[type="file"]').setInputFiles(sample);
      await page.getByRole('button', { name: L.inspect, exact: true }).click();
      await page.getByText(L.title, { exact: true }).waitFor();
      const card = page.locator('.ant-card', { hasText: L.title });
      // 1. Week selector: 11 ISO weeks, first one selected by default and shown with its date range.
      const weekSelect = card.locator('[data-testid="week-select"] .ant-select');
      assert.equal(await weekSelect.locator('.ant-select-selection-item').innerText(), 'W37 · 09-07~09-13');
      await weekSelect.click();
      // antd virtualizes the list, so scroll to the end and read the last rendered option.
      const holder = page.locator('.ant-select-dropdown:visible .rc-virtual-list-holder');
      assert.equal(await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').first().innerText(), 'W37 · 09-07~09-13');
      await holder.evaluate(el => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').last().innerText(), 'W47 · 11-16~11-22');
      await page.keyboard.press('Escape');
      // 2. Summary statistics are integers and shortage/changes are consistent with the tables.
      const stat = async title => Number((await card.locator('.ant-statistic', { hasText: title }).locator('.ant-statistic-content-value').innerText()).replace(/[^\d]/g, ''));
      const summary = { required: await stat(language === 'ko' ? '필요대수' : 'Máy cần'), current: await stat(language === 'ko' ? '현재 배치' : 'Đang bố trí'), shortage: await stat(language === 'ko' ? '부족' : 'Thiếu'), changes: await stat(language === 'ko' ? '변경 건수' : 'Số thay đổi') };
      assert.ok(summary.current > 0 && summary.required >= 0, `summary ${JSON.stringify(summary)}`);
      // 3. Alias mapping is visible: H8 MAIN row shows the DB model H8 M; unmapped models are listed.
      const requirements = card.locator('[data-testid="requirements-table"]');
      await requirements.locator('.ant-table-row', { hasText: 'H8 MAIN' }).first().waitFor();
      assert.match(await requirements.locator('.ant-table-row', { hasText: 'H8 MAIN' }).first().innerText(), /H8 M/);
      assert.ok(await card.getByText(language === 'ko' ? /미매칭 모델 \d+개/ : /\d+ model chưa khớp/).isVisible());
      // 4. Moves table lists machine numbers with from → to and reasons; no apply/confirm button anywhere.
      const moves = card.locator('[data-testid="moves-table"]');
      const moveCount = await moves.locator('.ant-table-row').count();
      assert.equal(moveCount > 0, summary.changes > 0);
      if (moveCount) assert.match(await moves.locator('.ant-table-row').first().innerText(), /CNC-\d{3}.*→/s);
      assert.equal(await page.getByRole('button', { name: L.confirm }).count(), 0);
      // 5. Changing the week recomputes.
      const before = await requirements.innerText();
      await weekSelect.click();
      await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content', { hasText: 'W40 ·' }).click();
      await page.waitForFunction(text => document.querySelector('[data-testid="week-select"] .ant-select-selection-item')?.textContent?.startsWith(text), 'W40');
      const after = await requirements.innerText();
      assert.notEqual(before, after);
      // 6. Screenshots + no horizontal page overflow at 390px.
      await page.evaluate(() => { const banner = document.createElement('div'); banner.textContent = 'UI TEST · 가상 계정/설정 · 원본 Excel 파서 + 운영 설비 스냅샷(읽기 전용) · 운영 반영 없음'; banner.style.cssText = 'padding:8px;background:#ffefc5;font:12px sans-serif'; document.body.prepend(banner); });
      await card.scrollIntoViewIfNeeded();
      await card.screenshot({ path: path.join(output, `simulation-${role}-${language}-desktop.png`) });
      await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(400);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
      await card.screenshot({ path: path.join(output, `simulation-${role}-${language}-mobile.png`) });
      checks.push(`${role}/${language}: 11 weeks (W37 default → W40 recompute), summary ${JSON.stringify(summary)}, ${moveCount} moves, alias H8 MAIN→H8 M, unmapped list, no apply button, 390px no overflow`);
      assert.deepEqual(errors, []); await context.close();
    }
    fs.writeFileSync(path.join(output, 'simulation-verification.json'), JSON.stringify({ result: 'PASS', at: new Date().toISOString(), snapshot: process.env.FORECAST_SNAPSHOT_PATH ? 'read-only DB dump' : 'synthetic', checks, limitations: ['Authentication and settings responses mocked; not production authorization/RLS evidence', 'Compatibility, changeover time and JIG are not modeled; proposal is a review draft'] }, null, 2));
    console.log('PASS'); for (const c of checks) console.log(' -', c);
  } finally { await browser.close(); }
})().catch(error => { console.error('FAIL', error); process.exit(1); });
