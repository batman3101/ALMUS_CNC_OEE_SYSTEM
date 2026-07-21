/**
 * 교대 쓰기 원자성 마이그레이션(20260720010000·20260720030000) 텍스트 고정.
 *
 * SQL 런타임 동작은 supabase/tests/shift_write_invariants.sql 이 실행 검증한다
 * (전부 롤백되는 DO 블록 — 성공 마커는 ALL_INVARIANTS_PASSED 예외).
 * 이 테스트는 CI 에서 psql 없이도 핵심 가드가 마이그레이션 파일에서 사라지지
 * 않았는지를 고정한다(기존 *Migration.test.ts 들과 동일한 방식).
 */
import fs from 'fs';
import path from 'path';

const read = (name: string) =>
  fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

describe('20260720010000_shift_write_atomicity', () => {
  const sql = read('20260720010000_shift_write_atomicity.sql');

  it('report_shift_progress 가 andon 과 같은 machine 단독 락을 먼저 잡는다 (락 키 정렬)', () => {
    const body = sql.slice(sql.indexOf('report_shift_progress'));
    const machineLock = body.indexOf("hashtextextended(p_machine_id::text, 0)");
    const compositeLock = body.indexOf("p_machine_id::text || p_date::text || p_shift");
    expect(machineLock).toBeGreaterThan(-1);
    expect(compositeLock).toBeGreaterThan(-1);
    expect(machineLock).toBeLessThan(compositeLock); // 잠금 순서 고정(데드락 방지)
  });

  it('close_shift_upsert 가 재마감 시 확정 불량을 보존한다 (F2 원자화)', () => {
    expect(sql).toMatch(/defect_qty\s*=\s*production_records\.defect_qty/);
  });

  it('confirm_shift_defect 가 재마감과 같은 composite 락을 잡는다', () => {
    const body = sql.slice(sql.indexOf('confirm_shift_defect'));
    expect(body).toMatch(/v_machine::text \|\| v_date::text \|\| v_shift/);
  });
});

describe('20260720030000_shift_write_guards', () => {
  const sql = read('20260720030000_shift_write_guards.sql');

  it('output < 확정 defect 재마감을 거부한다', () => {
    expect(sql).toMatch(/output_lt_defect/);
    expect(sql).toMatch(/v_defect is not null and v_defect > p_output_qty/);
  });

  it('락 획득 후 재읽기에서 record 소멸을 무음 성공시키지 않는다', () => {
    // confirm_shift_defect 본문에 not_found 반환이 (첫 읽기 + 재읽기) 두 번 있어야 한다.
    const body = sql.slice(sql.indexOf('confirm_shift_defect'));
    const occurrences = body.split("'not_found'").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  it('비활성 설비의 andon 을 거부한다', () => {
    expect(sql).toMatch(/machine_inactive/);
    expect(sql).toMatch(/if not v_active then/);
  });
});
