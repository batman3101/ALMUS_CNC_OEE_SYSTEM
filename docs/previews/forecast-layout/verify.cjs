// Run from the repository root; uses the existing local Playwright installation.
const { chromium } = require('C:/Users/USER/.agents/skills/gstack/node_modules/playwright');
const XLSX = require('xlsx');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const output = path.join(__dirname, 'screenshots');
const checks = [];
async function check(name, fn) { await fn(); checks.push(name); console.log('PASS:', name); }
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    const external = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', r => { if (!r.url().startsWith('http://127.0.0.1:8765')) external.push(r.url()); });
    page.setDefaultTimeout(10000);
    await page.goto('http://127.0.0.1:8765');
    await page.waitForFunction(() => window.previewState && document.querySelectorAll('.machine').length === 448);
    const state = () => page.evaluate(() => previewState());
    const search = async id => { await page.locator('#search').fill(String(id)); await page.locator('#searchForm button').click(); };
    await check('800 unique machines match the actual Excel cells; lower calculation table excluded', async () => {
      const data = await page.evaluate(() => LAYOUT_DATA);
      assert.equal(data.machines.length, 800);
      assert.equal(new Set(data.machines.map(m => m.id)).size, 800);
      const wb = XLSX.readFile('C:/Work Drive/APP/CNC OEE 참조파일/Setting CNC.xlsx');
      const sheet = wb.Sheets.W39;
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
      await page.locator('[data-building="A"]').click(); assert.equal(await page.locator('.machine').count(), 352);
      await page.locator('[data-building="all"]').click(); assert.equal(await page.locator('.machine').count(), 800);
      await page.locator('#fit').click();
      await page.screenshot({ path: path.join(output, 'overview.png'), fullPage: true });
    });
    await check('Search switches building and focuses the exact machine', async () => {
      await search('CNC-449'); assert.equal((await state()).building, 'A'); assert.equal((await state()).selected, 449);
      assert.match(await page.locator('#selectedLocation').innerText(), /B43/);
      await search(305); assert.equal((await state()).building, 'B');
      await search(999); assert.equal((await state()).selected, 305);
    });
    await check('Zoom, pan and keyboard navigation', async () => {
      let before = await state(); await page.locator('#zoomIn').click(); assert.ok((await state()).scale > before.scale);
      before = await state(); await page.locator('#zoomOut').click(); assert.ok((await state()).scale < before.scale);
      await page.locator('#stage').focus(); before = await state(); await page.keyboard.press('+'); assert.ok((await state()).scale > before.scale);
      const box = await page.locator('#stage').boundingBox(); before = await state();
      await page.mouse.move(box.x + 220, box.y + 200); await page.mouse.down(); await page.mouse.move(box.x + 300, box.y + 250, { steps: 8 }); await page.mouse.up();
      assert.ok(Math.abs((await state()).tx - before.tx) > 40);
      await search(305);
    });
    await check('Manual editing, lock, undo and redo', async () => {
      await page.selectOption('#editModel', 'PA1'); await page.selectOption('#editProcess', 'C2'); await page.locator('#applyEdit').click();
      assert.deepEqual((await state()).draft.edits['305'], { model: 'PA1', process: 'C2' });
      await page.locator('#lock').click(); assert.ok(await page.locator('#applyEdit').isDisabled());
      await page.locator('#undo').click(); assert.equal(await page.locator('#applyEdit').isDisabled(), false);
      await page.locator('#undo').click(); assert.equal((await state()).draft.edits['305'], undefined);
      await page.locator('#redo').click(); assert.equal((await state()).draft.edits['305'].model, 'PA1');
    });
    await check('Original, draft, compare and model filter', async () => {
      await page.locator('[data-mode="current"]').click(); assert.match(await page.locator('.machine[data-id="305"]').getAttribute('aria-label'), /B6S6-C1/);
      await page.locator('[data-mode="compare"]').click(); assert.match(await page.locator('.machine[data-id="305"]').getAttribute('aria-label'), /PA1-C2/);
      await page.selectOption('#modelFilter', 'PA1'); assert.equal(await page.locator('.machine[data-id="305"]').evaluate(e => e.classList.contains('dim')), false);
      await page.selectOption('#modelFilter', '');
    });
    await check('Persistence and reset with recoverable history', async () => {
      await page.locator('#save').click(); await page.reload(); await page.waitForFunction(() => window.previewState);
      assert.equal((await state()).draft.edits['305'].model, 'PA1');
      await page.locator('#reset').click(); await page.locator('#confirmReset').click(); assert.deepEqual((await state()).draft.edits, {});
      await page.locator('#undo').click(); assert.equal((await state()).draft.edits['305'].model, 'PA1');
      await page.locator('#reset').click(); await page.locator('#confirmReset').click();
    });
    await check('Sample changes are labeled, six edits, and production apply is disabled', async () => {
      await page.locator('#demo').click(); assert.equal(Object.keys((await state()).draft.edits).length, 6);
      assert.equal(await page.locator('#demoBadge').isVisible(), true);
      assert.equal(await page.locator('.review-box button').isDisabled(), true);
      await page.waitForTimeout(3400);
      await page.screenshot({ path: path.join(output, 'desktop.png'), fullPage: true });
    });
    await check('JSON export preserves provenance and marks data as an unvalidated preview', async () => {
      const waitDownload = page.waitForEvent('download'); await page.locator('#export').click(); const dl = await waitDownload;
      const file = path.join(output, 'verified-draft.json'); await dl.saveAs(file);
      const json = JSON.parse(fs.readFileSync(file, 'utf8')); assert.equal(json.previewOnly, true); assert.equal(json.capacityValidated, false); assert.equal(json.edits.length, 6);
    });
    await check('Korean and Vietnamese UI', async () => {
      await page.selectOption('#language', 'vi'); assert.equal(await page.locator('html').getAttribute('lang'), 'vi');
      assert.match(await page.locator('h1').innerText(), /Giữ bố trí/); assert.match(await page.locator('#applyEdit').innerText(), /Cập nhật/);
      await page.selectOption('#language', 'ko');
    });
    await check('390px and 360px mobile: no overflow, selection remains visible, editor closes', async () => {
      await search(305); await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150);
      const inside = await page.locator('.machine[data-id="305"]').evaluate(e => { const r=e.getBoundingClientRect(),s=document.querySelector('#stage').getBoundingClientRect(); return r.x >= s.x && r.right <= s.right; });
      assert.equal(inside, true);
      await page.locator('#closePanel').click();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.waitForTimeout(3400); await page.screenshot({ path: path.join(output, 'mobile.png'), fullPage: true });
      await search(305); assert.ok(await page.locator('.inspector').isVisible());
      await page.screenshot({ path: path.join(output, 'mobile-editor.png'), fullPage: true });
      await page.locator('#closePanel').click(); await page.setViewportSize({ width: 360, height: 800 });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(output, 'mobile-360.png'), fullPage: true });
    });
    await check('Two-pointer pinch changes zoom without changing assignments', async () => {
      const before = await state();
      await page.evaluate(() => { const s=document.querySelector('#stage'),r=s.getBoundingClientRect();const send=(type,id,x,y)=>s.dispatchEvent(new PointerEvent(type,{bubbles:true,pointerId:id,pointerType:'touch',clientX:r.x+x,clientY:r.y+y}));send('pointerdown',10,110,150);send('pointerdown',11,210,150);send('pointermove',11,250,150);send('pointerup',10,110,150);send('pointerup',11,250,150); });
      const after = await state(); assert.ok(after.scale > before.scale); assert.deepEqual(after.draft, before.draft);
    });
    await check('No JavaScript errors and no external/production calls', async () => { assert.deepEqual(errors, []); assert.deepEqual(external, []); });
    await context.close();
    fs.writeFileSync(path.join(__dirname, 'verification.json'), JSON.stringify({ result:'PASS', timestamp:new Date().toISOString(),checks,limitations:['Static UI prototype, no CAPA/AI/production DB integration','Synthetic two-pointer test; physical touch-device testing not performed'] }, null, 2));
    console.log('ALL PASS:', checks.length, 'checks');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
