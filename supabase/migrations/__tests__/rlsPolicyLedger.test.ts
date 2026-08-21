import fs from 'fs';
import path from 'path';

/**
 * Codex 감사 2026-07-29 HIGH #3 / MEDIUM #10 회귀 검사 — RLS 정책 원장.
 *
 * `machineStateLockProtocol.test.ts` 와 같은 발상이다: 마이그레이션을 **시간 순으로** 훑어
 * 각 정책의 **최종 상태**를 재구성하고, 그 최종 상태에 규약을 건다. 새 마이그레이션이
 * 규약을 깨면 그 테스트를 고치지 않아도 자동으로 걸린다.
 *
 * 지키려는 규약은 하나다: **핵심 운영 테이블에 `USING (true)` 로 열린 authenticated 정책이
 * 남아 있으면 안 된다.** 그런 정책이 있으면 API 의 역할·담당설비 검사가 무의미해진다 —
 * 브라우저 번들의 anon 키와 자기 JWT 로 PostgREST 를 직접 치면 지나갈 수 있기 때문이다.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, '..');

/** 정책이 지켜야 할 핵심 테이블. 이 목록이 늘면 규약도 함께 넓어진다. */
const PROTECTED_TABLES = ['machines', 'machine_logs', 'production_records'];

interface Policy {
  name: string;
  table: string;
  /** CREATE POLICY 문 전체 (술어 판정용) */
  body: string;
  /** 정의된 마이그레이션 파일 */
  file: string;
}

function readMigrationsInOrder(): Array<{ file: string; sql: string }> {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort() // 파일명이 타임스탬프 접두사라 사전순 = 적용순
    .map(file => ({ file, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8') }));
}

/** SQL 에서 줄 주석을 지운다 — 주석 안의 예시 정책문이 원장에 섞이면 안 된다. */
function stripComments(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, '');
}

/**
 * 마이그레이션을 순서대로 적용해 정책의 최종 상태를 만든다.
 * 키는 `table::policyName` — Postgres 에서 정책 이름은 테이블 안에서만 유일하다.
 */
function buildPolicyLedger(): Map<string, Policy> {
  const ledger = new Map<string, Policy>();

  for (const { file, sql } of readMigrationsInOrder()) {
    const clean = stripComments(sql);

    // DROP POLICY [IF EXISTS] "name" ON [public.]table
    const dropRe = /drop\s+policy\s+(?:if\s+exists\s+)?"?([^"\n]+?)"?\s+on\s+(?:public\.)?(\w+)/gi;
    for (const m of clean.matchAll(dropRe)) {
      ledger.delete(`${m[2]}::${m[1].trim()}`);
    }

    // CREATE POLICY "name" ON [public.]table ... 다음 세미콜론까지
    const createRe = /create\s+policy\s+"?([^"\n]+?)"?\s+on\s+(?:public\.)?(\w+)([\s\S]*?);/gi;
    for (const m of clean.matchAll(createRe)) {
      const [, name, table, rest] = m;
      ledger.set(`${table}::${name.trim()}`, {
        name: name.trim(),
        table,
        body: rest,
        file,
      });
    }
  }

  return ledger;
}

const ledger = buildPolicyLedger();
const protectedPolicies = [...ledger.values()].filter(p => PROTECTED_TABLES.includes(p.table));

describe('RLS 정책 원장', () => {
  it('정책을 실제로 찾아낸다 (탐지기 자체가 죽지 않았는지)', () => {
    // 정규식이 어긋나 0개를 훑으면 아래 단언이 전부 조용히 통과한다.
    expect(protectedPolicies.length).toBeGreaterThan(0);
    expect(new Set(protectedPolicies.map(p => p.table)).size).toBe(PROTECTED_TABLES.length);
  });

  it('핵심 테이블에 FOR ALL 로 열린 authenticated 정책이 없다', () => {
    // machine_logs 가 정확히 이 모양이었다: FOR ALL TO authenticated USING(true) WITH CHECK(true).
    // 임의 운영자가 임의 설비의 상태 이력을 조작할 수 있었고, 그건 곧 OEE 조작 경로다.
    const offenders = protectedPolicies
      .filter(p => /for\s+all/i.test(p.body) && /to\s+authenticated/i.test(p.body))
      .map(p => `${p.table} / "${p.name}" (${p.file})`);

    expect(offenders).toEqual([]);
  });

  it('핵심 테이블의 읽기 정책이 무조건 통과(USING (true))가 아니다', () => {
    const offenders = protectedPolicies
      .filter(p => /to\s+authenticated/i.test(p.body))
      .filter(p => /using\s*\(\s*true\s*\)/i.test(p.body))
      .map(p => `${p.table} / "${p.name}" (${p.file})`);

    expect(offenders).toEqual([]);
  });

  it('핵심 테이블의 정책은 역할 또는 담당 설비로 범위를 좁힌다', () => {
    const unscoped = protectedPolicies
      .filter(p => /to\s+authenticated/i.test(p.body))
      // 범위를 좁히는 것으로 인정되는 술어.
      //
      // 앞의 셋은 역할/담당설비 기반(전환 이전), 뒤의 셋은 공장 기반(멀티테넌시 cutover)이다.
      // 이 테스트의 명제는 "무범위 authenticated 정책이 없다" 이지 "특정 helper 를 쓴다"가
      // 아니므로, 새 경계가 생기면 목록도 함께 넓힌다. 좁히는 근거가 무엇이든 좁히기만
      // 하면 된다 — 넓은 정책이 남는 것만이 결함이다.
      .filter(p => !/current_user_role\(\)|current_user_machines\(\)|user_profiles|current_user_factory\(\)|current_user_factory_role\(\)|current_factory_machine_ids\(\)/i.test(p.body))
      .map(p => `${p.table} / "${p.name}" (${p.file})`);

    expect(unscoped).toEqual([]);
  });

  it('anon 에게 부여된 정책이 핵심 테이블에 없다', () => {
    const anonPolicies = protectedPolicies
      .filter(p => /to\s+(public|anon)\b/i.test(p.body))
      .map(p => `${p.table} / "${p.name}" (${p.file})`);

    expect(anonPolicies).toEqual([]);
  });
});
