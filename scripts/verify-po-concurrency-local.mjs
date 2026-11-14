#!/usr/bin/env node
/**
 * 로컬 진짜 Postgres 로 동시 실행을 검증한다 (Codex 감사 PO-02 · 재감사 PAGE-01 후속, 2026-09-29).
 *
 * 무엇을 검증하나
 *  1) PO-02: 같은 칸(공장·접수·원본 행·날짜)에 두 요청이 동시에 '처음' 들어올 때 변경 이력이 맞는가.
 *     20260929130000(원본 함수)에서 결함을 재현하고, 20260929150000(칸 잠금)을 덧쓴 뒤 사라지는지 본다.
 *  2) PAGE-01: 여러 쪽에 걸친 조회 사이에 다른 세션이 행을 지우고 더하거나 정렬 값을 바꿔도(총개수 유지),
 *     src/lib/supabasePaging.ts 의 readAllRows 가 빠진 행이 있는 결과를 완전하다고 돌려주지 않는가.
 *     수정 전 버전(git PAGING_BEFORE_REV, 기본 eb359a7)과 현재 버전을 같은 실제 DB 에서 나란히 돌린다.
 *
 * 안전: 임시 폴더에 진짜 Postgres 서버를 띄우고 끝나면 지운다. 운영 DB·네트워크와 무관하다(127.0.0.1).
 * 단일 연결 엔진(PGlite)으로는 잠금 경합을 볼 수 없어서 진짜 서버가 필요하다.
 *
 * 준비 (저장소 밖 임시 폴더에 설치한다 - 저장소 package.json 을 건드리지 않는다):
 *   mkdir <임시폴더>/po-harness && cd <임시폴더>/po-harness && npm init -y && npm i embedded-postgres pg
 * 실행:
 *   node scripts/verify-po-concurrency-local.mjs --deps <임시폴더>/po-harness
 *   (--deps 를 생략하면 환경변수 PO_HARNESS_DEPS, 그것도 없으면 OS 임시 폴더의 po-harness 를 쓴다.
 *    PO_HARNESS_PORT 로 포트를 바꿀 수 있다. 기본 54329)
 * 종료 코드: 0 모두 통과 · 1 실패 있음 · 2 의존 패키지 없음
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const depsIndex = process.argv.indexOf('--deps');
const DEPS = depsIndex > 0 ? path.resolve(process.argv[depsIndex + 1]) : (process.env.PO_HARNESS_DEPS || path.join(os.tmpdir(), 'po-harness'));
const PORT = Number(process.env.PO_HARNESS_PORT || 54329);
const BEFORE_REV = process.env.PAGING_BEFORE_REV || 'eb359a7';
const CR = String.fromCharCode(13);
// 임시 서버 전용 비밀번호 - 실행마다 새로 만들어 저장소에 비밀번호 리터럴을 두지 않는다(noHardcodedCredentials 규약).
const DB_PASSWORD = randomBytes(12).toString('hex');

/** 의존 패키지를 DEPS/node_modules 에서 불러온다(ESM 전용 패키지도 진입점을 직접 읽어 file URL 로 import). */
async function loadDependency(name) {
  try {
    const dir = path.join(DEPS, 'node_modules', name);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    let entry = pkg.exports && typeof pkg.exports === 'object' ? pkg.exports['.'] : pkg.exports;
    if (entry && typeof entry === 'object') entry = entry.import || entry.default || entry.require;
    return await import(pathToFileURL(path.join(dir, entry || pkg.main || 'index.js')).href);
  } catch (error) {
    console.error('의존 패키지 ' + name + ' 를 ' + DEPS + ' 에서 불러오지 못했다: ' + error.message);
    console.error('준비: mkdir <임시폴더>/po-harness && cd <임시폴더>/po-harness && npm init -y && npm i embedded-postgres pg');
    process.exit(2);
  }
}
const { default: EmbeddedPostgres } = await loadDependency('embedded-postgres');
const pgModule = await loadDependency('pg');
const pg = pgModule.default || pgModule;
const ts = createRequire(import.meta.url)('typescript');

