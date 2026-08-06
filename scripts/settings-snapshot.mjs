#!/usr/bin/env node
/**
 * system_settings 스냅샷 · 원복 도구.
 *
 *   npm run settings:snapshot            # 현재 운영 설정을 파일로 저장
 *   npm run settings:diff                # 스냅샷과 현재 값을 비교 (쓰기 없음)
 *   npm run settings:restore             # 스냅샷 상태로 되돌림
 *   npm run settings:restore -- --dry-run
 *
 * ## 왜 필요한가
 *
 * 설정 화면을 **실제 브라우저에서** 검증하려면 값을 바꿔 보는 수밖에 없다. 그런데 이 앱의
 * system_settings 는 개발용 사본이 아니라 **운영 DB 의 전역 행**이다. 교대 시각·휴식 총량
 * 하나만 어긋나도 `/api/production-progress` 가 fail-closed 로 돌아 설비 콘솔의 실시간
 * 지표가 전 설비에서 사라진다(감사 2026-08-06 HIGH-01). 테스트가 그 상태를 남기면 그건
 * 테스트가 아니라 장애다.
 *
 * 그래서 검증 순서를 도구로 강제한다: **스냅샷 → 테스트 → 원복 → diff 로 0 확인.**
 * 사람의 기억에 기대면 "원래 뭐였더라"가 남는다.
 *
 * ## 설계상의 선택
 *
 * - **원복은 스냅샷을 기준으로 한다.** 코드 기본값이나 DB 의 default_value 를 쓰지 않는다.
 *   그 셋은 서로 다르다(회사명·시간대·목표 OEE·휴식·알림 간격·테마 전부 불일치, 감사 §5.3).
 *   "기본값으로 되돌리기"는 원복이 아니라 **또 다른 변경**이다.
 * - **setting_value 전체를 그대로 보존한다.** 이 테이블의 값은 `{"value": ...}` 래핑이라
 *   내부만 꺼내 되돌리면 래핑이 사라진 채 저장될 수 있다.
 * - **is_active 도 보존한다.** 비활성 레거시 행(shift_hours)이 되살아나면 안 된다.
 * - **updated_at 은 되돌리지 않는다.** 되돌릴 수도 없고, 되돌리면 감사 이력이 거짓말을 한다.
 *   원복도 하나의 변경이며 그 사실이 남는 편이 옳다.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';

try {
  process.loadEnvFile('.env.local');
} catch {
  // CI 등 파일이 없는 환경에서는 이미 주입된 process.env 를 쓴다.
}

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

const SNAPSHOT_PATH = resolve(process.env.SETTINGS_SNAPSHOT_PATH ?? '.omc/settings-snapshot.json');

/** 되돌릴 때 비교·기록하는 열. updated_at 은 일부러 뺀다(위 주석 참조). */
const COLUMNS = 'id, category, setting_key, setting_value, is_active';

function die(message) {
  console.error(`❌ ${message}`);
  process.exit(1);
}


if (!URL || !SERVICE) {
  die('NEXT_PUBLIC_SUPABASE_URL 과 SUPABASE_SERVICE_ROLE_KEY 가 필요합니다 (.env.local).');
}

