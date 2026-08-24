import fs from 'fs';
import path from 'path';

/**
 * 공장 격리 원장 테스트.
 *
 * `machineStateLockProtocol.test.ts` / `rlsPolicyLedger.test.ts` 와 같은 발상이다:
 * 마이그레이션을 시간순으로 훑어 **최종 상태**를 재구성하고 그 위에 규약을 건다.
 *
 * ## 왜 개별 테이블 테스트가 아니라 원장인가
 *
 * 공장 격리는 개별 테이블의 속성이 아니라 **집합 전체의 속성**이다. "production_records 에
 * factory_id 가 있다"는 명제는 아무것도 보장하지 않는다. 보장해야 할 명제는 "공장 소유
 * 테이블 **전체**에 예외 없이 있다"이다.
 *
 * 잠금 규약 테스트의 주석이 이미 같은 교훈을 적어 두었다 — 개별 함수 테스트가 세 개나
 * 있었지만 네 번째 함수가 빠진 것을 아무도 눈치채지 못했다. 빠진 원소는 집합을 열거하는
 * 테스트만이 찾는다.
 *
 * 새 공장 소유 테이블이 생기면 아래 `FACTORY_OWNED` 에 추가해야 하고, 추가하지 않으면
 * 이 테스트는 통과한다 — 그래서 목록 자체도 인벤토리(D1_D2_INVENTORY_LEDGER.md)와
 * 대조되어야 한다. 이 테스트는 목록에 있는 것을 강제할 뿐 목록의 완전성을 증명하지 않는다.
 */

const MIGRATIONS_DIR = path.resolve(__dirname, '..');

/**
 * 공장 소유 테이블.
 *
 * 근거: 계약 4.2 + D1_D2_INVENTORY_LEDGER.md 5절. `user_profiles` 는 전역 신원이므로 제외한다
 * (계약 4.1 이 명시적으로 글로벌로 분류한다).
 */
const FACTORY_OWNED = [
  'product_models',
  'model_processes',
  'machines',
  'system_settings',
  'system_settings_audit',
  'machine_logs',
  'machine_status_history',
  'machine_status_descriptions',
  'downtime_entries',
  'production_records',
  'production_shift_states',
  'production_progress_reports',
  'alert_acknowledgements',
  'audit_log',
] as const;

/**
 * 배포 창(window) 동안만 남겨 두는 예외.
 *
 * ## 왜 하나 있는가
 *
 * `update_system_setting` 은 설정이 없을 때 `system_settings` 에 새 행을 만든다. 그 INSERT 는
 * `factory_id` 를 넣지 않으므로 contract 이후 실패한다. 그런데 이 함수는 **고칠 수 없다** —
 * 인자에 공장이 없고, 그것을 알 방법이 함수 안에 없다. 부모도 없으니 유도 트리거도 못 만든다.
 *
 * 새 앱은 이 함수를 부르지 않는다(`update_system_setting_scoped` 를 쓰고,
 * `factoryScopedRoutes.test.ts` 의 "공장을 모르는 RPC" 검사가 그것을 강제한다).
 * 이 함수가 남아 있는 이유는 오직 **마이그레이션과 새 코드 배포 사이의 창** 때문이다.
 * 그동안 운영에 떠 있는 옛 앱이 이것을 부른다.
 *
 * ## 지우지 않고 남기는 것이 왜 더 나은가
 *
 * 지우면 창 동안 옛 앱의 설정 저장이 **전부** 실패한다(함수 없음).
 * 남기면 **새 설정을 만드는 경우에만** 실패하고, 기존 설정 수정은 UPDATE 경로라 동작한다.
 * 둘 다 나쁘지만 후자가 덜 나쁘다.
 *
 * ## 제거 조건
 *
 * 새 코드가 운영에 배포되고 나면 호출자가 없다. 그때 이 함수를 DROP 하고 여기 목록과
 * 아래 개수 검사를 함께 지운다. 그 전에는 지우지 않는다.
 */
const WINDOW_ONLY_LEGACY: string[] = ['update_system_setting -> system_settings'];

