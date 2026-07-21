#!/usr/bin/env node
/**
 * 로컬 supabase/migrations/ ↔ 운영 적용 원장(supabase/applied-migrations.json) 대조.
 * (자체 감사 #4 — 파일명과 적용 version 이 불일치해 `db push` 가 영구 금지된 저장소라,
 *  "무엇이 미적용인가"가 사람 머리와 런북에만 있었다. 이 스크립트가 그걸 기계화한다.)
 *
 * 사용: npm run check:migrations
 * 원장 갱신: 마이그레이션을 적용한 세션이 MCP list_migrations 스냅샷으로 JSON 을 갱신한다.
 *
 * 매칭 규칙(원장의 name 과):
 *  1) 파일 스템 전체(예: 20260720010000_shift_write_atomicity)
 *  2) 타임스탬프를 뗀 접미(예: codex_round2_fixes)
 *  3) file_matches 의 명시적 별칭(1:N 분할 적용 포함)
 *  4) intentionally_skipped 는 적용 대상이 아님(사유 표시)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const migrationsDir = path.join(root, 'supabase', 'migrations');
const ledgerPath = path.join(root, 'supabase', 'applied-migrations.json');

const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
const appliedNames = new Set(ledger.applied.map(m => m.name));
const fileMatches = ledger.file_matches ?? {};
const skipped = ledger.intentionally_skipped ?? {};
const hashes = ledger.hashes ?? {};

// 파일 내용 해시(원장의 적용-시점 해시와 대조 — 적용 후 편집/드리프트 탐지).
const fileHash = stem => crypto
  .createHash('sha256')
  .update(fs.readFileSync(path.join(migrationsDir, `${stem}.sql`), 'utf8').replace(/\r\n/g, '\n'))
  .digest('hex')
  .slice(0, 16);

const localStems = fs.readdirSync(migrationsDir)
  .filter(f => f.endsWith('.sql'))
  .map(f => f.replace(/\.sql$/, ''))
  .sort();

const suffixOf = stem => stem.replace(/^\d{14}_/, '');

const missing = [];
const drifted = [];
let appliedCount = 0;
const matchedNames = new Set();

for (const stem of localStems) {
  if (stem in skipped) {
    console.log(`⏭️  skip     ${stem}  — ${skipped[stem]}`);
    continue;
  }
  const candidates = fileMatches[stem] ?? [stem, suffixOf(stem)];
  const hit = candidates.filter(n => appliedNames.has(n));
  if (hit.length === candidates.length || (!(stem in fileMatches) && hit.length > 0)) {
    appliedCount += 1;
    hit.forEach(n => matchedNames.add(n));
    // 적용된 파일의 내용이 원장 해시와 다르면 = 적용 후 편집(드리프트). 재적용 여부 확인 필요.
    const expectedHash = hashes[stem];
    if (expectedHash && fileHash(stem) !== expectedHash) drifted.push(stem);
    else if (!expectedHash) drifted.push(`${stem} (원장에 해시 없음 — 추가 필요)`);
  } else {
    missing.push({ stem, expected: candidates, found: hit });
  }
}

const unmatchedApplied = ledger.applied.filter(m => !matchedNames.has(m.name));

console.log(`\n로컬 ${localStems.length}개 중 적용 ${appliedCount}, 의도적 건너뜀 ${Object.keys(skipped).length}, 미적용 ${missing.length}, 드리프트 ${drifted.length}`);
console.log(`원장에만 있는 적용 이력(저장소 이전 히스토리 등): ${unmatchedApplied.length}건`);

// 드리프트는 경고다(실패 아님) — create-or-replace 재적용 같은 정당한 편집도 있으므로,
// "적용 후 파일이 바뀌었으니 재적용했는지 + 원장 해시를 갱신했는지 확인하라"는 신호다.
if (drifted.length > 0) {
  console.warn('\n⚠️  적용 후 내용이 바뀐(또는 해시 미등록) 마이그레이션:');
  for (const d of drifted) console.warn(`   - ${d}`);
  console.warn('재적용했다면 supabase/applied-migrations.json 의 hashes 를 갱신하세요.');
}

if (missing.length > 0) {
  console.error('\n❌ 미적용(또는 원장 미갱신) 마이그레이션:');
  for (const m of missing) {
    console.error(`   - ${m.stem}`);
    if (m.found.length > 0) console.error(`     (부분 일치: ${m.found.join(', ')} — file_matches 별칭 확인 필요)`);
  }
  console.error('\n적용했다면 supabase/applied-migrations.json 을 갱신하고, 아니라면 런북 절차로 적용하세요.');
  process.exit(1);
}

console.log('✅ 로컬 마이그레이션과 운영 적용 원장이 일치합니다.' + (drifted.length ? ' (드리프트 경고 있음)' : ''));