const db = createClient(URL, SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** 운영 DB 의 현재 전체 설정. 43행 규모라 페이지네이션은 불필요하지만 정렬은 고정한다. */
async function readAll() {
  const { data, error } = await db
    .from('system_settings')
    .select(COLUMNS)
    .order('category')
    .order('setting_key');
  if (error) die(`설정 조회 실패: ${error.message}`);
  if (!data?.length) die('설정이 0건입니다 — 잘못된 프로젝트를 보고 있을 수 있습니다.');
  return data;
}

const keyOf = row => `${row.category}.${row.setting_key}`;
/** 값 비교는 JSON 직렬화로 한다. setting_value 는 임의 JSON 이라 === 로는 비교되지 않는다. */
const valueOf = row => JSON.stringify(row.setting_value);

async function snapshot() {
  const rows = await readAll();
  mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
  writeFileSync(
    SNAPSHOT_PATH,
    // takenAt 은 사람이 읽기 위한 것이지 원복에 쓰이지 않는다.
    `${JSON.stringify({ takenAt: new Date().toISOString(), supabaseUrl: URL, rows }, null, 2)}\n`,
  );
  console.log(`✅ 설정 ${rows.length}건을 스냅샷했습니다 → ${SNAPSHOT_PATH}`);
  console.log('   테스트가 끝나면 `npm run settings:restore` 로 되돌리세요.');
}

function loadSnapshot() {
  if (!existsSync(SNAPSHOT_PATH)) {
    die(`스냅샷이 없습니다 (${SNAPSHOT_PATH}). 먼저 \`npm run settings:snapshot\` 을 실행하세요.`);
  }
  const parsed = JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf-8'));
  if (parsed.supabaseUrl !== URL) {
    // 다른 프로젝트의 스냅샷을 덮어쓰면 되돌릴 수 없는 사고가 된다.
    die(`스냅샷이 다른 프로젝트의 것입니다.\n  스냅샷: ${parsed.supabaseUrl}\n  현재:   ${URL}`);
  }
  return parsed.rows;
}

/** 스냅샷 대비 현재 상태의 차이. 쓰기 없음. */
async function computeDiff() {
  const saved = loadSnapshot();
  const current = await readAll();

  const savedByKey = new Map(saved.map(row => [keyOf(row), row]));
  const currentByKey = new Map(current.map(row => [keyOf(row), row]));

  const changed = [];
  const added = [];
  const removed = [];

  for (const [key, savedRow] of savedByKey) {
    const currentRow = currentByKey.get(key);
    if (!currentRow) {
      removed.push({ key, saved: savedRow });
    } else if (
      valueOf(currentRow) !== valueOf(savedRow) ||
      currentRow.is_active !== savedRow.is_active
    ) {
      changed.push({ key, saved: savedRow, current: currentRow });
    }
  }
  for (const [key, currentRow] of currentByKey) {
    if (!savedByKey.has(key)) added.push({ key, current: currentRow });
  }

  return { changed, added, removed };
}

function printDiff({ changed, added, removed }) {
  if (!changed.length && !added.length && !removed.length) {
    console.log('✅ 현재 설정이 스냅샷과 완전히 같습니다.');
    return false;
  }
  for (const { key, saved, current } of changed) {
    console.log(`  ~ ${key}`);
    console.log(`      스냅샷: ${valueOf(saved)}${saved.is_active ? '' : ' (비활성)'}`);
    console.log(`      현재:   ${valueOf(current)}${current.is_active ? '' : ' (비활성)'}`);
  }
  for (const { key, current } of added) {
    console.log(`  + ${key} (스냅샷 이후 추가됨) = ${valueOf(current)}`);
  }
  for (const { key } of removed) {
    console.log(`  - ${key} (스냅샷에는 있었으나 지금은 없음)`);
  }
  return true;
}

async function diff() {
  const result = await computeDiff();
  const hasDiff = printDiff(result);
  // 원복 후 검증에 쓸 수 있도록 종료 코드로도 알린다.
  //
  // `process.exit()` 이 아니라 `exitCode` 를 쓴다. Windows 의 Node 는 supabase-js 가 아직
  // 쥐고 있는 핸들이 있는 상태에서 즉시 종료하면 libuv 어설션(UV_HANDLE_CLOSING)을 찍는다.
  // 그 노이즈가 진짜 실패 메시지를 덮는다 — 이벤트 루프가 비워질 때까지 둔다.
  process.exitCode = hasDiff ? 1 : 0;
}

async function restore({ dryRun }) {
  const { changed, added, removed } = await computeDiff();

  if (!changed.length && !added.length) {
    console.log('✅ 되돌릴 변경이 없습니다.');
    if (removed.length) {
      console.log(`⚠️  스냅샷에만 있는 행 ${removed.length}건은 자동 복구하지 않습니다:`);
      for (const { key } of removed) console.log(`    - ${key}`);
    }
    return;
  }

  console.log(`되돌릴 대상 ${changed.length}건:`);
  printDiff({ changed, added: [], removed: [] });

  if (added.length) {
    // 스냅샷 이후 새로 생긴 행은 지우지 않는다. 이 스크립트의 책임은 "내가 바꾼 것을
    // 되돌리는 것"이지 "남이 추가한 것을 없애는 것"이 아니다.
    console.log(`\n⚠️  스냅샷 이후 추가된 행 ${added.length}건은 건드리지 않습니다:`);
    for (const { key } of added) console.log(`    + ${key}`);
  }

  if (dryRun) {
    console.log('\n(--dry-run: 아무것도 쓰지 않았습니다)');
    return;
  }

  let restored = 0;
  for (const { key, saved } of changed) {
    // id 로 갱신한다. category+key 로 매칭하면 중복 행이 있을 때 어느 쪽인지 알 수 없다.
    const { error } = await db
      .from('system_settings')
      .update({ setting_value: saved.setting_value, is_active: saved.is_active })
      .eq('id', saved.id);
    if (error) {
      // 부분 실패를 성공처럼 보고하지 않는다 — 무엇이 남았는지 정확히 말해야 다시 시도할 수 있다.
      console.error(`❌ ${key} 되돌리기 실패: ${error.message}`);
      console.error(`   ${restored}/${changed.length} 건만 되돌아간 상태입니다. 다시 실행하세요.`);
      process.exitCode = 1;
      return;
    }
    restored += 1;
  }

  console.log(`\n✅ ${restored}건을 스냅샷 상태로 되돌렸습니다.`);

  // 되돌렸다고 말하기 전에 실제로 확인한다.
  const after = await computeDiff();
  if (after.changed.length) {
    console.error('❌ 되돌린 뒤에도 차이가 남아 있습니다:');
    printDiff({ changed: after.changed, added: [], removed: [] });
    process.exitCode = 1;
    return;
  }
  console.log('✅ 검증 완료 — 현재 설정이 스냅샷과 같습니다.');
}

const command = process.argv[2];
const dryRun = process.argv.includes('--dry-run');

switch (command) {
  case 'snapshot':
    await snapshot();
    break;
  case 'diff':
    await diff();
    break;
  case 'restore':
    await restore({ dryRun });
    break;
  default:
    die(`알 수 없는 명령: ${command ?? '(없음)'}\n사용법: settings-snapshot.mjs <snapshot|diff|restore> [--dry-run]`);
}