/** 공장 개념을 지탱하는 신설 테이블. 하나라도 없으면 격리가 성립하지 않는다. */
const FACTORY_CORE = [
  'factories',
  'factory_domains',
  'factory_memberships',
  'user_machine_assignments',
] as const;

/**
 * 복합 FK 로 부모와 공장을 함께 묶어야 하는 관계.
 *
 * 단일 컬럼 FK 는 "그 설비가 존재한다"만 보장한다. 복합 FK 만이 "이 행과 그 설비가
 * **같은 공장**이다"를 DB 수준에서 보장한다 — 계약 1절이 말하는 "최종 보안 경계는
 * PostgreSQL 제약조건과 RLS" 의 제약조건 쪽 절반이다.
 */
const COMPOSITE_FK: Array<[child: string, column: string]> = [
  ['machine_logs', 'machine_id'],
  ['machine_status_history', 'machine_id'],
  ['downtime_entries', 'machine_id'],
  ['production_records', 'machine_id'],
  ['production_shift_states', 'machine_id'],
  ['production_progress_reports', 'machine_id'],
  ['model_processes', 'model_id'],
  ['system_settings_audit', 'setting_id'],
];

function readMigrationsInOrder(): Array<{ file: string; sql: string }> {
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort() // 파일명이 타임스탬프 접두사라 사전순 = 적용순
    .map(file => ({ file, sql: fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8') }));
}

/** SQL 주석을 지운다 — 주석 안의 예시문이 원장에 섞이면 안 된다. */
function stripComments(sql: string): string {
  return sql.replace(/^\s*--.*$/gm, '');
}

/**
 * 각 함수의 **최종 정의**를 모은다.
 *
 * `create or replace function` 은 같은 이름을 여러 마이그레이션이 덮어쓴다. 그러니
 * "어딘가에 있다"가 아니라 **마지막으로 적힌 것**을 봐야 한다. 실제로 `audit_log` 에 쓰는
 * 함수를 세다가 이 구분을 놓치면, 이미 교체된 옛 정의를 근거로 판단하게 된다.
 * (`machineStateLockProtocol.test.ts` 가 같은 방식을 쓴다.)
 */
function finalFunctionBodies(): Map<string, string> {
  const final = new Map<string, string>();
  for (const { sql } of readMigrationsInOrder()) {
    const clean = stripComments(sql);
    const re = /create\s+(?:or\s+replace\s+)?function\s+public\.(\w+)/gi;
    const marks: Array<{ name: string; at: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(clean)) !== null) marks.push({ name: m[1], at: m.index });
    marks.forEach((mark, i) => {
      const hardEnd = i + 1 < marks.length ? marks[i + 1].at : clean.length;
      // 함수는 `$$;` / `$function$;` 로 끝난다. 거기서 자르지 않으면 뒤따르는 do 블록의
      // 자체 확인용 INSERT 까지 이 함수의 것으로 세어진다 — 실제로 그렇게 오탐이 났다.
      const tail = clean.slice(mark.at, hardEnd);
      const term = tail.search(/\$(?:function)?\$\s*;/);
      const end = term === -1 ? hardEnd : mark.at + term;
      final.set(mark.name, clean.slice(mark.at, end));
    });
  }
  return final;
}

/**
 * `insert into public.<t>` 를 찾아 컬럼 목록과 함께 돌려준다.
 *
 * 컬럼 목록이 없는 형태(`insert into public.x values (...)`, `... select ...`)는 `null` 로
 * 표시한다 — 그 경우 factory_id 를 넣었는지 정적으로 알 수 없으므로 통과시키지 않는다.
 */
function insertTargets(body: string): Array<{ table: string; columns: string | null }> {
  const out: Array<{ table: string; columns: string | null }> = [];
  // `public.` 은 **선택**이다. baseline 의 함수들은 `INSERT INTO audit_log (...)` 처럼
  // 스키마를 적지 않는다(search_path 에 의존한다). 접두사를 강제하던 초판은 그 함수들을
  // 통째로 못 봤고, 그래서 `audit_role_change` 가 원장 밖에 있었다.
  const re = /insert\s+into\s+(?:public\.)?(\w+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    const rest = body.slice(m.index + m[0].length);
    const open = rest.match(/^\s*\(/);
    if (!open) {
      out.push({ table: m[1], columns: null });
      continue;
    }
    const start = rest.indexOf('(');
    const close = rest.indexOf(')', start);
    out.push({ table: m[1], columns: close === -1 ? null : rest.slice(start + 1, close) });
  }
  return out;
}

/**
 * BEFORE INSERT 유도 트리거가 달린 테이블.
 *
 * AFTER 는 NOT NULL 검사보다 늦어 소용없으므로 BEFORE 만 센다.
 *
 * 트리거를 만드는 형태가 두 가지다:
 *   1. 그대로 적은 것          — `create trigger … before insert on public.audit_log …`
 *   2. do 블록에서 만든 것     — 6개 테이블을 `array[…]` 로 돌며 `execute format(…%I…)`
 *
 * 2번을 빼먹으면 그 6개가 "유도 없음"으로 세어져, 이미 트리거가 있는 함수들이 전부
 * 위반으로 찍힌다. 실제로 첫 시도에서 그렇게 났다 — 형태 하나만 보면 원장이 거짓말을 한다.
 */
function derivedInsertTables(): Set<string> {
  const clean = stripComments(allMigrationSql());
  const out = new Set<string>();

  const literal = /create\s+trigger\s+\w+\s+before\s+insert\s+(?:or\s+update[^\n]*?)?\s*on\s+public\.(\w+)/gi;
  let m: RegExpExecArray | null;
  while ((m = literal.exec(clean)) !== null) {
    if (/execute\s+function\s+public\.derive_/i.test(clean.slice(m.index, m.index + 400))) {
      out.add(m[1]);
    }
  }

  // do 블록: `before insert on public.%I` + `derive_` 앞의 가장 가까운 array[...] 가 대상이다.
  const templated = /before\s+insert\s+on\s+public\.%I/gi;
  while ((m = templated.exec(clean)) !== null) {
    if (!/derive_/i.test(clean.slice(m.index, m.index + 400))) continue;
    const before = clean.slice(0, m.index);
    const arrayStart = before.toLowerCase().lastIndexOf('array[');
    if (arrayStart === -1) continue;
    const arrayEnd = before.indexOf(']', arrayStart);
    if (arrayEnd === -1) continue;
    for (const q of before.slice(arrayStart, arrayEnd).matchAll(/'([a-z_]+)'/g)) {
      out.add(q[1]);
    }
  }

  return out;
}

function allMigrationSql(): string {
  return readMigrationsInOrder().map(({ sql }) => stripComments(sql)).join('\n');
}

describe('공장 격리 원장', () => {
  const sql = allMigrationSql();

  describe('공장 소유 테이블은 예외 없이 factory_id 를 갖는다', () => {
    it.each(FACTORY_OWNED)('%s', table => {
      // `alter table ... add column ... factory_id` 또는 CREATE TABLE 안의 컬럼 선언.
      const added = new RegExp(
        `alter\\s+table\\s+(?:public\\.)?${table}\\s+add\\s+column\\s+(?:if\\s+not\\s+exists\\s+)?factory_id`,
        'i'
      );
      expect(sql).toMatch(added);
    });
  });

  describe('factory_id 는 factories 를 참조한다', () => {
    it.each(FACTORY_OWNED)('%s', table => {
      // 동적 DO 블록으로 거는 경우도 있으므로 제약 이름 규약으로 확인한다.
      expect(sql).toMatch(new RegExp(`${table}_factory_id_fkey`, 'i'));
    });
  });

  describe('공장 개념의 핵심 테이블이 존재한다', () => {
    it.each(FACTORY_CORE)('%s', table => {
      expect(sql).toMatch(
        new RegExp(`create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?(?:public\\.)?${table}\\b`, 'i')
      );
    });
  });

  describe('부모 참조는 복합 FK 로 공장을 함께 묶는다', () => {
    it.each(COMPOSITE_FK)('%s.%s', (child, column) => {
      // 제약 이름 규약: {child}_factory_{column}_fkey
      expect(sql).toMatch(new RegExp(`${child}_factory_${column}_fkey`, 'i'));
    });
  });

  it('설비/모델 이름의 유일성이 공장 범위다', () => {
    // 전역 UNIQUE(name) 이 남아 있으면 ALT 와 ALV 가 같은 설비명을 쓸 수 없다.
    // 계약 4.3: "설비·모델·공정 이름의 유일성은 전역이 아니라 공장 범위다."
    expect(sql).toMatch(/unique\s+index\s+(?:if\s+not\s+exists\s+)?uq_machines_factory_name/i);
    expect(sql).toMatch(/unique\s+index\s+(?:if\s+not\s+exists\s+)?uq_product_models_factory_name/i);
  });

  it('설정 유일성이 (factory, category, key) 다', () => {
    expect(sql).toMatch(
      /unique\s+index\s+(?:if\s+not\s+exists\s+)?uq_system_settings_factory_category_key/i
    );
  });

  it('복합 FK 의 참조 대상인 (factory_id, id) UNIQUE 가 부모마다 있다', () => {
    // Postgres 는 복합 FK 의 참조 대상으로 정확히 그 컬럼 조합의 unique 제약을 요구한다.
    // 이것이 없으면 위의 복합 FK 들이 애초에 만들어지지 않는다.
    for (const parent of ['machines', 'product_models', 'model_processes', 'system_settings']) {
      expect(sql).toMatch(
        new RegExp(`unique\\s+index\\s+(?:if\\s+not\\s+exists\\s+)?uq_${parent}_factory_id\\b`, 'i')
      );
    }
  });

  it('membership 과 assignment 가 서로 복합 FK 로 묶여 있다', () => {
    // membership 없는 사용자에게 설비를 배정할 수 없어야 한다(계약 4.3).
    expect(sql).toMatch(/user_machine_assignments_membership_fkey/i);
    expect(sql).toMatch(/user_machine_assignments_machine_fkey/i);
  });

  it('영구 default 로 공장을 채우지 않는다', () => {
    // 계약 1절: "NULL factory_id = ALT 같은 영구 호환 규칙은 금지한다."
    // factory_id 컬럼에 DEFAULT 를 걸면 그것이 곧 영구 호환 규칙이 된다 —
    // 새 행이 조용히 한 공장으로 흘러 들어가고, 아무도 그것을 보지 못한다.
    expect(sql).not.toMatch(/add\s+column\s+(?:if\s+not\s+exists\s+)?factory_id\s+uuid\s+default/i);
  });

  it('신설 테이블의 PUBLIC/anon 권한을 회수한다', () => {
    // Supabase 는 새 객체에 PUBLIC 권한을 되돌려 부여한다(2026-07-29 실측).
    // 권한은 열거하지 말고 전수 회수한다.
    for (const table of FACTORY_CORE) {
      expect(sql).toMatch(new RegExp(`revoke\\s+all\\s+on\\s+public\\.${table}\\s+from\\s+public,\\s*anon`, 'i'));
    }
  });

  it('전역 유일성 제약이 제거된다', () => {
    // 로컬 격리 검증에서 실제로 걸린 결함이다:
    //   ERROR: duplicate key value violates unique constraint "machines_name_key"
    //
    // 공장 범위 UNIQUE 를 **추가**해도 전역 UNIQUE 가 남아 있으면 넓은 쪽이 아니라
    // 좁은 쪽이 이긴다 — ALT 와 ALV 가 같은 설비명을 쓸 수 없다.
    //
    // "추가했다"는 grep 으로 확인되지만 "낡은 것이 남아 있다"는 실제로 넣어 봐야 드러난다.
    // 그 실측을 여기 정적 검사로 되먹인다.
    expect(sql).toMatch(/drop\s+constraint\s+if\s+exists\s+machines_name_key/i);
    expect(sql).toMatch(/drop\s+constraint\s+if\s+exists\s+product_models_model_name_key/i);
    expect(sql).toMatch(/drop\s+constraint\s+if\s+exists\s+system_settings_setting_key_key/i);
  });

  it('공장 소유 테이블의 factory_id 가 최종적으로 NOT NULL 이다', () => {
    // 계약 1절: "NULL factory_id = ALT 같은 영구 호환 규칙은 금지한다."
    // expand 의 nullable 은 임시이며 contract 가 닫아야 한다. 닫지 않으면 "공장을 모르는
    // 데이터" 라는 상태가 영구히 남고, 그것이 곧 금지된 호환 규칙이 된다.
    for (const table of FACTORY_OWNED) {
      expect(sql).toMatch(
        new RegExp(`alter\\s+table\\s+public\\.${table}\\s+alter\\s+column\\s+factory_id\\s+set\\s+not\\s+null`, 'i')
      );
    }
  });

  it('공장 소유 테이블에 INSERT 하는 함수는 예외 없이 factory_id 를 채운다', () => {
    // ## 이 검사의 초판이 놓친 것
    //
    // 초판은 `production_shift_states` **한 테이블**만 봤다:
    //
    //   expect(sql).toMatch(/insert into public.production_shift_states\s*\(\s*factory_id,/i)
    //
    // 그래서 `audit_log` 에 쓰는 두 함수(`correct_open_downtime_reason`,
    // `close_shift_upsert_v3`)를 통째로 놓쳤고, contract 가 그 컬럼을 NOT NULL 로 만든 뒤
    // **비가동 사유 정정이 100% 실패하고 하향 마감이 트랜잭션째 롤백되는** 상태였다.
    // 존재를 세면 전수를 놓친다 — 이 저장소에서 같은 형태로 반복된 실패다.
    //
    // ## 두 가지 통과 조건
    //
    //   1. INSERT 가 컬럼 목록에 `factory_id` 를 직접 적는다, 또는
    //   2. 그 테이블에 BEFORE INSERT 유도 트리거가 있다(20260824210000 / 20260824220000).
    //
    // 어느 쪽도 아니면 그 함수는 실행되는 순간 NOT NULL 로 실패한다.
    const derived = derivedInsertTables();
    const offenders: string[] = [];

    for (const [fn, body] of finalFunctionBodies()) {
      for (const { table, columns } of insertTargets(body)) {
        if (!FACTORY_OWNED.includes(table as (typeof FACTORY_OWNED)[number])) continue;
        if (columns !== null && /\bfactory_id\b/.test(columns)) continue;
        if (derived.has(table)) continue;
        if (WINDOW_ONLY_LEGACY.includes(`${fn} -> ${table}`)) continue;
        offenders.push(`${fn} -> ${table}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('배포 창 전용 예외가 늘어나지 않는다', () => {
    // 예외를 허용하는 순간 목록은 자란다. 자라는 것을 막는 유일한 방법은 **개수를 못 박는
    // 것**이다. 새 예외를 넣으려면 이 숫자를 고쳐야 하고, 그때 사유를 적게 된다.
    expect(WINDOW_ONLY_LEGACY).toHaveLength(1);
  });

  it('유도 트리거 목록이 비어 있지 않다', () => {
    // 위 검사가 "유도 트리거가 전부 있다"로 공허하게 통과하는 상황을 배제한다.
    // 파싱이 깨져 derived 가 모든 테이블을 담으면 위 검사는 무엇도 잡지 못한다.
    const derived = derivedInsertTables();
    expect(derived.size).toBeGreaterThan(0);
    expect(derived.size).toBeLessThan(FACTORY_OWNED.length);
    expect(derived.has('audit_log')).toBe(true);
  });

  it('전수 회수 뒤 service_role 에 권한을 되돌려 준다', () => {
    // `revoke all ... from public` 은 service_role 이 PUBLIC 을 통해 갖던 권한까지 끊는다.
    // 회수는 옳지만 **되돌려주는 절반**을 빠뜨리면 서버가 통째로 멈춘다.
    //
    // 실측: 이 grant 없이 PostgREST 는 42501 permission denied 를 돌려주고,
    // requireFactoryUser 를 쓰는 모든 Route 가 500 이 된다. 이 앱은 Route 44개 중 40개가
    // Service Role 로 동작한다.
    //
    // 정적 검사도 psql 격리 테스트도 이것을 잡지 못했다 — 전부 postgres 슈퍼유저로
    // 실행되기 때문이다. 실제 역할로 HTTP 를 쳐 봐야 드러난다. 그 실측을 여기 되먹인다.
    for (const table of FACTORY_CORE) {
      expect(sql).toMatch(
        new RegExp(`grant\\s+all\\s+on\\s+public\\.${table}\\s+to\\s+service_role`, 'i')
      );
    }
    expect(sql).toMatch(/grant\s+all\s+on\s+public\.global_admins\s+to\s+service_role/i);
  });

  describe('RLS cutover', () => {
    it('공장 소유 테이블마다 공장 인지 읽기 정책이 있다', () => {
      // 정책이 0개면 deny-all 이라 "안전"해 보이지만, 그 상태에서는 브라우저가 아무것도
      // 읽지 못해 앱이 Service Role 에만 의존하게 된다 — 계약 1절의 "최종 보안 경계는 RLS"
      // 가 성립하지 않는다.
      for (const table of FACTORY_OWNED) {
        expect(sql).toMatch(
          new RegExp(`create\\s+policy\\s+"factory read ${table}"\\s+on\\s+public\\.${table}`, 'i')
        );
      }
    });

    it('읽기 정책은 factory_id 를 current_user_factory() 와 비교한다', () => {
      // 인자 있는 helper(has_factory_membership(factory_id))를 술어로 쓰면 factory_id 가
      // 컬럼이라 **행마다** 호출된다. 6만행 테이블에서 치명적이다.
      // 인자 없는 helper 는 InitPlan 으로 한 번만 평가되고 factory 선두 index 를 탄다.
      const matches = sql.match(/factory_id = \(select public\.current_user_factory\(\)\)/g) ?? [];
      expect(matches.length).toBeGreaterThanOrEqual(FACTORY_OWNED.length - 2);
    });

    it('operator 담당 설비는 in(select unnest(..)) 로 비교한다', () => {
      // 이 저장소는 RLS 술어를 in(select unnest(..)) 로 바꿔 166배를 얻은 적이 있다
      // (2026-07-29). 같은 형태를 유지한다.
      expect(sql).toMatch(/in \(select unnest\(\(select public\.current_factory_machine_ids\(\)\)\)\)/);
    });

    it('낡은 무범위 정책을 제거한다', () => {
      // Postgres 의 여러 PERMISSIVE 정책은 OR 로 결합된다. 좁은 정책을 추가해도 넓은
      // 정책이 남아 있으면 넓은 쪽이 이긴다.
      expect(sql).toMatch(/drop policy if exists "모든 인증된 사용자는 시스템 설정을 볼 수 있"/);
      expect(sql).toMatch(/drop policy if exists "Authenticated users can modify machines"/);
      expect(sql).toMatch(/drop policy if exists "Scoped read machines"/);
    });

    it('current_user_factory() 는 membership 이 정확히 하나일 때만 값을 준다', () => {
      // 2개 이상에서 아무거나 고르면 사용자가 어느 공장에 쓰고 있는지 모르는 채로 쓰게 된다.
      // 서버 계약(requireFactoryUser)이 같은 이유로 거부한다 — 두 층의 판정이 일치해야 한다.
      expect(sql).toMatch(/case when count\(\*\) = 1 then \(array_agg\(fm\.factory_id\)\)\[1\] end/);
    });
  });

  it('global_admins 는 authenticated 에게 읽기조차 주지 않는다', () => {
    // 전역 권한자 명단은 일반 사용자가 알아야 할 정보가 아니다.
    expect(sql).not.toMatch(/grant\s+select\s+on\s+public\.global_admins\s+to\s+authenticated/i);
  });
});
