/* Layout Studio in-app acceptance suite — DB mode (2026-09-25).
 *
 * The page now shows a real layout plan. Auth and every API/Supabase call are mocked; a small in-memory
 * "server" below plays /api/layout-planning/* with the W39 drawing (800 machines as the current factory state)
 * and a draft plan whose recommendation is the preview's 6-machine example. Nothing reaches production.
 *
 * Keeps every intent of the preview's 21 scenarios + theme + drag selection, adds the DB-mode ones:
 * server save/reload, recommendation restore, CAPA alerts, 409 conflict, confirm → setup, read-only,
 * no-drawing factory, no-plan state, and the Forecast → mapping → plan launcher.
 *
 * Start the app (`npm run dev` → use http://localhost:3000, or `next start --hostname 127.0.0.1 --port 3100`), then:
 *   LAYOUT_STUDIO_ROOT=http://127.0.0.1:3100 node scripts/verify-layout-studio-browser.cjs
 */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const XLSX = require('xlsx');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/USER/.agents/skills/gstack/node_modules/playwright');
require.extensions['.ts'] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText, file);
const Module = require('module');
const resolveFile = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) { return resolveFile.call(this, request.startsWith('@/') ? path.resolve('src', request.slice(2)) : request, ...rest); };
const { parseForecastFile } = require('../src/lib/forecast/parseForecast.ts');

const root = process.env.LAYOUT_STUDIO_ROOT || 'http://127.0.0.1:3000';
const sourceXlsx = process.env.LAYOUT_SOURCE_XLSX || path.resolve('../CNC OEE 참조파일/Setting CNC.xlsx');
const forecastXlsx = process.env.FORECAST_SAMPLE_PATH || path.resolve('../CNC OEE 참조파일/ALMUS TECH FORECAST W39 update B7.xlsx');
const output = path.resolve('docs/previews/layout-studio-app');
const layout = require('../src/components/layout-studio/layoutData.json');
const userId = '11111111-1111-4111-8111-111111111111';
const factory = '22222222-2222-4222-8222-222222222222';
const jwt = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: userId, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url'), 'local-test-signature'].join('.');
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS:', name); }
const S = sel => `.layout-studio ${sel}`;
/** The suite flips the header language/theme, which saves the user's preference: that write is the app shell's. */
const studioWrites = writes => writes.filter(w => !w.endsWith('/rest/v1/rpc/update_my_preferences'));

