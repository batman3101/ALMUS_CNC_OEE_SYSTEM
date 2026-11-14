#!/usr/bin/env node
/**
 * 일일 생산 저장(save_daily_production_v2)의 동시성을 로컬 진짜 Postgres 로 검증한다 (감사 2026-11-14 F-02).
 *
 * 무엇을 검증하나
 *  - 수정 전(v1): 화면이 읽은 뒤 다른 세션이 불량을 확정하면 v1 저장이 그 확정 불량을 조용히 덮어쓴다(결함 재현).
 *  - 수정 후(v2): 같은 경합에서 v2 는 잠금을 기다렸다가 record_changed 로 거부하고 아무것도 쓰지 않는다.
 *    "기록 없음"을 본 화면과 그 사이 생긴 기록, 낡은 화면의 휴무(=삭제), 비가동 원천 변경(source_changed)도 본다.
 *
 * 함수 본문은 저장소의 마이그레이션 파일에서 그대로 읽는다(v1 = 20260715160000, digest = 20260729210000,
 * v2 = 20261114100000). 표는 이 함수들이 쓰는 컬럼만 가진 최소 형태다.
 * 다른 세션의 쓰기는 마감·불량 확정 RPC 와 같은 advisory lock 키를 잡고 흉내 낸다(CLAUDE.md 잠금 규약).
 *
 * 안전: 임시 폴더에 진짜 Postgres 서버를 띄우고 끝나면 지운다. 운영 DB·네트워크와 무관하다(127.0.0.1).
 *
 * 준비 (저장소 밖 임시 폴더 — 저장소 package.json 을 건드리지 않는다. 운영과 같은 17.x 를 권장):
 *   mkdir <임시폴더>/po-harness && cd <임시폴더>/po-harness && npm init -y && npm i embedded-postgres@17.6.0-beta.15 pg
 * 실행:
 *   node scripts/verify-daily-save-concurrency-local.mjs --deps <임시폴더>/po-harness
 *   (--deps 생략 시 PO_HARNESS_DEPS, 그것도 없으면 OS 임시 폴더의 po-harness. 포트는 DAILY_HARNESS_PORT, 기본 54331)
 * 종료 코드: 0 모두 통과 · 1 실패 있음 · 2 의존 패키지 없음
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const depsIndex = process.argv.indexOf('--deps');
const DEPS = depsIndex > 0 ? path.resolve(process.argv[depsIndex + 1]) : (process.env.PO_HARNESS_DEPS || path.join(os.tmpdir(), 'po-harness'));
const PORT = Number(process.env.DAILY_HARNESS_PORT || 54331);
const CR = String.fromCharCode(13);
const DB_PASSWORD = randomBytes(12).toString('hex');

async function loadDependency(name) {
  try {
    const dir = path.join(DEPS, 'node_modules', name);
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    let entry = pkg.exports && typeof pkg.exports === 'object' ? pkg.exports['.'] : pkg.exports;
    if (entry && typeof entry === 'object') entry = entry.import || entry.default || entry.require;
    return await import(pathToFileURL(path.join(dir, entry || pkg.main || 'index.js')).href);
  } catch (error) {
    console.error('의존 패키지 ' + name + ' 를 ' + DEPS + ' 에서 불러오지 못했다: ' + error.message);
    process.exit(2);
  }
}
const { default: EmbeddedPostgres } = await loadDependency('embedded-postgres');
const pgModule = await loadDependency('pg');
const pg = pgModule.default || pgModule;

const dataDir = path.join(os.tmpdir(), 'daily-harness-data-' + process.pid);
const server = new EmbeddedPostgres({ databaseDir: dataDir, user: 'postgres', password: DB_PASSWORD, port: PORT, persistent: false, onLog: () => {}, onError: () => {} });
const MACHINE = '00000000-0000-4000-8000-0000000000a1';
const DATE = '2026-07-14';
const WINDOW_A = { start: '2026-07-14T01:00:00.000Z', end: '2026-07-14T13:00:00.000Z' };
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed += 1; console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : '  -> ' + detail)); };
const settle = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = file => fs.readFileSync(path.join(REPO, 'supabase/migrations', file), 'utf8').split(CR).join('');
const between = (text, startMarker, endMarker) => {
  const start = text.indexOf(startMarker);
  if (start < 0) throw new Error('marker not found: ' + startMarker);
  const end = text.indexOf(endMarker, start);
  return text.slice(start, end + endMarker.length);
};
const connect = async () => {
  const client = new pg.Client({ host: '127.0.0.1', port: PORT, user: 'postgres', password: DB_PASSWORD, database: 'daily' });
  await client.connect();
  return client;
};

const SCHEMA = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create table public.machines (id uuid primary key, is_active boolean not null default true);
create table public.production_records (
  record_id uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id), date date not null, shift text not null,
  planned_runtime integer, actual_runtime integer, ideal_runtime integer,
  output_qty integer, defect_qty integer,
  availability numeric, performance numeric, quality numeric, oee numeric,
  created_at timestamptz default now(), downtime_minutes integer, tact_time_seconds numeric, cavity_count integer,
  unique (machine_id, date, shift)
);
create table public.production_shift_states (
  machine_id uuid not null, date date not null, shift text not null, status text not null,
  updated_at timestamptz default now(), version integer not null default 1,
  unique (machine_id, date, shift)
);
create table public.machine_downtime_intervals (
  source text not null, source_id uuid not null default gen_random_uuid(), machine_id uuid not null,
  reason text, start_time timestamptz not null, end_time timestamptz
);
`;

const RECORD = { planned_runtime: 660, actual_runtime: 660, ideal_runtime: 200, output_qty: 100, defect_qty: 1,
  availability: 1, performance: 0.303, quality: 0.99, oee: 0.3, downtime_minutes: 0, tact_time_seconds: 120, cavity_count: 1 };
const FINGERPRINT_COLUMNS = ['output_qty', 'defect_qty', 'planned_runtime', 'actual_runtime', 'ideal_runtime',
  'downtime_minutes', 'tact_time_seconds', 'availability', 'performance', 'quality', 'oee'];

const fingerprintOf = async client => {
  const { rows } = await client.query('select * from public.production_records where machine_id=$1 and date=$2 and shift=$3', [MACHINE, DATE, 'A']);
  if (!rows[0]) return null;
  const fp = { record_id: rows[0].record_id };
  for (const c of FINGERPRINT_COLUMNS) fp[c] = rows[0][c] === null ? null : Number(rows[0][c]);
  return fp;
};
const digestA = async client => (await client.query('select public.downtime_window_digest($1,$2,$3) as d', [MACHINE, WINDOW_A.start, WINDOW_A.end])).rows[0].d;
const v2 = (client, { record = RECORD, off = false, expected, digest }) => client.query(
  'select public.save_daily_production_v2($1,$2,$3,false,$4::jsonb,null,$5::jsonb,$6::jsonb) as r',
  [MACHINE, DATE, off, off ? null : JSON.stringify(record), JSON.stringify(expected),
    JSON.stringify(off ? {} : { A: { ...WINDOW_A, digest } })]
).then(x => x.rows[0].r);
const v1 = (client, record) => client.query(
  'select public.save_daily_production($1,$2,false,false,$3::jsonb,null) as r', [MACHINE, DATE, JSON.stringify(record)]
).then(x => x.rows[0].r);
const currentDefect = async client => (await client.query('select defect_qty from public.production_records where machine_id=$1 and date=$2 and shift=$3', [MACHINE, DATE, 'A'])).rows[0]?.defect_qty ?? null;
const reset = async client => {
  await client.query('delete from public.production_records; delete from public.production_shift_states; delete from public.machine_downtime_intervals;');
};

/** 다른 세션이 마감·불량 확정 RPC 와 같은 키(설비·날짜·교대)를 잡고 불량을 확정한 채 커밋을 미룬다. */
const holdConfirmDefect = async (other, defect) => {
  await other.query('begin');
  await other.query("select pg_advisory_xact_lock(hashtextextended($1::text || $2::text || 'A', 0))", [MACHINE, DATE]);
  await other.query('update public.production_records set defect_qty=$1, quality=0.91 where machine_id=$2 and date=$3 and shift=$4', [defect, MACHINE, DATE, 'A']);
};