const dataDir = path.join(os.tmpdir(), 'po-harness-data-' + process.pid);
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: DB_PASSWORD, port: PORT, persistent: false, onLog: () => {}, onError: () => {} });
const ALT = '00000000-0000-4000-8000-00000000a17e';
const ACTOR = '00000000-0000-4000-8000-0000000000ac'; // 임시 서버 전용 가짜 사용자 - 실제 계정 값을 쓰지 않는다
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed += 1; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); };
const info = text => console.log('INFO ' + text);
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
const sqlOf = file => fs.readFileSync(path.join(REPO, 'supabase/migrations', file), 'utf8').split(CR).join('');
const connect = async () => {
  const client = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: DB_PASSWORD, database: 'race' });
  await client.connect();
  return client;
};

// ── PO-02 도우미 ────────────────────────────────────────────────────────────────────────────
let SID = null;
const applyOn = (client, row, qty) => client.query(
  'select public.apply_forecast_po_override($1::uuid,$2::uuid,$3::uuid,$4::int,$5::date,$6,$7::int,null,$8) as r',
  [ALT, SID, ACTOR, row, '2026-10-05', 'ON 1', qty, 'blank']).then(x => x.rows[0].r);
const revertOn = (client, row) => client.query(
  'select public.revert_forecast_po_override($1::uuid,$2::uuid,$3::uuid,$4::int,$5::date) as r',
  [ALT, SID, ACTOR, row, '2026-10-05']).then(x => x.rows[0].r);
const eventsOf = async (admin, row) => (await admin.query(
  'select action, quantity_before as b, quantity_after as a from public.forecast_po_override_events where source_row = $1 order by occurred_at, id', [row])).rows;
const show = rows => rows.map(r => r.action + ':' + r.b + '->' + r.a).join(' | ');

/** A 는 트랜잭션 안에서 첫 문장을 실행한 채 커밋하지 않고, B 는 그동안 들어온다. 800ms 뒤 A 를 커밋한다. */
async function race(a, b, first, second) {
  await a.query('BEGIN');
  const firstResult = await first(a);
  let done = false;
  const pending = second(b).then(r => { done = true; return r; });
  await settle(800);
  const blocked = !done;
  await a.query('COMMIT');
  return { firstResult, secondResult: await pending, blocked };
}

/** 같은 시나리오를 함수 정의만 바꿔 두 번 돌린다. base 는 칸(원본 행 번호) 시작값. */
async function poScenarios(label, base, expectFixed) {
  const admin = await connect();
  const a = await connect();
  const b = await connect();
  console.log('\n=== PO-02 · ' + label + ' ===');

  // S1: 처음 입력하는 칸에 두 요청이 동시에(A=100, B=200)
  const r1 = base + 1;
  const s1 = await race(a, b, cl => applyOn(cl, r1, 100), cl => applyOn(cl, r1, 200));
  const e1 = await eventsOf(admin, r1);
  info('S1 B가 기다렸나=' + s1.blocked + ' | 이력: ' + show(e1));
  const s1ok = e1.length === 2 && e1[1].b === 100 && e1[1].a === 200;
  if (expectFixed) check('S1 최초 동시 수정: 뒤 요청의 이전 값이 100(직전 값)으로 기록된다', s1ok, show(e1));
  else info('S1 결함 재현=' + (!s1ok ? 'YES (뒤 요청 이전 값이 ' + (e1[1] && e1[1].b) + ')' : 'no'));

  // S2: 같은 값(100)을 동시에 처음 적용
  const r2 = base + 2;
  const s2 = await race(a, b, cl => applyOn(cl, r2, 100), cl => applyOn(cl, r2, 100));
  const e2 = await eventsOf(admin, r2);
  info('S2 B 결과 unchanged=' + s2.secondResult.unchanged + ' | 이력: ' + show(e2));
  const s2ok = e2.length === 1 && s2.secondResult.unchanged === true;
  if (expectFixed) check('S2 같은 값 동시 최초 적용: 이벤트 1건, 뒤 요청은 unchanged', s2ok, show(e2));
  else info('S2 결함 재현=' + (!s2ok ? 'YES (이벤트 ' + e2.length + '건 중복)' : 'no'));

  // S4: 이미 행이 있는 칸의 동시 수정(A=200, B=300) - 원래도 맞아야 하고 수정 뒤에도 맞아야 한다
  const r4 = base + 4;
  await applyOn(admin, r4, 100);
  await race(a, b, cl => applyOn(cl, r4, 200), cl => applyOn(cl, r4, 300));
  const e4 = await eventsOf(admin, r4);
  check('S4 기존 행 동시 수정: 이력이 100→200→300 사슬(' + label + ')', e4.length === 3 && e4[1].b === 100 && e4[1].a === 200 && e4[2].b === 200 && e4[2].a === 300, show(e4));

  // S5: 다른 칸은 서로 기다리지 않는다(잠금이 칸 단위이지 전체가 아니다)
  const s5 = await race(a, b, cl => applyOn(cl, base + 5, 10), cl => applyOn(cl, base + 6, 20));
  check('S5 다른 칸의 동시 적용은 막히지 않는다(' + label + ')', s5.blocked === false && s5.secondResult.unchanged === false);
  await Promise.all([admin.end(), a.end(), b.end()]);
}

