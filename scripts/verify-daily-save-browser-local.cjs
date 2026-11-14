/* 일일 생산 저장 종단(E2E) 검증 — 로컬 Supabase + 로컬 개발 서버 전용 (감사 2026-11-14 F-02·F-03).
 *
 * 실제 화면(/data-input) → 실제 라우트 → 로컬 DB 의 save_daily_production_v2 까지 한 번에 본다.
 *   1. 관리자가 새 기록을 저장한다(지문 null → 성공).
 *   2. 같은 화면을 연 채 다른 곳에서 불량을 9 로 확정한다(DB 직접 갱신 = 마감 대기 표의 확정과 같은 효과).
 *   3. 낡은 화면에서 저장 → 409 경고 + 최신 기록 재조회, DB 불량은 9 그대로.
 *   4. 다시 불러온 화면에서 저장 → 성공.
 *   5. 가동시간 999,999분(F-03) → 400.  6. operator 토큰으로 일일 저장 → 403(F-02 권한).
 *   (2·3 은 한 항목으로 센다 — 합격 기준 5개)
 * KEEP_FIXTURE=1 이면 끝난 뒤 로컬 기록을 지우지 않는다(디버깅용).
 *
 * 준비:
 *   npx supabase@2 start && npx supabase@2 migration up --local
 *   NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=<로컬 anon> \
 *   SUPABASE_SERVICE_ROLE_KEY=<로컬 service> npx next dev --turbopack -p 3100
 * 실행:  node scripts/verify-daily-save-browser-local.cjs
 *   (APP_URL 기본 http://localhost:3100 — 127.0.0.1 은 개발 서버가 화면 파일을 403 으로 막는다)
 * 로컬 계정 sysadmin@example.com·alt-op@example.com 의 비밀번호를 실행마다 새로 정한다(로컬 전용).
 * 로컬이 아닌 Supabase 주소면 실행을 거부한다.
 */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'C:/Users/USER/.agents/skills/gstack/node_modules/playwright');

const SUPABASE = process.env.LOCAL_SUPABASE_URL || 'http://127.0.0.1:54321';
const SERVICE = process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'; // public local demo key
const ANON = process.env.LOCAL_SUPABASE_ANON_KEY
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'; // public local demo key
const APP = process.env.APP_URL || 'http://localhost:3100';
if (!['127.0.0.1', 'localhost'].includes(new URL(SUPABASE).hostname)) throw new Error('local Supabase only');
if (!['127.0.0.1', 'localhost'].includes(new URL(APP).hostname)) throw new Error('local app only');

const ALT = '00000000-0000-4000-8000-00000000a17e';
const ADMIN_EMAIL = 'sysadmin@example.com';
const OP_EMAIL = 'alt-op@example.com';
const MACHINE_NAME = 'CNC-001';
const results = [];
const pass = name => { results.push(name); console.log('PASS', name); };

const rest = async (pathAndQuery, init = {}) => {
  const res = await fetch(`${SUPABASE}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${pathAndQuery} ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
};
const authAdmin = async (pathPart, init) => {
  const res = await fetch(`${SUPABASE}/auth/v1/admin/${pathPart}`, {
    ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, 'Content-Type': 'application/json' },
  });
  if (!res.ok) throw new Error(`auth ${pathPart} ${res.status} ${await res.text()}`);
  return res.json();
};
const userId = async email => {
  const { users } = await authAdmin('users?per_page=200', { method: 'GET' });
  const user = users.find(u => u.email === email);
  if (!user) throw new Error(`local user missing: ${email}`);
  return user.id;
};
const signIn = async (email, password) => {
  const res = await fetch(`${SUPABASE}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`sign-in ${email}: ${JSON.stringify(body)}`);
  return body.access_token;
};
const todayInFactory = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' }).format(new Date());
const recordOf = async (machineId, date) =>
  (await rest(`production_records?machine_id=eq.${machineId}&date=eq.${date}&shift=eq.A&select=record_id,output_qty,defect_qty`))[0] ?? null;