try {
  await server.initialise();
  await server.start();
  await server.createDatabase('daily');
  const admin = await connect();
  await admin.query(SCHEMA);
  await admin.query(between(read('20260715160000_independent_downtime_lifecycle.sql'), 'CREATE OR REPLACE FUNCTION public.save_daily_production(', '$function$;'));
  await admin.query(between(read('20260729210000_close_shift_source_completeness.sql'), 'create or replace function public.downtime_window_digest(', '$$;'));
  await admin.query(read('20261114100000_save_daily_production_v2.sql'));
  await admin.query('insert into public.machines(id) values ($1)', [MACHINE]);
  const a = await connect();
  const b = await connect();

  // ── 0. 수정 전 v1 의 결함 재현: 화면이 불량 1 을 본 뒤 다른 곳에서 9 를 확정 → v1 저장이 1 로 되돌린다
  await reset(admin);
  await v1(admin, RECORD);
  await holdConfirmDefect(b, 9);
  const v1Pending = v1(a, RECORD);
  await settle(200);
  await b.query('commit');
  await v1Pending;
  check('수정 전 v1: 다른 곳에서 확정한 불량 9 를 낡은 화면이 1 로 덮어쓴다(결함 재현)', (await currentDefect(admin)) === 1, 'defect=' + (await currentDefect(admin)));

  // ── 1. 정상 경로
  await reset(admin);
  const d0 = await digestA(admin);
  const first = await v2(a, { expected: { A: null }, digest: d0 });
  check('v2 신규 저장: 기록 없음을 본 화면이 새 기록을 만든다', first.ok === true && (await currentDefect(admin)) === 1, JSON.stringify(first));
  const fp1 = await fingerprintOf(admin);
  const second = await v2(a, { record: { ...RECORD, defect_qty: 3, quality: 0.97 }, expected: { A: fp1 }, digest: d0 });
  check('v2 수정 저장: 지문이 맞으면 덮어쓴다', second.ok === true && (await currentDefect(admin)) === 3, JSON.stringify(second));
  check('v2 응답은 v1 의 결과(saved_records·shift_states)를 그대로 담는다',
    Array.isArray(second.saved_records) && second.saved_records.length === 1 && Array.isArray(second.shift_states), JSON.stringify(second));

  // ── 2. 진짜 경합: 다른 세션이 교대 잠금을 쥐고 불량 9 확정 중 → v2 는 기다렸다가 거부
  const fpStale = await fingerprintOf(admin);
  await holdConfirmDefect(b, 9);
  let settled = false;
  const pending = v2(a, { record: { ...RECORD, defect_qty: 1 }, expected: { A: fpStale }, digest: d0 }).then(r => { settled = true; return r; });
  await settle(300);
  check('v2 는 교대 잠금을 쥔 다른 세션이 끝날 때까지 기다린다(판단과 쓰기가 같은 잠금 아래)', settled === false, 'settled early');
  await b.query('commit');
  const raced = await pending;
  check('v2 경합: 낡은 화면 저장은 record_changed 로 거부된다', raced.ok === false && raced.reason === 'record_changed' && raced.shift === 'A', JSON.stringify(raced));
  check('v2 경합: 확정 불량 9 가 그대로 남는다', (await currentDefect(admin)) === 9, 'defect=' + (await currentDefect(admin)));

  // ── 3. "기록 없음"을 본 화면 vs 그 사이 생긴 기록 (마감이 교대 잠금 아래에서 INSERT)
  await reset(admin);
  await b.query('begin');
  await b.query("select pg_advisory_xact_lock(hashtextextended($1::text || $2::text || 'A', 0))", [MACHINE, DATE]);
  await b.query('insert into public.production_records(machine_id,date,shift,output_qty,defect_qty) values ($1,$2,$3,250,5)', [MACHINE, DATE, 'A']);
  const pendingInsert = v2(a, { expected: { A: null }, digest: await digestA(admin) });
  await settle(200);
  await b.query('commit');
  const insertRace = await pendingInsert;
  const out = (await admin.query('select output_qty from public.production_records where machine_id=$1 and shift=$2', [MACHINE, 'A'])).rows[0]?.output_qty;
  check('v2: 기록 없음을 본 화면은 그 사이 마감된 기록(생산 250)을 덮지 않는다', insertRace.reason === 'record_changed' && out === 250, JSON.stringify(insertRace) + ' out=' + out);

  // ── 4. 낡은 화면의 휴무(=삭제)
  const fpNow = await fingerprintOf(admin);
  const staleOff = await v2(a, { off: true, expected: { A: { ...fpNow, defect_qty: 0 } } });
  const stillThere = (await fingerprintOf(admin)) !== null;
  check('v2 휴무: 낡은 지문이면 확정 기록을 지우지 않는다', staleOff.reason === 'record_changed' && stillThere, JSON.stringify(staleOff));
  const freshOff = await v2(a, { off: true, expected: { A: fpNow } });
  const state = (await admin.query('select status from public.production_shift_states where machine_id=$1 and shift=$2', [MACHINE, 'A'])).rows[0]?.status;
  check('v2 휴무: 지문이 맞으면 지우고 교대 상태를 OFF 로 남긴다',
    freshOff.ok === true && (await fingerprintOf(admin)) === null && state === 'OFF' && freshOff.deleted_shifts?.[0] === 'A',
    JSON.stringify(freshOff) + ' state=' + state);

  // ── 5. 비가동 원천이 계산과 저장 사이에 바뀜 (비가동 쓰기는 설비 advisory lock 을 잡는다)
  await reset(admin);
  const digestBefore = await digestA(admin);
  await b.query('begin');
  await b.query('select pg_advisory_xact_lock(hashtextextended($1::text, 0))', [MACHINE]);
  await b.query("insert into public.machine_downtime_intervals(source,machine_id,reason,start_time,end_time) values ('entry',$1,'failure',$2,$3)",
    [MACHINE, '2026-07-14T02:00:00Z', '2026-07-14T03:00:00Z']);
  const pendingSource = v2(a, { expected: { A: null }, digest: digestBefore });
  await settle(200);
  await b.query('commit');
  const sourceRace = await pendingSource;
  check('v2: 계산 뒤 비가동이 바뀌면 source_changed 로 거부하고 쓰지 않는다',
    sourceRace.reason === 'source_changed' && (await fingerprintOf(admin)) === null, JSON.stringify(sourceRace));
  const retried = await v2(a, { expected: { A: null }, digest: await digestA(admin) });
  check('v2: 새 지문으로 다시 저장하면 성공한다', retried.ok === true, JSON.stringify(retried));

  // ── 6. 지문 키가 없으면 쓰지 않는다
  await reset(admin);
  const missing = await v2(a, { expected: {}, digest: await digestA(admin) });
  check('v2: 건드리는 교대의 지문이 없으면 expected_missing 으로 거부한다',
    missing.reason === 'expected_missing' && (await fingerprintOf(admin)) === null, JSON.stringify(missing));

  // ── 7. 권한: 서비스 롤만 실행
  const grants = (await admin.query(
    "select has_function_privilege('anon','public.save_daily_production_v2(uuid,date,boolean,boolean,jsonb,jsonb,jsonb,jsonb)','execute') as anon, has_function_privilege('authenticated','public.save_daily_production_v2(uuid,date,boolean,boolean,jsonb,jsonb,jsonb,jsonb)','execute') as auth, has_function_privilege('service_role','public.save_daily_production_v2(uuid,date,boolean,boolean,jsonb,jsonb,jsonb,jsonb)','execute') as svc"
  )).rows[0];
  check('v2 실행 권한: anon·authenticated 없음, service_role 있음', !grants.anon && !grants.auth && grants.svc, JSON.stringify(grants));

  await Promise.all([a.end(), b.end(), admin.end()]);
} catch (error) {
  failed += 1;
  console.error('FAIL 실행 오류:', error);
} finally {
  await server.stop().catch(() => {});
  fs.rmSync(dataDir, { recursive: true, force: true });
}
console.log(failed === 0 ? '\n모두 통과' : '\n실패 ' + failed + '건');
process.exit(failed === 0 ? 0 : 1);