/** 이력이 한 줄로 이어지는가: before 가 이전 이벤트의 after 와 맞물려 null 에서 최종 값까지 사슬을 이룬다. */
function chainOk(rows, finalQty) {
  const left = rows.map(r => ({ b: r.b, a: r.a }));
  let current = null;
  for (;;) {
    const i = left.findIndex(r => r.b === current);
    if (i < 0) break;
    current = left[i].a;
    left.splice(i, 1);
  }
  return left.length === 0 && current === finalQty;
}

/** 12 개 연결이 같은 새 칸에 서로 다른 수량을 한꺼번에 넣는다. */
async function manyWay(label, row, expectFixed) {
  const admin = await connect();
  const clients = await Promise.all(Array.from({ length: 12 }, connect));
  await Promise.all(clients.map((cl, i) => applyOn(cl, row, 1000 + i)));
  const events = await eventsOf(admin, row);
  const fin = (await admin.query('select quantity from public.forecast_po_overrides where source_row = $1 and submission_id = $2', [row, SID])).rows[0].quantity;
  const ok = chainOk(events, fin);
  if (expectFixed) check('12개 동시 최초 적용: 이력이 null→…→최종값 한 사슬이다(' + label + ')', ok && events.length === 12, events.length + '건');
  else info('12개 동시 최초 적용 결함 재현=' + (!ok ? 'YES (이력 ' + events.length + '건이 한 사슬이 아님)' : 'no (이번 실행에서는 경합이 안 겹침)'));
  await Promise.all([admin.end(), ...clients.map(cl => cl.end())]);
}

