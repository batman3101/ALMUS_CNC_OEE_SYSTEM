import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 20260718000001 마이그레이션의 텍스트 계약. 이 SQL 은 아직 운영에 적용되지 않았고
// (규칙상 대기), API 테스트는 report_shift_progress 를 mock 하므로 실제 SQL 을 증명하지 않는다.
// 이 파일이 그 공백을 메운다 — 마이그레이션이 잘못 편집되면(락 제거, 소스 누락, 권한 확대 등)
// 여기서 사망한다. 테이블 마이그레이션을 pin 하는 progressReportsMigration.test.ts 와 같은 방식.
const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260718000001_progress_reports_monotonic.sql'),
  'utf8',
);

describe('report_shift_progress 원자 저장 마이그레이션 계약', () => {
  it('advisory lock 으로 같은 교대 삽입을 직렬화한다', () => {
    // 이게 없으면 SELECT max → INSERT 가 READ COMMITTED 에서 여전히 경쟁한다.
    expect(sql).toMatch(/pg_advisory_xact_lock/);
  });

  it('비가동을 두 소스(machine_logs + downtime_entries)로 확인한다', () => {
    // 가동률 계산과 같은 정의. 한쪽만 보면 잠금이 가동률과 어긋난다.
    expect(sql).toMatch(/from\s+public\.machine_logs/i);
    expect(sql).toMatch(/from\s+public\.downtime_entries/i);
    expect(sql).toMatch(/machine_in_downtime/);
  });

  it('단조증가 위반 시 현재 최댓값을 함께 돌려준다', () => {
    // last_reported_qty 가 있어야 모달이 일반 실패가 아닌 감소 안내를 띄운다.
    expect(sql).toMatch(/'reason',\s*'decreased'[\s\S]*'last_reported_qty'/);
  });

  it('service_role 에만 EXECUTE, anon/authenticated 는 회수한다', () => {
    // 신규 public 함수는 기본 ACL 로 PUBLIC 에 EXECUTE 가 붙으므로 REVOKE 가 선행돼야 한다.
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.report_shift_progress[\s\S]*anon,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.report_shift_progress[\s\S]*to\s+service_role/i);
  });

  it('단조 트리거(직접 INSERT 방어 백스톱)도 유지한다', () => {
    expect(sql).toMatch(/create\s+trigger\s+progress_reports_monotonic/i);
    expect(sql).toMatch(/enforce_progress_monotonic/);
  });
});