(async () => {
  // ── 로컬 픽스처 ──────────────────────────────────────────────────────────────
  const adminPw = crypto.randomBytes(12).toString('hex');
  const opPw = crypto.randomBytes(12).toString('hex');
  const adminId = await userId(ADMIN_EMAIL);
  const opId = await userId(OP_EMAIL);
  await authAdmin(`users/${adminId}`, { method: 'PUT', body: JSON.stringify({ password: adminPw }) });
  await authAdmin(`users/${opId}`, { method: 'PUT', body: JSON.stringify({ password: opPw }) });
  const [machine] = await rest(`machines?factory_id=eq.${ALT}&name=eq.${MACHINE_NAME}&select=id,is_active`);
  assert.ok(machine?.is_active, 'local CNC-001 must be active');
  // 공장 소속이 먼저다 — 소속 없는 공장의 설비는 배정할 수 없다(DB 트리거).
  await rest('factory_memberships?on_conflict=user_id,factory_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ user_id: opId, factory_id: ALT, role: 'operator', is_active: true }),
  });
  await rest('user_profiles?on_conflict=user_id', {
    method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify({ user_id: opId, email: OP_EMAIL, name: 'Local Operator', role: 'operator', assigned_machines: [machine.id], is_active: true }),
  });
  const date = todayInFactory();
  await rest(`production_records?machine_id=eq.${machine.id}&date=eq.${date}`, { method: 'DELETE' });
  await rest(`production_shift_states?machine_id=eq.${machine.id}&date=eq.${date}`, { method: 'DELETE' });

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const dailyResponses = [];
  page.on('response', r => { if (r.url().includes('/api/production-records/daily')) { dailyResponses.push(r.status()); r.text().then(t => console.log('INFO daily', r.status(), t.slice(0, 300))).catch(() => {}); } });
  page.on('request', r => { if (r.url().includes('/api/production-records/daily')) console.log('INFO payload', (r.postData() || '').slice(0, 900)); });
  try {
    // ── 로그인 ─────────────────────────────────────────────────────────────────
    await page.goto(`${APP}/login`, { waitUntil: 'domcontentloaded', timeout: 180000 });
    await page.locator('input#email, input[id$="_email"]').first().fill(ADMIN_EMAIL, { timeout: 120000 });
    await page.locator('input[type="password"]').first().fill(adminPw);
    await page.locator('button[type="submit"]').first().click();
    await page.waitForURL(/dashboard/, { timeout: 180000 });

    const openForm = async () => {
      await page.goto(`${APP}/data-input`, { waitUntil: 'domcontentloaded', timeout: 180000 });
      const select = page.locator('.ant-select-selector').first();
      await select.click({ timeout: 120000 });
      await page.keyboard.type(MACHINE_NAME);
      await page.locator('.ant-select-item-option').filter({ hasText: MACHINE_NAME }).first().click();
      await page.locator('.ant-input-number-input').nth(3).waitFor({ timeout: 60000 });
      await page.waitForTimeout(1500); // 기존 기록·비가동 조회가 끝나 폼에 반영될 때까지
    };
    const fillDay = async (output, defect) => {
      // 순서: 주간 기준 가동시간, 야간 기준 가동시간, 주간 생산, 주간 불량, ...
      const inputs = page.locator('.ant-input-number-input');
      await inputs.nth(2).fill(String(output));
      await inputs.nth(3).fill(String(defect));
      await inputs.nth(3).press('Tab');
    };
    const clickSave = async label => {
      const before = dailyResponses.length;
      await page.locator('button').filter({ hasText: label }).last().click();
      for (let i = 0; i < 120 && dailyResponses.length === before; i++) await page.waitForTimeout(250);
      await page.waitForTimeout(400); // 응답 본문 로그가 찍힐 시간
      return dailyResponses[dailyResponses.length - 1];
    };

    // 1. 새 기록 저장 (지문 null)
    await openForm();
    await fillDay(100, 1);
    const firstStatus = await clickSave(/저장|Lưu|newRecord/);
    assert.equal(firstStatus, 200, 'first save should succeed');
    await page.waitForTimeout(800);
    let rec = await recordOf(machine.id, date);
    assert.equal(rec?.output_qty, 100); assert.equal(rec?.defect_qty, 1);
    pass('화면 새 기록 저장 → 200, DB 생산 100·불량 1');

    // 2·3. 화면을 연 뒤 다른 곳에서 불량 9 확정 → 낡은 화면 저장은 409, DB 는 9 유지
    await openForm();
    await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/daily-1-loaded.png` : undefined }).catch(() => {});
    await rest(`production_records?record_id=eq.${rec.record_id}`, { method: 'PATCH', body: JSON.stringify({ defect_qty: 9, quality: 0.91 }) });
    await fillDay(100, 2);
    const listCallsBefore = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.includes('/api/production-records?')).length);
    const staleStatus = await clickSave(/수정|업데이트|Cập nhật|updateData/);
    assert.equal(staleStatus, 409, 'stale save must be rejected');
    await page.waitForTimeout(1500);
    rec = await recordOf(machine.id, date);
    assert.equal(rec.defect_qty, 9, 'confirmed defect must survive');
    const warned = await page.locator('.ant-message').innerText().catch(() => '');
    assert.match(warned, /먼저 변경|thay đổi ở nơi khác/, 'warning toast expected: ' + warned);
    const listCallsAfter = await page.evaluate(() => performance.getEntriesByType('resource').filter(e => e.name.includes('/api/production-records?')).length);
    assert.ok(listCallsAfter > listCallsBefore, 'form should reload existing records');
    const shownDefect = await page.locator('.ant-input-number-input').nth(3).inputValue();
    assert.equal(shownDefect, '9', 'reloaded form shows the confirmed defect');
    await page.screenshot({ path: process.env.SHOT_DIR ? `${process.env.SHOT_DIR}/daily-2-conflict.png` : undefined }).catch(() => {});
    pass('낡은 화면 저장 → 409 경고·재조회, DB 확정 불량 9 유지, 화면에 9 표시');

    // 4. 다시 불러온 화면에서 저장 → 성공
    await fillDay(100, 4);
    const freshStatus = await clickSave(/수정|업데이트|Cập nhật|updateData/);
    assert.equal(freshStatus, 200);
    await page.waitForTimeout(800);
    rec = await recordOf(machine.id, date);
    assert.equal(rec.defect_qty, 4);
    pass('재조회 후 저장 → 200, DB 불량 4');

    // 5. F-03: 가동시간 999,999분 → 400 (같은 로그인 세션의 실제 요청)
    const adminToken = await signIn(ADMIN_EMAIL, adminPw);
    const post = async (token, body) => {
      const res = await fetch(`${APP}/api/production-records/daily`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body),
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    };
    const current = (await rest(`production_records?record_id=eq.${rec.record_id}&select=*`))[0];
    const fp = Object.fromEntries(['record_id', 'output_qty', 'defect_qty', 'planned_runtime', 'actual_runtime', 'ideal_runtime',
      'downtime_minutes', 'tact_time_seconds', 'availability', 'performance', 'quality', 'oee'].map(k => [k, current[k] === null ? null : (k === 'record_id' ? current[k] : Number(current[k]))]));
    const over = await post(adminToken, { machine_id: machine.id, date, day_shift_off: false, night_shift_off: false,
      day_shift: { actual_production: 100, defect_quantity: 4, operating_minutes: 999999 }, expected_records: { A: fp } });
    assert.equal(over.status, 400, JSON.stringify(over));
    const atMax = await post(adminToken, { machine_id: machine.id, date, day_shift_off: false, night_shift_off: false,
      day_shift: { actual_production: 100, defect_quantity: 4, operating_minutes: 720 }, expected_records: { A: fp } });
    assert.equal(atMax.status, 200, JSON.stringify(atMax));
    pass('가동시간 999,999분 → 400, 교대 길이 720분 → 200 (실제 서버·로컬 DB)');

    // 6. F-02 권한: operator 는 일일 저장(휴무=삭제) 불가
    const opToken = await signIn(OP_EMAIL, opPw);
    const opOff = await post(opToken, { machine_id: machine.id, date, day_shift_off: true, night_shift_off: false, expected_records: { A: null } });
    assert.equal(opOff.status, 403, JSON.stringify(opOff));
    assert.ok(await recordOf(machine.id, date), 'record must survive operator request');
    pass('operator 의 휴무(삭제) 요청 → 403, 기록 유지');
  } finally {
    await browser.close();
    if (!process.env.KEEP_FIXTURE) {
      await rest(`production_records?machine_id=eq.${machine.id}&date=eq.${date}`, { method: 'DELETE' }).catch(() => {});
      await rest(`production_shift_states?machine_id=eq.${machine.id}&date=eq.${date}`, { method: 'DELETE' }).catch(() => {});
    }
  }
  console.log(`\n${results.length}/5 통과`);
  if (results.length !== 5) process.exit(1);
})().catch(error => { console.error('FAIL', error.message); process.exit(1); });