/** 수정 뒤에만 확인하는 것: 적용·원복 직렬화, 접수 교체와 엉켜도 교착 없음. */
async function poFixedOnly(base) {
  const admin = await connect();
  const a = await connect();
  const b = await connect();
  const c = await connect();
  const r3 = base + 3;
  const s3 = await race(a, b, cl => applyOn(cl, r3, 100), cl => revertOn(cl, r3));
  const e3 = await eventsOf(admin, r3);
  check('S3 적용 중 같은 칸 원복: 기다렸다가 적용 뒤에 원복된다', s3.blocked && s3.secondResult.reverted === true && show(e3) === 'apply:null->100 | revert:100->null', show(e3));

  const r6 = base + 6;
  await a.query('BEGIN');
  await applyOn(a, r6, 10);
  const accept = c.query("update public.forecast_submissions set file_name = 'w41.xlsx' where factory_id = $1", [ALT]);
  const second = b.query('select public.apply_forecast_po_override($1::uuid,$2::uuid,$3::uuid,$4::int,$5::date,$6,5,null,$7) as r', [ALT, SID, ACTOR, r6, '2026-10-05', 'ON 1', 'blank']).then(() => 'ok', e => e.message);
  await settle(800);
  await a.query('COMMIT');
  const outcome = await Promise.race([Promise.all([accept, second]).then(v => 'done:' + v[1]), settle(8000).then(() => 'TIMEOUT(교착 의심)')]);
  check('S6 적용·접수 교체·같은 칸 요청이 엉켜도 교착 없이 끝난다(뒤 요청은 접수 변경으로 거부)', outcome.startsWith('done:') && outcome.includes('SUBMISSION_CHANGED'), outcome);
  SID = (await admin.query('select submission_id from public.forecast_submissions where factory_id = $1', [ALT])).rows[0].submission_id;
  await Promise.all([admin.end(), a.end(), b.end(), c.end()]);
}

