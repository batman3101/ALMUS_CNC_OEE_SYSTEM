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

  it('행을 INSERT 하는 트리거가 factory_id 를 채운다', () => {
    // contract 적용 후 정상 생산기록 저장이 실패했다:
    //   ERROR: null value in column "factory_id" of relation "production_shift_states"
    //
    // 스키마만 factory-aware 가 되고 트리거가 그대로면 앱이 아예 동작하지 않는다.
    // 계약 4.3: "trigger/RPC 는 공장을 parent 에서 파생한다."
    expect(sql).toMatch(
      /insert\s+into\s+public\.production_shift_states\s*\(\s*factory_id\s*,/i
    );
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

  it('global_admins 는 authenticated 에게 읽기조차 주지 않는다', () => {
    // 전역 권한자 명단은 일반 사용자가 알아야 할 정보가 아니다.
    expect(sql).not.toMatch(/grant\s+select\s+on\s+public\.global_admins\s+to\s+authenticated/i);
  });
});
