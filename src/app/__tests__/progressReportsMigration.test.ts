import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PATH = 'supabase/migrations/20260718000000_production_progress_reports.sql';
const TABLE = 'production_progress_reports';

/**
 * 이 테스트는 파일 텍스트만 본다 — DB 에 적용하지 않기 때문이다 (사용자 지시).
 * 그래서 SQL 문법 오류는 잡지 못한다. 잡을 수 있는 것은 "설계 결정이 파일에 살아 있는가" 뿐이고,
 * 문법은 Task 9 에서 실제 적용할 때 드러난다.
 */
const sql = (): string => readFileSync(resolve(process.cwd(), PATH), 'utf8');

/** SQL 주석(-- ...)을 지운다. 주석에 적은 설명이 금지 패턴에 걸리면 안 된다 —
 *  실제로 이 저장소에서 주석이 계약 테스트를 깨뜨린 적이 있다.
 *  단, 주석 자체가 검사 대상인 테스트에서는 쓰지 않는다. */
const stripSqlComments = (source: string): string => source.replace(/--.*$/gm, '');

/** 이 테이블에 대해 `role` 에게 GRANT 된 권한을 모은다. */
const privilegesGrantedTo = (role: string): string[] => {
  const pattern = new RegExp(
    String.raw`grant\s+([\w\s,]+?)\s+on\s+table\s+(?:public\.)?${TABLE}\s+to\s+([\w\s,]+?)\s*;`,
    'gi',
  );
  const granted: string[] = [];
  for (const match of stripSqlComments(sql()).matchAll(pattern)) {
    const grantees = match[2].split(',').map((g) => g.trim().toLowerCase());
    if (!grantees.includes(role)) continue;
    granted.push(...match[1].split(',').map((p) => p.trim().toUpperCase()));
  }
  return granted.sort();
};

/** 이 테이블에 대해 REVOKE ALL 대상이 된 역할들. */
const revokedRoles = (): string[] => {
  const pattern = new RegExp(
    String.raw`revoke\s+all\s+on\s+table\s+(?:public\.)?${TABLE}\s+from\s+([\w\s,]+?)\s*;`,
    'i',
  );
  const match = stripSqlComments(sql()).match(pattern);
  return match ? match[1].split(',').map((r) => r.trim().toLowerCase()) : [];
};

describe('production_progress_reports 마이그레이션', () => {
  it('마이그레이션 파일이 존재한다', () => {
    expect(existsSync(resolve(process.cwd(), PATH))).toBe(true);
  });

  // append-only 는 RLS 가 아니라 **UPDATE/DELETE 를 GRANT 하지 않음**으로써 강제된다.
  // 이 저장소의 모든 접근은 supabaseAdmin(service_role)을 거치고, service_role 은 BYPASSRLS 라
  // 정책은 우회하지만 테이블 권한은 우회하지 못한다. 그래서 이 GRANT 목록이 유일한 방어선이다.
  it('service_role 에게 SELECT/INSERT 만 준다 — 이것이 append-only 를 만든다', () => {
    expect(privilegesGrantedTo('service_role')).toEqual(['INSERT', 'SELECT']);
  });

  // public 스키마의 default ACL 이 새 테이블에 anon/authenticated/service_role 전 권한을 자동으로
  // 준다. GRANT 는 더하기만 하므로 REVOKE 가 service_role 을 포함하지 않으면 UPDATE/DELETE 가
  // 조용히 살아난다 — system_settings_audit(INSERT 만 GRANT → 실제 전 권한)이 그 증거다.
  it('REVOKE 가 service_role 을 포함한다 — GRANT 로는 좁힐 수 없다', () => {
    expect(revokedRoles()).toEqual(
      expect.arrayContaining(['public', 'anon', 'authenticated', 'service_role']),
    );
  });

  // anon/authenticated 에게는 어떤 권한도 주지 않는다. 직접 접근(shipped anon key + 사용자 JWT)은
  // API 의 assertMachineAccess/감소 감지를 우회하므로, 정책으로 흉내내지 말고 통째로 닫는다.
  it('anon/authenticated 에게 아무 권한도 주지 않는다', () => {
    expect(privilegesGrantedTo('anon')).toEqual([]);
    expect(privilegesGrantedTo('authenticated')).toEqual([]);
  });

  // 정책은 REVOKE 와 어긋난 두 번째 진실을 만든다. 이전 버전의 이 파일은
  // WITH CHECK (auth.uid() = operator_id) 로 "작성자만" 검사해, 담당 아닌 설비로도 감소하는
  // 값으로도 쓸 수 있는 뒷문이었다. 정책이 없으면 RLS 는 전면 차단이다.
  it('정책을 만들지 않는다', () => {
    expect(stripSqlComments(sql()).toLowerCase()).not.toContain('create policy');
  });

  it('RLS 를 켠다 — GRANT 부재와 독립된 두 번째 자물쇠', () => {
    expect(stripSqlComments(sql()).toLowerCase()).toContain('enable row level security');
  });

  // 조회는 항상 "이 설비, 이 날짜, 이 교대의 최신 보고" 를 찾는다.
  it('조회 패턴에 맞는 인덱스를 만든다', () => {
    expect(stripSqlComments(sql())).toMatch(/create index[\s\S]*machine_id[\s\S]*date[\s\S]*shift/i);
  });

  // 진행 중 데이터와 확정 데이터를 물리적으로 분리하는 것이 이 설계의 핵심이다.
  // production_records 를 건드리는 순간 기존 분석 RPC 전체가 사정권에 들어온다.
  it('production_records 를 건드리지 않는다', () => {
    expect(stripSqlComments(sql())).not.toMatch(/alter table\s+(public\.)?production_records/i);
    expect(stripSqlComments(sql())).not.toMatch(/drop table/i);
  });

  // shift_output_qty 의 의미는 "이 교대에서 지금까지 만든 총 개수" 하나다.
  // 누적이므로 음수가 될 수 없다.
  it('수량에 음수를 허용하지 않는다', () => {
    expect(stripSqlComments(sql())).toMatch(/shift_output_qty[\s\S]{0,80}>=\s*0/i);
  });

  // B 교대는 자정을 넘는다. date 는 교대 시작일로 귀속되며, shift 는 A/B 만 존재한다.
  it('shift 를 A/B 로 제한한다', () => {
    expect(stripSqlComments(sql())).toMatch(/shift[\s\S]{0,60}check[\s\S]{0,40}'A'[\s\S]{0,20}'B'/i);
  });

  // 주석 자체가 검사 대상이므로 여기서는 주석을 지우지 않는다.
  // 이 테스트가 지키는 것은 "다음 사람이 파일만 읽고 틀린 결론에 도달하지 않는가" 다.
  // 지킬 수 없는 것: 문장이 실제로 참인지. 키워드 존재만 확인하므로 설명이 삭제되면 죽지만,
  // 설명이 틀리게 고쳐지면 잡지 못한다.
  it('파일만 읽고는 알 수 없는 사실과 진짜 보호 수단을 기록한다', () => {
    const source = sql();
    // REVOKE 에 service_role 이 왜 있는지 — default ACL 은 이 파일에 보이지 않는다.
    expect(source).toMatch(/default acl/i);
    // service_role 이 정책을 우회한다는 사실.
    expect(source).toMatch(/BYPASSRLS/i);
    // 진짜 인가는 API 계층에 있다.
    expect(source).toMatch(/requireUser/);
    expect(source).toMatch(/assertMachineAccess/);
  });
});
