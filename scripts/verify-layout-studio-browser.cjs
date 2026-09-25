/* Layout Studio in-app acceptance suite: the preview's 21 browser scenarios
 * (docs/previews/forecast-layout/verify.cjs 13 + verify-setup.cjs 8), re-run against /layout-studio
 * inside the app shell, plus role access. Auth and every API/Supabase call are mocked — nothing reaches
 * production. Start the app first (`npm run dev`, or `next start --hostname 127.0.0.1 --port 3100`),
 * then: LAYOUT_STUDIO_ROOT=http://127.0.0.1:3000 node scripts/verify-layout-studio-browser.cjs
 * Optional: PLAYWRIGHT_MODULE, LAYOUT_SOURCE_XLSX (defaults to the local reference workbook).
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/USER/.agents/skills/gstack/node_modules/playwright');

const root = process.env.LAYOUT_STUDIO_ROOT || 'http://127.0.0.1:3000';
const sourceXlsx = process.env.LAYOUT_SOURCE_XLSX || path.resolve('../CNC OEE 참조파일/Setting CNC.xlsx');
const output = path.resolve('docs/previews/layout-studio-app');
const id = '11111111-1111-4111-8111-111111111111';
const factory = '22222222-2222-4222-8222-222222222222';
const jwt = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url'), 'local-test-signature'].join('.');
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS:', name); }

/** Logged-in page with every non-local and /api call mocked. Records writes the studio might make. */
async function openStudio(browser, { role = 'admin', language = 'ko', viewport = { width: 1440, height: 1100 } } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  const errors = []; const writes = [];
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(15000);
  // Close Supabase realtime sockets; keep the dev server's HMR socket (closing it stalls `next dev`).
  await context.routeWebSocket(url => !/^wss?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(String(url)), ws => ws.close());
  const user = { id, email: 'ui-test@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  let profileLanguage = language;
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const json = data => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    if (url.pathname.includes('/auth/v1/token')) return json({ access_token: jwt, refresh_token: 'local-test-refresh', token_type: 'bearer', expires_in: 3600, user });
    if (url.pathname.includes('/auth/v1/user')) return json(user);
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      if (request.method() !== 'GET') writes.push(`${request.method()} ${url.hostname}${url.pathname}`);
      return json([]); // Never call production services.
    }
    if (url.pathname.startsWith('/api/auth/profile')) return json({ success: true, profile: { user_id: id, role, name: 'UI test', assigned_machines: [], is_active: true, language: profileLanguage, theme_mode: 'light' } });
    if (url.pathname === '/api/factory-context') return json({ success: true, current: { id: factory, code: 'ALT' }, available: [], canSwitch: false });
    if (url.pathname.startsWith('/api/')) {
      if (request.method() !== 'GET') writes.push(`${request.method()} ${url.pathname}`);
      return json({ success: true, settings: [], alerts: [], machines: [], data: [] });
    }
    return route.continue();
  });
  await page.goto(root + '/layout-studio');
  // First hit on a dev server compiles the route; allow for it once.
  await page.locator('input[autocomplete="email"]').waitFor({ timeout: 120000 });
  await page.locator('input[autocomplete="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill('local-ui-test');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(1000);
  await page.goto(root + '/layout-studio');
  return { context, page, errors, writes, setProfileLanguage: l => { profileLanguage = l; } };
}

const S = sel => `.layout-studio ${sel}`;
/** The suite itself flips the app header language, which saves the user's preference. That write belongs
 * to the app shell (and is intercepted here); anything else would have come from the studio. */