// ── In-memory layout-planning server ─────────────────────────────────────────────────────────────
const uid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`;
const MODEL_DEFS = { ON1: [['CNC #1', 560], ['CNC #2', 558]], ON3: [['CNC #1', 948], ['CNC #2', 646]], H8M: [['CNC #0', 63], ['CNC #1', 593], ['CNC #2', 453]], H8S: [['CNC #0', 68], ['CNC #1', 807], ['CNC #2', 860]], M1: [['CNC #1', 602], ['CNC #2', 638]], M3: [['CNC #1', 851], ['CNC #2', 965]], PA1: [['CNC #1', 531], ['CNC #2', 664]], B6S6: [['CNC #1', 379], ['CNC #2', 298]] };
const RECOMMENDED = [[305, 'ON1', 'C1'], [306, 'ON1', 'C1'], [315, 'ON1', 'C2'], [316, 'ON1', 'C2'], [653, 'M3', 'C2'], [654, 'M3', 'C2']];

function makeServer({ withPlan = true } = {}) {
  const models = Object.entries(MODEL_DEFS).map(([name, procs], i) => ({
    id: uid('10000000', i + 1), name, isActive: true,
    processes: procs.map(([p, tact], j) => ({ id: uid('20000000', (i + 1) * 10 + j), name: p, order: j + 1, tactTimeSeconds: tact })),
  }));
  const model = name => models.find(m => m.name === name);
  const proc = (name, code) => model(name).processes.find(p => p.name.replace(/\D/g, '') === code.slice(1)).id;
  const machines = layout.machines.map(m => ({ id: uid('30000000', m.id), name: `CNC-${String(m.id).padStart(3, '0')}`, location: m.building, isActive: true, modelId: model(m.model).id, processId: proc(m.model, m.process) }));
  const byNo = n => machines[layout.machines.findIndex(m => m.id === n)];
  const positions = layout.machines.map(m => ({ machineId: uid('30000000', m.id), building: m.building, cell: m.cell, x: m.x, y: m.y, width: m.width, height: m.height }));
  const state = { plans: [], assignments: new Map(), requirements: new Map(), tasks: [], conflictNext: false, writes: [] };
  function newPlan(id, title) {
    state.plans.push({ id, status: 'draft', revision: 1, title, target_week: '2026-W39', created_at: new Date().toISOString() });
    state.assignments.set(id, machines.map(m => {
      const rec = RECOMMENDED.find(([n]) => byNo(n).id === m.id);
      const recModel = rec ? model(rec[1]).id : m.modelId;
      const recProc = rec ? proc(rec[1], rec[2]) : m.processId;
      return { machine_id: m.id, base_model_id: m.modelId, base_process_id: m.processId, recommended_model_id: recModel, recommended_process_id: recProc, final_model_id: recModel, final_process_id: recProc, is_locked: false };
    }));
    // Requirements chosen to light every alert kind: ON1-C1 short by 2 even after the recommendation, M3-C2 in surplus, PA1-C2 exact.
    const count = (mid, pid) => state.assignments.get(id).filter(a => a.final_model_id === mid && a.final_process_id === pid).length;
    const req = (name, code, required) => ({ modelId: model(name).id, modelName: name, processId: proc(name, code), processName: `CNC #${code.slice(1)}`, forecastModel: name, peakQuantity: required * 130, dailyCapacityPerMachine: 130, requiredMachines: required });
    state.requirements.set(id, [
      req('ON1', 'C1', count(model('ON1').id, proc('ON1', 'C1')) + 2),
      req('M3', 'C2', count(model('M3').id, proc('M3', 'C2')) - 3),
      req('PA1', 'C2', count(model('PA1').id, proc('PA1', 'C2'))),
      { ...req('H8S', 'C0', 0), dailyCapacityPerMachine: null, requiredMachines: null },
    ]);
  }
  if (withPlan) newPlan('40000000-0000-4000-8000-000000000001', 'W39 · test.xlsx');
  const plan = id => state.plans.find(p => p.id === id);
  const planBody = id => ({ success: true, plan: plan(id), requirements: state.requirements.get(id), assignments: state.assignments.get(id), setupTasks: state.tasks.filter(t => t.plan_id === id), summary: { groups: [], totals: {} } });
  return {
    state, byNo, model, proc, newPlan,
    handle(method, pathname, body) {
      if (pathname === '/api/layout-planning/workspace') return [200, { success: true, factory: { id: factory, code: 'ALT' }, geometry: { id: 'g1', sourceFile: 'Setting CNC.xlsx', sourceSheet: 'W39', sourceHash: layout.sha256, note: null, positions }, snapshot: { status: 'available', takenAt: 'now', models, machines }, policy: { status: 'available', breakMinutes: 110 }, plans: state.plans.filter(p => p.status === 'draft' || p.status === 'confirmed'), mappings: [] }];
      const m = pathname.match(/^\/api\/layout-planning\/plans\/([^/]+)(?:\/(confirm|discard))?$/);
      if (m) {
        const p = plan(m[1]);
        if (!p) return [404, { success: false, code: 'plan_not_found' }];
        if (method === 'GET') return [200, planBody(p.id)];
        if (method === 'PATCH') {
          if (state.conflictNext) { state.conflictNext = false; p.revision++; return [409, { success: false, code: 'plan_revision_conflict' }]; }
          if (body.expectedRevision !== p.revision) return [409, { success: false, code: 'plan_revision_conflict' }];
          for (const c of body.changes) { const a = state.assignments.get(p.id).find(x => x.machine_id === c.machineId); Object.assign(a, { final_model_id: c.finalModelId, final_process_id: c.finalProcessId }, c.isLocked === undefined ? {} : { is_locked: c.isLocked }); }
          p.revision++;
          return [200, { ...planBody(p.id), revision: p.revision }];
        }
        if (m[2] === 'confirm') {
          if (body.expectedRevision !== p.revision) return [409, { success: false, code: 'plan_revision_conflict' }];
          const changed = state.assignments.get(p.id).filter(a => a.final_model_id !== a.base_model_id || a.final_process_id !== a.base_process_id);
          const at = new Date().toISOString();
          for (const a of changed) {
            state.tasks.push({ id: uid('50000000', state.tasks.length + 1), plan_id: p.id, machine_id: a.machine_id, status: 'pending', revision: 1, before_model_id: a.base_model_id, before_process_id: a.base_process_id, target_model_id: a.final_model_id, target_process_id: a.final_process_id, created_at: at, started_at: null, completed_at: null });
            const mc = machines.find(x => x.id === a.machine_id); mc.modelId = a.final_model_id; mc.processId = a.final_process_id;
          }
          state.plans.filter(x => x.status === 'confirmed').forEach(x => { x.status = 'superseded'; });
          p.status = 'confirmed'; p.revision++;
          return [200, { success: true, plan_id: p.id, revision: p.revision, changed_machines: changed.length }];
        }
        if (m[2] === 'discard') { if (p.status !== 'draft') return [409, { success: false, code: 'plan_not_draft' }]; p.status = 'discarded'; return [200, { success: true }]; }
      }
      const tm = pathname.match(/^\/api\/layout-planning\/setup-tasks\/([^/]+)\/transition$/);
      if (tm) {
        const task = state.tasks.find(t => t.id === tm[1]);
        if (!task || task.revision !== body.expectedRevision) return [409, { success: false, code: 'plan_revision_conflict' }];
        const ok = (task.status === 'pending' && body.toStatus === 'in_progress') || (task.status === 'in_progress' && body.toStatus === 'completed');
        if (!ok) return [409, { success: false, code: 'invalid_setup_transition' }];
        task.status = body.toStatus; task.revision++;
        if (body.toStatus === 'in_progress') task.started_at = new Date().toISOString(); else task.completed_at = new Date().toISOString();
        return [200, { success: true, task_id: task.id, status: task.status, revision: task.revision }];
      }
      return null;
    },
  };
}