// ── PAGE-01: 여러 쪽에 걸친 조회 사이의 동시 변경 ─────────────────────────────────────────────────
/** TypeScript 소스를 메모리에서 CommonJS 로 바꿔 실행한다(저장소 파일은 수정하지 않는다). */
function loadHelper(source) {
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const mod = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  return mod.exports;
}
function loadBeforeHelper() {
  try {
    return loadHelper(execFileSync('git', ['show', BEFORE_REV + ':src/lib/supabasePaging.ts'], { cwd: REPO, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  } catch {
    return null;
  }
}

const PAGE_SQL = 'select (select count(*)::int from page_rows) as total, '
  + "coalesce((select json_agg(x.id order by x.sort_key, x.id) from (select id, sort_key from page_rows order by sort_key, id offset $1 limit $2) x), '[]'::json) as ids";

async function pageScenarios(admin) {
  const current = loadHelper(fs.readFileSync(path.join(REPO, 'src/lib/supabasePaging.ts'), 'utf8'));
  const before = loadBeforeHelper();
  if (!before) info('수정 전 버전(' + BEFORE_REV + ')을 git 에서 읽지 못해 비교는 건너뛴다');
  const reader = await connect();
  const writer = await connect();
  console.log('\n=== PAGE-01 · 쪽 사이의 동시 변경 (읽기 세션과 쓰기 세션이 따로) ===');
  await admin.query('create table page_rows (id int primary key, sort_key int not null)');
  const seed = async ids => {
    await admin.query('truncate page_rows');
    for (const id of ids) await admin.query('insert into page_rows values ($1, $1)', [id]);
  };
  /** 한 쪽 = 한 문장(한 스냅샷: 개수와 행이 함께 온다). 다른 세션의 변경은 요청 사이에 실제로 커밋된다. */
  const source = hook => {
    let call = 0;
    return {
      calls: () => call,
      read: async (from, to) => {
        call += 1;
        await hook(call);
        const row = (await reader.query(PAGE_SQL, [from, to - from + 1])).rows[0];
        return { data: row.ids.map(id => ({ id })), error: null, count: row.total };
      },
    };
  };
  const run = async (helper, ids, hook, options) => {
    await seed(ids);
    const s = source(hook);
    try { return { ids: (await helper.readAllRows(s.read, options)).map(r => r.id), calls: s.calls() }; }
    catch (error) { return { error: error.reason || error.message, calls: s.calls() }; }
  };
  const json = value => JSON.stringify(value.ids || value.error);
  const options = { pageSize: 2, keyOf: row => String(row.id) };
  const swapRows = async call => {
    if (call !== 2) return;
    await writer.query('delete from page_rows where id = 1');
    await writer.query('insert into page_rows values (5, 5)');
  };
  const moveRow = async call => { if (call === 2) await writer.query('update page_rows set sort_key = 9 where id = 1'); };
  const slide = async () => {
    await writer.query('delete from page_rows where id = (select min(id) from page_rows)');
    await writer.query('insert into page_rows select max(id) + 1, max(id) + 1 from page_rows');
  };
  const nothing = async () => {};

  const a = await run(current, [1, 2, 3, 4], swapRows, options);
  check('A 쪽 사이에 1 삭제·5 추가(총개수 4 유지): 빠진 행 없이 [2,3,4,5]', json(a) === '[2,3,4,5]', json(a));
  if (before) { const old = await run(before, [1, 2, 3, 4], swapRows, options); info('A 수정 전 결과 ' + json(old) + ' -> 결함 재현=' + (json(old) !== '[2,3,4,5]')); }

  const b = await run(current, [1, 2, 3, 4], moveRow, options);
  check('B 쪽 사이에 한 행의 정렬 값이 바뀌어 경계를 넘어 이동: 중복·누락 없이 [2,3,4,1]', json(b) === '[2,3,4,1]', json(b));
  if (before) { const old = await run(before, [1, 2, 3, 4], moveRow, options); info('B 수정 전 결과 ' + json(old) + ' -> 결함 재현=' + (json(old) !== '[2,3,4,1]')); }

  const d = await run(current, [1, 2, 3, 4], slide, { pageSize: 2, attempts: 2 });
  check('D 읽는 내내 계속 바뀌면 틀린 결과를 돌려주지 않고 명시적으로 실패(changed)', d.error === 'changed', json(d));
  if (before) { const old = await run(before, [1, 2, 3, 4], slide, { pageSize: 2, attempts: 2 }); info('D 수정 전 결과 ' + json(old) + ' -> 조용히 통과=' + (!old.error)); }

  const c = await run(current, [1, 2, 3, 4, 5], nothing, { pageSize: 2 });
  check('C 안정된 데이터의 여러 쪽 읽기: 전부 읽고 요청은 쪽 수(3) x 2', json(c) === '[1,2,3,4,5]' && c.calls === 6, json(c) + ' calls=' + c.calls);
  const e = await run(current, [1, 2, 3], nothing, { pageSize: 10 });
  check('E 한 번의 요청으로 끝나는 읽기는 한 번만 읽는다', json(e) === '[1,2,3]' && e.calls === 1, json(e) + ' calls=' + e.calls);
  await Promise.all([reader.end(), writer.end()]);
}

async function main() {
  await server.initialise();
  await server.start();
  await server.createDatabase('race');
  const admin = await connect();
  console.log('엔진:', (await admin.query('select version() as v')).rows[0].v.slice(0, 40));
  await admin.query(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
    create table public.factories (id uuid primary key, code text not null);
    insert into public.factories values ('${ALT}', 'ALT');`);
  await admin.query(sqlOf('20260929100000_forecast_submissions.sql'));
  await admin.query("insert into public.forecast_submissions (factory_id, file_name, source_hash, parser_version, sheet, preview) values ('" + ALT + "', 'plan.xlsx', 'h1', 'almus-v1', 'CNC', '{}'::jsonb)");
  await admin.query(sqlOf('20260929130000_forecast_po_overrides.sql'));
  SID = (await admin.query('select submission_id from public.forecast_submissions where factory_id = $1', [ALT])).rows[0].submission_id;

  await poScenarios('원본 함수 (20260929130000)', 10, false);
  await manyWay('원본', 50, false);
  await admin.query(sqlOf('20260929150000_forecast_po_override_cell_lock.sql'));
  await poScenarios('칸 잠금 적용 (20260929150000)', 20, true);
  await manyWay('칸 잠금', 60, true);
  await poFixedOnly(20);
  await pageScenarios(admin);
  await admin.end();
}

try { await main(); } catch (error) { console.error('오류', error); failed += 1; }
finally {
  try { await server.stop(); } catch (error) { console.error('서버 종료 오류', error.message); }
  console.log(failed ? '\n실패 ' + failed + '건' : '\n전부 통과');
  process.exit(failed ? 1 : 0);
}