const shellWrites = writes => writes.filter(w => !w.endsWith('/rest/v1/rpc/update_my_preferences'));

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    // ── Preview verify.cjs (13) ────────────────────────────────────────────
    {
      const { context, page, errors, writes } = await openStudio(browser);
      await page.waitForFunction(() => window.__layoutStudio && document.querySelectorAll('.layout-studio .machine').length === 448, null, { timeout: 120000 });
      const state = () => page.evaluate(() => window.__layoutStudio.state());
      const L = sel => page.locator(S(sel));
      const search = async value => { await L('#search').fill(String(value)); await L('#searchForm button').click(); };
      const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);

      await check('800 unique machines match the actual Excel cells; lower calculation table excluded', async () => {
        const data = await page.evaluate(() => window.__layoutStudio.data);
        assert.equal(data.machines.length, 800);
        assert.equal(new Set(data.machines.map(m => m.id)).size, 800);
        const sheet = XLSX.readFile(sourceXlsx).Sheets.W39;
        for (const m of data.machines) {
          assert.equal(sheet[m.cell].v, m.id);
          const cell = XLSX.utils.decode_cell(m.cell);
          assert.equal(sheet[XLSX.utils.encode_cell({ r: cell.r + 1, c: cell.c })].v, m.model + '-' + m.process);
          assert.ok(m.row <= 87);
          assert.equal(m.building, m.id <= 448 ? 'B' : 'A');
        }
        assert.equal(data.machines.filter(m => m.process === 'C0').length, 21);
      });
      await check('A/B and all-building navigation', async () => {
        await L('[data-building="A"]').click(); assert.equal(await L('.machine').count(), 352);
        await L('[data-building="all"]').click(); assert.equal(await L('.machine').count(), 800);
        await L('#fit').click();
        await page.screenshot({ path: path.join(output, 'overview.png'), fullPage: true });
      });
      await check('Search switches building and focuses the exact machine', async () => {
        await search('CNC-449'); assert.equal((await state()).building, 'A'); assert.equal((await state()).selected, 449);
        assert.match(await L('#selectedLocation').innerText(), /B43/);
        await search(305); assert.equal((await state()).building, 'B');
        await search(999); assert.equal((await state()).selected, 305);
      });
      await check('Zoom, pan and keyboard navigation', async () => {
        let before = await state(); await L('#zoomIn').click(); assert.ok((await state()).scale > before.scale);
        before = await state(); await L('#zoomOut').click(); assert.ok((await state()).scale < before.scale);
        await L('#stage').focus(); before = await state(); await page.keyboard.press('+'); assert.ok((await state()).scale > before.scale);
        const box = await L('#stage').boundingBox(); before = await state();
        await page.mouse.move(box.x + 220, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x + 300, box.y + 250, { steps: 8 }); await page.mouse.up();
        assert.ok(Math.abs((await state()).tx - before.tx) > 40);
        // Dragging the map must pan it, not select the SVG machine labels (user report 2026-09-25).
        // Synthetic drags (Playwright and CDP) do not reproduce the highlight a real mouse drag made, so
        // guard the cause instead: text selection is off on the map, and nothing is selected after a drag.
        assert.equal(await L('#stage').evaluate(e => getComputedStyle(e).userSelect), 'none');
        assert.equal(await page.evaluate(() => window.getSelection().toString()), '');
        // Wheel zoom must zoom the map, not scroll the app page.
        const scrollBefore = await page.evaluate(() => [scrollY, document.querySelector('.layout-studio').closest('[class*="content"], main')?.scrollTop ?? 0]);
        before = await state(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -300); await page.waitForTimeout(100);
        assert.ok((await state()).scale > before.scale);
        assert.deepEqual(await page.evaluate(() => [scrollY, document.querySelector('.layout-studio').closest('[class*="content"], main')?.scrollTop ?? 0]), scrollBefore);
        await search(305);
      });
      await check('Manual editing, lock, undo and redo', async () => {
        await page.selectOption(S('#editModel'), 'PA1'); await page.selectOption(S('#editProcess'), 'C2'); await L('#applyEdit').click();
        assert.deepEqual((await state()).draft.edits['305'], { model: 'PA1', process: 'C2' });
        await L('#lock').click(); assert.ok(await L('#applyEdit').isDisabled());
        await L('#undo').click(); assert.equal(await L('#applyEdit').isDisabled(), false);
        await L('#undo').click(); assert.equal((await state()).draft.edits['305'], undefined);
        await L('#redo').click(); assert.equal((await state()).draft.edits['305'].model, 'PA1');
      });
      await check('Original, draft, compare and model filter', async () => {
        await L('[data-mode="current"]').click(); assert.match(await L('.machine[data-id="305"]').getAttribute('aria-label'), /B6S6-C1/);
        await L('[data-mode="compare"]').click(); assert.match(await L('.machine[data-id="305"]').getAttribute('aria-label'), /PA1-C2/);
        await page.selectOption(S('#modelFilter'), 'PA1'); assert.equal(await L('.machine[data-id="305"]').evaluate(e => e.classList.contains('dim')), false);
        await page.selectOption(S('#modelFilter'), '');
      });
      await check('Persistence and reset with recoverable history', async () => {
        await L('#save').click(); await page.reload(); await page.waitForFunction(() => window.__layoutStudio && document.querySelectorAll('.layout-studio .machine').length > 0);
        assert.equal((await state()).draft.edits['305'].model, 'PA1');
        await L('#reset').click(); await L('#confirmReset').click(); assert.deepEqual((await state()).draft.edits, {});
        await L('#undo').click(); assert.equal((await state()).draft.edits['305'].model, 'PA1');
        await L('#reset').click(); await L('#confirmReset').click();
      });
      await check('Sample changes are labeled, six edits, and production apply is disabled', async () => {
        await L('#demo').click(); assert.equal(Object.keys((await state()).draft.edits).length, 6);
        assert.equal(await L('#demoBadge').isVisible(), true);
        assert.equal(await L('.review-box button').isDisabled(), true);
        await page.waitForTimeout(3400);
        await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
      });
      await check('JSON export preserves provenance and marks data as an unvalidated preview', async () => {
        const waitDownload = page.waitForEvent('download'); await L('#export').click(); const dl = await waitDownload;
        const file = path.join(output, 'verified-draft.json'); await dl.saveAs(file);
        const json = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(json.previewOnly, true); assert.equal(json.capacityValidated, false); assert.equal(json.edits.length, 6);
      });
      await check('Korean and Vietnamese UI (follows the app header language switch live)', async () => {
        assert.equal((await state()).lang, 'ko');
        await page.locator('header .anticon-global').first().click(); await page.getByText('Tiếng Việt').click();
        await page.waitForFunction(() => window.__layoutStudio.state().lang === 'vi');
        assert.match(await L('h1').innerText(), /Bố trí Layout/); assert.match(await L('#applyEdit').innerText(), /Cập nhật/);
        await page.locator('header .anticon-global').first().click(); await page.getByText('한국어').click();
        await page.waitForFunction(() => window.__layoutStudio.state().lang === 'ko');
        assert.match(await L('h1').innerText(), /Layout 배치/);
      });
      await check('Chrome follows the app theme; dark mode darkens the chrome but the map stays light', async () => {
        const colours = () => page.evaluate(() => {
          const q = s => getComputedStyle(document.querySelector('.layout-studio ' + s));
          const root = getComputedStyle(document.querySelector('.layout-studio'));
          return { primary: root.getPropertyValue('--ls-primary').trim(), save: q('#save').backgroundColor, workspace: q('.workspace').backgroundColor, stage: q('#stage').backgroundColor, tools: q('#stage .map-tools button').backgroundColor };
        });
        const rgb = hex => { const n = parseInt(hex.replace('#', '').slice(0, 6), 16); return `rgb(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255})`; };
        const light = await colours();
        assert.equal(light.save, rgb(light.primary)); // primary button = configured app primary colour
        assert.equal(light.stage, 'rgb(246, 248, 251)');
        await page.locator('header .anticon-moon').first().click();
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.layout-studio .workspace')).backgroundColor !== 'rgb(255, 255, 255)');
        const dark = await colours();
        const luminance = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
        assert.ok(luminance(dark.workspace) < 0.25, `workspace should be dark, got ${dark.workspace}`);
        assert.equal(dark.stage, 'rgb(246, 248, 251)'); // the map stays light (decision 2026-09-25)
        assert.equal(dark.tools, 'rgb(255, 255, 255)');
        await page.screenshot({ path: path.join(output, 'desktop-dark.png'), fullPage: true });
        await page.locator('header .anticon-sun').first().click();
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.layout-studio .workspace')).backgroundColor === 'rgb(255, 255, 255)');
      });
      await check('390px and 360px mobile: no overflow, selection remains visible, editor closes', async () => {
        await search(305); await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
        const inside = await L('.machine[data-id="305"]').evaluate(e => { const r = e.getBoundingClientRect(), s = document.querySelector('.layout-studio #stage').getBoundingClientRect(); return r.x >= s.x && r.right <= s.right; });
        assert.equal(inside, true);
        await L('#closePanel').click();
        assert.equal(await noOverflow(), true);
        await page.waitForTimeout(3400); await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
        await search(305); assert.ok(await L('.inspector').isVisible());
        await page.screenshot({ path: path.join(output, 'mobile-editor.png'), fullPage: true });
        await L('#closePanel').click(); await page.setViewportSize({ width: 360, height: 800 }); await page.waitForTimeout(300);
        assert.equal(await noOverflow(), true);
        await page.screenshot({ path: path.join(output, 'mobile-360.png'), fullPage: true });
      });
      await check('Two-pointer pinch changes zoom without changing assignments', async () => {
        const before = await state();
        await page.evaluate(() => { const s = document.querySelector('.layout-studio #stage'), r = s.getBoundingClientRect(); const send = (type, pid, x, y) => s.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: pid, pointerType: 'touch', clientX: r.x + x, clientY: r.y + y })); send('pointerdown', 10, 110, 150); send('pointerdown', 11, 210, 150); send('pointermove', 11, 250, 150); send('pointerup', 10, 110, 150); send('pointerup', 11, 250, 150); });
        const after = await state(); assert.ok(after.scale > before.scale); assert.deepEqual(after.draft, before.draft);
      });
      await check('No JavaScript errors and no writes to any API or production service', async () => { assert.deepEqual(errors, []); assert.deepEqual(shellWrites(writes), []); });
      await context.close();
    }

    // ── Preview verify-setup.cjs (8), fresh storage like the original separate run ──
    {
      const { context, page, errors, writes } = await openStudio(browser);
      await page.waitForFunction(() => window.__layoutStudio && document.querySelectorAll('.layout-studio .machine').length === 448, null, { timeout: 120000 });
      const state = () => page.evaluate(() => window.__layoutStudio.state());
      const L = sel => page.locator(S(sel));
      const search = async value => { await L('#search').fill(String(value)); await L('#searchForm button').click(); };
      await check('Publish requires changes; six targets apply immediately as pending', async () => {
        assert.equal(await L('#setupPublish').isDisabled(), true); await L('#demo').click(); await L('#setupPublish').click();
        const s = await state(); assert.equal(s.mode, 'setup'); assert.equal(Object.keys(s.setup.tasks).length, 6); assert.ok(Object.values(s.setup.tasks).every(t => t.status === 'pending'));
        assert.equal(s.setup.tasks[305].target.model, 'ON1'); assert.match(await L('#setupTarget').innerText(), /ON1-C1/); assert.equal(await L('#setupComplete').isVisible(), false);
      });
      await check('Start and complete are sequential; events and completed count retained', async () => {
        await L('#setupStart').click(); assert.equal((await state()).setup.tasks[305].status, 'in_progress'); assert.equal(await L('#setupStart').isVisible(), false);
        await L('#setupComplete').click(); assert.equal((await state()).setup.tasks[305].status, 'completed'); assert.equal((await state()).setup.tasks[305].events.length, 3);
        assert.match(await L('#setupCounts').innerText(), /완료 1/); assert.equal(await L('.machine[data-id="305"]').getAttribute('data-setup'), 'completed');
        await search(306); await L('#setupStart').click();
      });
      await check('Setup filters and unaffected machines have no action buttons', async () => {
        await page.selectOption(S('#setupFilter'), 'in_progress'); assert.equal(await L('.machine:not(.dim)[data-setup="in_progress"]').count(), 1);
        await search(1); assert.match(await L('#setupState').innerText(), /대상 아님/); assert.equal(await L('#setupStart').isVisible(), false); assert.equal(Object.keys((await state()).setup.tasks).length, 6);
      });
      await check('Draft edit and undo cannot alter the applied target or setup history', async () => {
        const before = (await state()).setup; await search(305); await L('[data-mode="draft"]').click(); await page.selectOption(S('#editModel'), 'PA1'); await L('#applyEdit').click(); assert.deepEqual((await state()).setup, before);
        await L('#undo').click(); assert.deepEqual((await state()).setup, before); assert.equal(await L('#setupPublish').isDisabled(), true);
        assert.equal(await L('.review-box button').isDisabled(), true);
      });
      await check('Setup persists after reload; Korean/Vietnamese state labels', async () => {
        await page.reload(); await page.waitForFunction(() => window.__layoutStudio && document.querySelectorAll('.layout-studio .machine').length > 0);
        await L('[data-mode="setup"]').click(); await search(305); assert.equal((await state()).setup.tasks[305].status, 'completed');
        await page.locator('header .anticon-global').first().click(); await page.getByText('Tiếng Việt').click();
        await page.waitForFunction(() => window.__layoutStudio.state().lang === 'vi');
        assert.match(await L('#setupState').innerText(), /Hoàn tất/);
        await page.locator('header .anticon-global').first().click(); await page.getByText('한국어').click();
        await page.waitForFunction(() => window.__layoutStudio.state().lang === 'ko');
        await page.waitForTimeout(3500); await page.screenshot({ path: path.join(output, 'setup-desktop.png'), fullPage: true });
      });
      await check('360px mobile can start/complete setup with no horizontal overflow', async () => {
        await page.setViewportSize({ width: 360, height: 800 }); await page.waitForTimeout(300); await search(315); await L('#setupStart').click(); await L('#setupComplete').click(); assert.equal((await state()).setup.tasks[315].status, 'completed');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.waitForTimeout(3500); await page.screenshot({ path: path.join(output, 'setup-mobile.png'), fullPage: true });
      });
      await check('Storage failure does not optimistically mark setup started', async () => {
        await search(316); await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('test storage failure'); }; }); await L('#setupStart').click(); assert.equal((await state()).setup.tasks[316].status, 'pending'); assert.match(await L('#toast').innerText(), /실패/);
      });
      await check('No JavaScript errors or writes to any API or production service (setup)', async () => { assert.deepEqual(errors, []); assert.deepEqual(shellWrites(writes), []); });
      await context.close();
    }

    // ── App integration: role access ─────────────────────────────────────────
    for (const role of ['engineer', 'operator']) {
      const { context, page } = await openStudio(browser, { role });
      if (role === 'operator') {
        await page.waitForTimeout(1500);
        await check('Operator cannot open Layout Studio', async () => { assert.equal(await page.locator('.layout-studio .machine').count(), 0); });
      } else {
        await check('Engineer can open Layout Studio', async () => { await page.waitForFunction(() => document.querySelectorAll('.layout-studio .machine').length === 448); });
      }
      await context.close();
    }

    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ result: 'PASS', root, timestamp: new Date().toISOString(), checks, limitations: ['Auth and all API/Supabase traffic mocked; no production DB integration exists yet', 'Synthetic two-pointer test; physical touch-device testing not performed'] }, null, 2));
    console.log('ALL PASS:', checks.length, 'checks');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