async function openApp(browser, { role = 'admin', language = 'ko', viewport = { width: 1440, height: 1100 }, server = makeServer(), noGeometry = false, failTransition = false, extraRoutes = null } = {}) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, acceptDownloads: true });
  const page = await context.newPage();
  const errors = []; const writes = [];
  page.on('pageerror', e => errors.push(e.message));
  page.setDefaultTimeout(15000);
  // Close Supabase realtime sockets; keep the dev server's HMR socket (closing it stalls `next dev`).
  await context.routeWebSocket(url => !/^wss?:\/\/(localhost|127\.0\.0\.1)[:/]/.test(String(url)), ws => ws.close());
  const user = { id: userId, email: 'ui-test@example.invalid', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    // A context closed mid-request has already settled the route; answering it then is not a failure.
    const json = (data, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(data) }).catch(() => {});
    if (url.pathname.includes('/auth/v1/token')) return json({ access_token: jwt, refresh_token: 'local-test-refresh', token_type: 'bearer', expires_in: 3600, user });
    if (url.pathname.includes('/auth/v1/user')) return json(user);
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') {
      if (request.method() !== 'GET') writes.push(`${request.method()} ${url.hostname}${url.pathname}`);
      return json([]); // Never call production services.
    }
    if (url.pathname.startsWith('/api/auth/profile')) return json({ success: true, profile: { user_id: userId, role, name: 'UI test', assigned_machines: [], is_active: true, language, theme_mode: 'light' } });
    if (url.pathname === '/api/factory-context') return json({ success: true, current: { id: factory, code: 'ALT' }, available: [], canSwitch: false });
    if (extraRoutes) { const r = await extraRoutes(url, request, json); if (r !== undefined) return r; }
    if (url.pathname.startsWith('/api/layout-planning/')) {
      if (role === 'operator') return json({ success: false, code: 'forbidden' }, 403);
      if (noGeometry && url.pathname === '/api/layout-planning/workspace') return json({ success: true, factory: { id: factory, code: 'ALV' }, geometry: null, snapshot: { status: 'available', models: [], machines: [] }, plans: [], mappings: [] });
      if (failTransition && url.pathname.includes('/setup-tasks/')) return json({ success: false, code: 'boom' }, 500);
      const body = request.postData() ? JSON.parse(request.postData()) : null;
      if (request.method() !== 'GET') server.state.writes.push(`${request.method()} ${url.pathname}`);
      const handled = server.handle(request.method(), url.pathname, body);
      if (handled) return json(handled[1], handled[0]);
    }
    if (url.pathname.startsWith('/api/')) {
      if (request.method() !== 'GET') writes.push(`${request.method()} ${url.pathname}`);
      return json({ success: true, settings: [], alerts: [], machines: [], data: [] });
    }
    return route.continue().catch(() => {});
  });
  await page.goto(root + '/layout-studio');
  await page.locator('input[autocomplete="email"]').waitFor({ timeout: 120000 }); // first dev hit compiles the route
  await page.locator('input[autocomplete="email"]').fill(user.email);
  await page.locator('input[type="password"]').fill('local-ui-test');
  await page.locator('button[type="submit"]').click();
  await page.waitForTimeout(1000);
  return { context, page, errors, writes, server };
}
const ready = page => page.waitForFunction(() => window.__layoutStudio && document.querySelectorAll('.layout-studio .machine').length > 0, null, { timeout: 120000 });
const state = page => page.evaluate(() => window.__layoutStudio.state());

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    // ── Map, editing, persistence, alerts (preview scenarios in DB mode) ──────────────────────────
    {
      const { context, page, errors, writes, server } = await openApp(browser);
      await page.goto(root + '/layout-studio');
      await ready(page);
      await page.waitForFunction(() => document.querySelectorAll('.layout-studio .machine').length === 448);
      const L = sel => page.locator(S(sel));
      const search = async value => { await L('#search').fill(String(value)); await L('#searchForm button').click(); };
      const noOverflow = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
      const planId = server.state.plans[0].id;
      const assignmentOf = n => server.state.assignments.get(planId).find(a => a.machine_id === server.byNo(n).id);
      const settled = () => page.waitForFunction(() => !/저장 중|Đang lưu/.test(document.querySelector('.layout-studio #saveStatus').textContent));

      await check('800 machines from the app sit on their Excel cells with their CNC numbers', async () => {
        const data = await page.evaluate(() => window.__layoutStudio.data);
        assert.equal(data.machines.length, 800);
        assert.equal(new Set(data.machines.map(m => m.id)).size, 800);
        const sheet = XLSX.readFile(sourceXlsx).Sheets.W39;
        for (const m of data.machines) {
          assert.equal(sheet[m.cell].v, m.id);
          assert.equal(m.building, m.id <= 448 ? 'B' : 'A');
        }
        const src = new Map(layout.machines.map(m => [m.id, m]));
        assert.ok(data.machines.every(m => src.get(m.id).x === m.x && src.get(m.id).y === m.y));
        assert.equal(data.machines.filter(m => m.process === 'C0').length, 21);
      });
      await check('The recommended layout opens first: 6 recommended moves, labelled, compare shows them', async () => {
        const s = await state(page);
        assert.equal(Object.keys(s.draft.edits).length, 6);
        assert.equal(await L('#demoBadge').isVisible(), true);
        assert.match(await L('h1').innerText(), /Layout 배치/);
        await L('[data-mode="compare"]').click();
        assert.match(await L('.machine[data-id="305"]').getAttribute('aria-label'), /ON1-C1/);
        await L('[data-mode="draft"]').click();
      });
      await check('A/B and all-building navigation', async () => {
        await L('[data-building="A"]').click(); assert.equal(await L('.machine').count(), 352);
        await L('[data-building="all"]').click(); assert.equal(await L('.machine').count(), 800);
        await L('#fit').click();
        await page.screenshot({ path: path.join(output, 'overview.png'), fullPage: true });
      });
      await check('Search switches building and focuses the exact machine', async () => {
        await search('CNC-449'); assert.equal((await state(page)).building, 'A'); assert.equal((await state(page)).selected, 449);
        assert.match(await L('#selectedLocation').innerText(), /B43/);
        await search(305); assert.equal((await state(page)).building, 'B');
        await search(999); assert.equal((await state(page)).selected, 305);
      });
      await check('Zoom, pan, wheel and keyboard; dragging never selects machine labels', async () => {
        let before = await state(page); await L('#zoomIn').click(); assert.ok((await state(page)).scale > before.scale);
        before = await state(page); await L('#zoomOut').click(); assert.ok((await state(page)).scale < before.scale);
        await L('#stage').focus(); before = await state(page); await page.keyboard.press('+'); assert.ok((await state(page)).scale > before.scale);
        const box = await L('#stage').boundingBox(); before = await state(page);
        await page.mouse.move(box.x + 220, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x + 300, box.y + 250, { steps: 8 }); await page.mouse.up();
        assert.ok(Math.abs((await state(page)).tx - before.tx) > 40);
        assert.equal(await L('#stage').evaluate(e => getComputedStyle(e).userSelect), 'none');
        assert.equal(await page.evaluate(() => window.getSelection().toString()), '');
        const scrollBefore = await page.evaluate(() => scrollY);
        before = await state(page); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.wheel(0, -300); await page.waitForTimeout(100);
        assert.ok((await state(page)).scale > before.scale);
        assert.equal(await page.evaluate(() => scrollY), scrollBefore);
        await search(305);
      });
      await check('CAPA alerts: shortage / surplus / not-computable totals and rows, and the selected machine\'s group', async () => {
        assert.match(await L('#alertTotals').innerText(), /부족 2/);
        assert.match(await L('#alertTotals').innerText(), /여유 3/);
        assert.match(await L('#alertTotals').innerText(), /계산 불가 1/);
        // Alert rows stack vertically (one per line), not squeezed into one row.
        const tops = await L('.alert-row').evaluateAll(els => els.map(e => e.getBoundingClientRect().top));
        assert.ok(tops.length >= 2 && tops[1] > tops[0], JSON.stringify(tops));
        const rows = await L('.alert-row').allInnerTexts();
        assert.match(rows[0], /ON1-C1[\s\S]*부족 2대/);
        await search(305);
        assert.match(await L('#groupAlert').innerText(), /ON1-C1 · 필요 \d+ \/ 배정 \d+ · 부족 2대/);
        await L('.alert-row[data-model="M3"]').click();
        assert.equal(await page.locator(S('#modelFilter')).inputValue(), 'M3');
        await page.selectOption(S('#modelFilter'), '');
      });
      await check('Fine-tune saves to the server with the machine\'s uuid; lock, undo and redo too; alerts recompute', async () => {
        await search(305);
        await page.selectOption(S('#editModel'), 'PA1'); await page.selectOption(S('#editProcess'), 'C2'); await L('#applyEdit').click();
        await settled();
        assert.equal(assignmentOf(305).final_model_id, server.model('PA1').id);
        assert.equal(assignmentOf(305).final_process_id, server.proc('PA1', 'C2'));
        assert.match(await L('#alertTotals').innerText(), /부족 3/);        // ON1-C1 lost the machine
        await L('#lock').click(); await settled(); await page.waitForTimeout(200);
        assert.equal(assignmentOf(305).is_locked, true); assert.ok(await L('#applyEdit').isDisabled());
        await L('#undo').click(); await settled(); await page.waitForTimeout(200); assert.equal(assignmentOf(305).is_locked, false);
        await L('#undo').click(); await settled(); await page.waitForTimeout(200); assert.equal(assignmentOf(305).final_model_id, server.model('ON1').id);
        await L('#redo').click(); await settled(); await page.waitForTimeout(200); assert.equal(assignmentOf(305).final_model_id, server.model('PA1').id);
      });
      await check('Model-specific process choices: H8M offers CNC 0/1/2, ON1 only CNC 1/2', async () => {
        await search(1);
        await page.selectOption(S('#editModel'), 'H8M');
        assert.deepEqual(await page.locator(S('#editProcess option')).allInnerTexts(), ['CNC 0', 'CNC 1', 'CNC 2']);
        await page.selectOption(S('#editModel'), 'ON1');
        assert.deepEqual(await page.locator(S('#editProcess option')).allInnerTexts(), ['CNC 1', 'CNC 2']);
        await search(305);
      });
      await check('Original, draft, compare and model filter', async () => {
        await L('[data-mode="current"]').click(); assert.match(await L('.machine[data-id="305"]').getAttribute('aria-label'), /B6S6-C1/);
        await L('[data-mode="compare"]').click(); assert.match(await L('.machine[data-id="305"]').getAttribute('aria-label'), /PA1-C2/);
        await page.selectOption(S('#modelFilter'), 'PA1'); assert.equal(await L('.machine[data-id="305"]').evaluate(e => e.classList.contains('dim')), false);
        await page.selectOption(S('#modelFilter'), '');
      });
      await check('Reload restores the server draft; reset and "back to recommendation" are saved too', async () => {
        await page.reload(); await ready(page);
        assert.equal((await state(page)).draft.edits['305'].model, 'PA1');
        await L('#reset').click(); await L('#confirmReset').click(); await settled(); await page.waitForTimeout(200);
        assert.deepEqual((await state(page)).draft.edits, {});
        assert.equal(assignmentOf(305).final_model_id, assignmentOf(305).base_model_id);
        await L('#demo').click(); await settled(); await page.waitForTimeout(200);
        assert.equal(Object.keys((await state(page)).draft.edits).length, 6);
        assert.equal(assignmentOf(305).final_model_id, server.model('ON1').id);
      });
      await check('A concurrent save is detected (409): the user is told and the plan reloads from the server', async () => {
        server.state.conflictNext = true;
        await search(1); await page.selectOption(S('#editModel'), 'M1'); await L('#applyEdit').click();
        await page.waitForSelector('[data-testid="studio-notice"]');
        assert.match(await page.locator('[data-testid="studio-notice"]').innerText(), /다른 사용자가 먼저 저장/);
        await ready(page);
        assert.equal((await state(page)).draft.edits['1'], undefined);
        await page.locator('[data-testid="studio-notice"] .ant-alert-close-icon').click();
      });
      await check('JSON export marks the plan as capacity-validated', async () => {
        const waitDownload = page.waitForEvent('download'); await L('#export').click(); const dl = await waitDownload;
        const file = path.join(output, 'verified-draft.json'); await dl.saveAs(file);
        const json = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(json.previewOnly, false); assert.equal(json.capacityValidated, true); assert.equal(json.edits.length, 6);
        await page.waitForTimeout(3400);
        await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
      });
      await check('Korean and Vietnamese UI (follows the app header language switch live, without remounting)', async () => {
        await L('#zoomIn').click();
        const before = await state(page);
        await page.locator('header .anticon-global').first().click(); await page.getByText('Tiếng Việt').click();
        await page.waitForFunction(() => window.__layoutStudio.state().lang === 'vi');
        assert.match(await L('h1').innerText(), /Bố trí Layout/); assert.match(await L('#alertTotals').innerText(), /Thiếu/);
        assert.equal((await state(page)).scale, before.scale);
        await page.locator('header .anticon-global').first().click(); await page.getByText('한국어').click();
        await page.waitForFunction(() => window.__layoutStudio.state().lang === 'ko');
      });
      await check('Chrome follows the app theme; dark mode darkens the chrome but the map stays light', async () => {
        const colours = () => page.evaluate(() => {
          const q = s => getComputedStyle(document.querySelector('.layout-studio ' + s));
          const r = getComputedStyle(document.querySelector('.layout-studio'));
          return { primary: r.getPropertyValue('--ls-primary').trim(), save: q('#save').backgroundColor, workspace: q('.workspace').backgroundColor, stage: q('#stage').backgroundColor };
        });
        const rgb = hex => { const n = parseInt(hex.replace('#', '').slice(0, 6), 16); return `rgb(${n >> 16 & 255}, ${n >> 8 & 255}, ${n & 255})`; };
        const light = await colours();
        assert.equal(light.save, rgb(light.primary)); assert.equal(light.stage, 'rgb(246, 248, 251)');
        await page.locator('header .anticon-moon').first().click();
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.layout-studio .workspace')).backgroundColor !== 'rgb(255, 255, 255)');
        const dark = await colours();
        const lum = c => { const [r, g, b] = c.match(/\d+/g).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
        assert.ok(lum(dark.workspace) < 0.25); assert.equal(dark.stage, 'rgb(246, 248, 251)');
        await page.screenshot({ path: path.join(output, 'desktop-dark.png'), fullPage: true });
        await page.locator('header .anticon-sun').first().click();
        await page.waitForFunction(() => getComputedStyle(document.querySelector('.layout-studio .workspace')).backgroundColor === 'rgb(255, 255, 255)');
      });
      await check('390px and 360px mobile: no overflow, selection remains visible, editor closes', async () => {
        await search(305); await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
        const inside = await L('.machine[data-id="305"]').evaluate(e => { const r = e.getBoundingClientRect(), s = document.querySelector('.layout-studio #stage').getBoundingClientRect(); return r.x >= s.x && r.right <= s.right; });
        assert.equal(inside, true);
        await L('#closePanel').click(); assert.equal(await noOverflow(), true);
        await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
        await search(305); assert.ok(await L('.inspector').isVisible());
        await page.screenshot({ path: path.join(output, 'mobile-editor.png'), fullPage: true });
        await L('#closePanel').click(); await page.setViewportSize({ width: 360, height: 800 }); await page.waitForTimeout(300);
        assert.equal(await noOverflow(), true);
        await page.screenshot({ path: path.join(output, 'mobile-360.png'), fullPage: true });
        await page.setViewportSize({ width: 1440, height: 1100 }); await page.waitForTimeout(300);
      });
      await check('Two-pointer pinch changes zoom without changing assignments', async () => {
        const before = await state(page);
        await page.evaluate(() => { const s = document.querySelector('.layout-studio #stage'), r = s.getBoundingClientRect(); const send = (type, pid, x, y) => s.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: pid, pointerType: 'touch', clientX: r.x + x, clientY: r.y + y })); send('pointerdown', 10, 110, 150); send('pointerdown', 11, 210, 150); send('pointermove', 11, 250, 150); send('pointerup', 10, 110, 150); send('pointerup', 11, 250, 150); });
        const after = await state(page); assert.ok(after.scale > before.scale); assert.deepEqual(after.draft, before.draft);
      });
      await check('Confirm: dialog states the changes and the remaining shortage; plan becomes confirmed and read-only in setup view', async () => {
        await L('#confirmLayout').click();
        assert.match(await L('#confirmText').innerText(), /6대/);
        assert.match(await L('#confirmShortage').innerText(), /2대가 부족/);
        await L('#confirmLayoutGo').click();
        await page.waitForSelector('[data-testid="studio-notice"]');
        assert.match(await page.locator('[data-testid="studio-notice"]').innerText(), /6대/);
        await ready(page);
        assert.equal((await state(page)).mode, 'setup');
        assert.equal(server.state.plans[0].status, 'confirmed');
        assert.equal(server.state.tasks.length, 6);
        assert.ok(await L('#applyEdit').isDisabled()); assert.ok(await L('#confirmLayout').isDisabled());
        // Read-only: no editing actions offered, and the notice says so.
        for (const id of ['#demo', '#save', '#reset']) assert.equal(await L(id).isVisible(), false);
        assert.match(await L('.notice').innerText(), /읽기 전용/);
      });
      await check('Setup: start then complete one machine through the server; order is enforced; state survives reload', async () => {
        await search(305);
        assert.equal(await L('#setupComplete').isVisible(), false);
        await L('#setupStart').click(); await page.waitForFunction(() => window.__layoutStudio.state().setup.tasks['305'].status === 'in_progress');
        await L('#setupComplete').click(); await page.waitForFunction(() => window.__layoutStudio.state().setup.tasks['305'].status === 'completed');
        assert.equal(server.state.tasks.find(t => t.machine_id === server.byNo(305).id).status, 'completed');
        assert.match(await L('#setupCounts').innerText(), /완료 1/);
        await page.selectOption(S('#setupFilter'), 'completed');
        assert.equal(await L('.machine:not(.dim)[data-setup="completed"]').count(), 1);
        await page.reload(); await ready(page);
        await L('[data-mode="setup"]').click(); await search(305);
        assert.match(await L('#setupState').innerText(), /완료/);
        await page.waitForTimeout(3400); await page.screenshot({ path: path.join(output, 'setup-desktop.png'), fullPage: true });
      });
      await check('No JavaScript errors; the only writes are layout-planning calls (and the shell preference save)', async () => {
        assert.deepEqual(errors, []);
        assert.deepEqual(studioWrites(writes), []);
        assert.ok(server.state.writes.every(w => /^(PATCH|POST) \/api\/layout-planning\//.test(w)));
      });
      await context.close();
    }

    // ── Setup failure is not shown as success ─────────────────────────────────────────────────────
    {
      const server = makeServer();
      const planId = server.state.plans[0].id;
      server.state.plans[0].status = 'confirmed';
      server.state.tasks.push({ id: uid('50000000', 1), plan_id: planId, machine_id: server.byNo(316).id, status: 'pending', revision: 1, before_model_id: null, before_process_id: null, target_model_id: server.model('ON1').id, target_process_id: server.proc('ON1', 'C2'), created_at: new Date().toISOString(), started_at: null, completed_at: null });
      const { context, page, errors } = await openApp(browser, { server, failTransition: true, viewport: { width: 360, height: 800 } });
      await page.goto(root + '/layout-studio'); await ready(page);
      await check('A failed setup save does not mark the machine started (360px)', async () => {
        await page.locator(S('[data-mode="setup"]')).click();
        await page.locator(S('#search')).fill('316'); await page.locator(S('#searchForm button')).click();
        await page.locator(S('#setupStart')).click(); await page.waitForTimeout(800);
        assert.equal((await state(page)).setup.tasks['316'].status, 'pending');
        assert.match(await page.locator(S('#toast')).innerText(), /실패/);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        await page.screenshot({ path: path.join(output, 'setup-mobile.png'), fullPage: true });
        assert.deepEqual(errors, []);
      });
      await context.close();
    }

    // ── States: no drawing, no plan, roles ────────────────────────────────────────────────────────
    {
      const { context, page } = await openApp(browser, { noGeometry: true });
      await page.goto(root + '/layout-studio');
      await check('A factory without a drawing (ALV for now) shows the no-drawing state, not a broken map', async () => {
        await page.waitForSelector('[data-testid="layout-no-geometry"]', { timeout: 120000 });
        assert.match(await page.locator('[data-testid="layout-no-geometry"]').innerText(), /ALV/);
        assert.equal(await page.locator('.layout-studio .machine').count(), 0);
      });
      await context.close();
    }
    {
      const { context, page } = await openApp(browser, { server: makeServer({ withPlan: false }) });
      await page.goto(root + '/layout-studio'); await ready(page);
      await check('Without a plan the current layout is shown read-only with a way to the Forecast screen', async () => {
        assert.deepEqual((await state(page)).draft.edits, {});
        assert.ok(await page.locator(S('#applyEdit')).isDisabled());
        assert.ok(await page.locator(S('#confirmLayout')).isDisabled());
        assert.ok(await page.getByRole('button', { name: /Forecast 에서 새 추천 만들기/ }).isVisible());
      });
      await context.close();
    }
    for (const role of ['engineer', 'operator']) {
      const { context, page } = await openApp(browser, { role });
      await page.goto(root + '/layout-studio');
      if (role === 'operator') {
        await page.waitForTimeout(1500);
        await check('Operator cannot open Layout Studio', async () => { assert.equal(await page.locator('.layout-studio .machine').count(), 0); });
      } else {
        await check('Engineer can open Layout Studio and edit the draft', async () => { await ready(page); assert.equal(await page.locator(S('#applyEdit')).isDisabled(), false); });
      }
      await context.close();
    }

    // ── Forecast screen → model pairing → plan ────────────────────────────────────────────────────
    {
      const server = makeServer({ withPlan: false });
      const preview = parseForecastFile(fs.readFileSync(forecastXlsx));
      let planPosts = 0; let mappingsPut = null;
      const extraRoutes = async (url, request, json) => {
        if (url.pathname === '/api/forecasts/preview') {
          return json({ success: true, preview: { ...preview, factory: { id: factory, code: 'ALT' }, fileName: 'forecast.xlsx', capacityPolicy: { status: 'available', source: 'oee_settings', timezone: 'Asia/Ho_Chi_Minh', shiftAStart: '08:00', shiftBStart: '20:00', breakMinutes: 110, separateEfficiencyMultiplier: false }, capacitySnapshot: server.handle('GET', '/api/layout-planning/workspace')[1].snapshot } });
        }
        if (url.pathname === '/api/layout-planning/plans' && request.method() === 'POST') {
          planPosts++;
          const body = JSON.parse(request.postData());
          if (planPosts === 1) return json({ success: false, code: 'unmapped_models', detail: { models: [body.demands.find(d => d.peakQuantity > 0).model] } }, 422);
          server.newPlan('40000000-0000-4000-8000-000000000009', body.title);
          return json({ success: true, planId: '40000000-0000-4000-8000-000000000009', unresolved: [], unmapped: [] }, 201);
        }
        if (url.pathname === '/api/layout-planning/model-mappings') {
          if (request.method() === 'PUT') mappingsPut = JSON.parse(request.postData());
          return json({ success: true, mappings: [] });
        }
        return undefined;
      };
      const { context, page } = await openApp(browser, { server, extraRoutes });
      await page.goto(root + '/forecast');
      await check('Forecast → "create layout plan" → unmapped models open the pairing dialog → saved → plan opens in the studio', async () => {
        await page.waitForFunction(() => { const i = document.querySelector('input[type="file"]'); return i && !i.disabled; }, null, { timeout: 120000 });
        await page.locator('input[type="file"]').setInputFiles(forecastXlsx);
        await page.getByRole('button', { name: /파일 검증/ }).first().click();
        await page.waitForSelector('[data-testid="create-layout-plan"]', { timeout: 60000 });
        await page.locator('[data-testid="create-layout-plan"]').click();
        await page.waitForSelector('.ant-modal [data-testid="save-model-mappings"]');
        assert.ok(await page.locator('.ant-modal').getByText('지정 필요').first().isVisible());
        const firstRow = page.locator('.ant-modal .ant-table-row').first();
        await firstRow.locator('.ant-select').click();
        await page.locator('.ant-select-dropdown:visible .ant-select-item-option').first().click();
        await page.locator('.ant-modal [data-testid="save-model-mappings"]').click();
        await page.waitForURL(/\/layout-studio\?plan=40000000-0000-4000-8000-000000000009/, { timeout: 60000 });
        assert.ok(mappingsPut && mappingsPut.items.length >= 1);
        assert.equal(planPosts, 2);
        await ready(page);
        assert.equal(Object.keys((await state(page)).draft.edits).length, 6);
      });
      await context.close();
    }

    fs.writeFileSync(path.join(output, 'verification.json'), JSON.stringify({ result: 'PASS', mode: 'db', root, timestamp: new Date().toISOString(), checks, limitations: ['Auth, Supabase and /api/layout-planning/* are mocked in-browser; the server module and RPCs are covered by scripts/verify-layout-planning-local.cjs against local Supabase', 'Synthetic two-pointer test; physical touch-device testing not performed'] }, null, 2));
    console.log('ALL PASS:', checks.length, 'checks');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
