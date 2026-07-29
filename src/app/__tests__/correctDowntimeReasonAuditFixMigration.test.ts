import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260729010000_correct_downtime_reason_audit_fix.sql'),
  'utf8'
);

/**
 * 20260728010000 의 정정 RPC 는 audit_log.record_id(NOT NULL)에 v_entry_id 를 넣었다.
 * 열린 downtime_entries 가 없는 설비(= 설비 상태 입력 화면으로만 내려간 설비)에서는 그 값이
 * NULL 이라 23502 로 트랜잭션 전체가 롤백되고 API 가 500 을 반환했다 — 즉 그 경로의 정정은
 * **한 번도 성공할 수 없었다**. 이 파일이 그 수정을 고정한다.
 */
describe('정정 RPC 감사 기록 수정', () => {
  it('RPC 를 create or replace 로 대체한다', () =>
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.correct_open_downtime_reason/i));

  it('audit_log.record_id 에 machine_id 를 넣는다 (NULL 이 될 수 없는 값)', () => {
    const insertBlock = /insert\s+into\s+public\.audit_log[\s\S]*?;/i.exec(sql)?.[0] ?? '';
    expect(insertBlock).toMatch(/'machines'/);
    expect(insertBlock).toMatch(/p_machine_id/);
    // 열린 항목이 없으면 NULL 인 값을 record_id 자리에 다시 넣으면 안 된다.
    expect(insertBlock).not.toMatch(/'machines',\s*\n?\s*v_entry_id/);
  });

  it('어느 downtime_entry 가 함께 바뀌었는지는 값 payload 에 남긴다', () => {
    const insertBlock = /insert\s+into\s+public\.audit_log[\s\S]*?;/i.exec(sql)?.[0] ?? '';
    expect(insertBlock).toMatch(/'downtime_entry_id',\s*v_entry_id/);
  });

  it('audit_log.action 리터럴이 varchar(20) 을 넘지 않는다', () => {
    const insertBlock = /insert\s+into\s+public\.audit_log[\s\S]*?;/i.exec(sql)?.[0] ?? '';
    const action = [...insertBlock.matchAll(/'([^']*)'/g)]
      .map(m => m[1])
      .find(v => v.includes('correct'));
    expect(action).toBeDefined();
    expect(action!.length).toBeLessThanOrEqual(20);
  });

  it('고칠 대상이 없으면 아무것도 쓰지 않고 no_open_downtime 을 돌려준다', () => {
    expect(sql).toMatch(/v_open_logs\s*=\s*0\s+and\s+v_entry_id\s+is\s+null[\s\S]*?no_open_downtime/i);
  });

  // 트리거를 억제한 채 current_state 만 바꾸면 그 상태를 담은 machine_logs 행이 없는 채로
  // 남는다 — 트리거가 machine_logs 의 유일한 writer 라는 불변조건이 깨진다.
  it('판단(읽기)이 set_config 보다 앞선다 — 쓰기 전에 대상 유무를 확정한다', () => {
    const guardAt = sql.search(/no_open_downtime/);
    const writeAt = sql.search(/set_config\('app\.suppress_status_log'/);
    expect(guardAt).toBeGreaterThan(-1);
    expect(writeAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(writeAt);
  });

  it('기존 계약을 유지한다 — advisory lock · 가동 중 거부 · 동일 사유 no-op', () => {
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_machine_id::text,\s*0\)\)/);
    expect(sql).toMatch(/v_state\s*=\s*'NORMAL_OPERATION'[\s\S]*?not_in_downtime/i);
    expect(sql).toMatch(/v_state\s*=\s*p_reason[\s\S]*?noop/i);
  });

  it('여전히 덮어쓰기다 — 시작 시각을 바꾸거나 새 구간을 만들지 않는다', () => {
    expect(sql).not.toMatch(/update\s+public\.downtime_entries[\s\S]{0,200}start_time\s*=/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.downtime_entries/i);
  });

  it('열린 항목은 가장 최근 1건만 고친다', () => {
    expect(sql).toMatch(/order\s+by\s+start_time\s+desc[\s\S]*?limit\s+1/i);
    expect(sql).toMatch(/update\s+public\.downtime_entries\s+set\s+reason\s*=\s*p_reason\s+where\s+id\s*=\s*v_entry_id/i);
  });

  it('service_role 에만 EXECUTE 를 준다', () => {
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.correct_open_downtime_reason[\s\S]*?anon,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.correct_open_downtime_reason[\s\S]*?to\s+service_role/i);
  });
});
