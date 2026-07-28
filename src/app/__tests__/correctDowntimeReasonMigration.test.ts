import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260728010000_correct_open_downtime_reason.sql'),
  'utf8'
);

// 진행 중 비가동의 사유 정정. 분할이 아니라 덮어쓰기.
// (적용은 사용자 명시 지시 대기 — applied-migrations.json 의 intentionally_skipped 참조)
describe('correct_open_downtime_reason 마이그레이션', () => {
  it('정정 RPC 를 정의한다', () =>
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.correct_open_downtime_reason/i));

  it('toggle 과 같은 advisory lock 키로 직렬화한다', () =>
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_machine_id::text,\s*0\)\)/));

  it('가동 중이면 정정하지 않는다', () =>
    expect(sql).toMatch(/v_state\s*=\s*'NORMAL_OPERATION'[\s\S]*?not_in_downtime/i));

  it('같은 사유면 no-op', () =>
    expect(sql).toMatch(/v_state\s*=\s*p_reason[\s\S]*?noop/i));

  it('열린 downtime_entries 는 가장 최근 1건만 고친다', () => {
    expect(sql).toMatch(/order\s+by\s+start_time\s+desc[\s\S]*?limit\s+1/i);
    expect(sql).toMatch(/update\s+public\.downtime_entries\s+set\s+reason\s*=\s*p_reason\s+where\s+id\s*=\s*v_entry_id/i);
  });

  it('시작 시각을 바꾸지 않는다 (덮어쓰기이지 분할이 아니다)', () => {
    expect(sql).not.toMatch(/update\s+public\.downtime_entries[\s\S]{0,200}set[\s\S]{0,200}start_time\s*=/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.downtime_entries/i);
  });

  it('정정을 audit_log 에 남긴다', () => {
    expect(sql).toMatch(/insert\s+into\s+public\.audit_log/i);
    expect(sql).toMatch(/'correct_downtime_reason'/);
  });

  it('service_role 에만 EXECUTE 를 준다', () => {
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.correct_open_downtime_reason[\s\S]*?anon,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.correct_open_downtime_reason[\s\S]*?to\s+service_role/i);
  });
});

// 트리거는 machine_logs 의 유일한 writer 다. 억제 플래그가 일반 전환의 로깅까지 죽이면
// 상태 이력이 조용히 사라진다 — 이 describe 가 그 회귀를 막는다.
describe('log_machine_status_change 억제 플래그', () => {
  it('트랜잭션 로컬 GUC 를 읽어 정정일 때만 비켜선다', () =>
    expect(sql).toMatch(/current_setting\('app\.suppress_status_log',\s*true\)[\s\S]*?=\s*'1'[\s\S]*?return\s+new/i));

  it('RPC 는 GUC 를 트랜잭션 로컬(is_local = true)로만 심는다', () =>
    expect(sql).toMatch(/set_config\('app\.suppress_status_log',\s*'1',\s*true\)/));

  it('플래그가 꺼진 일반 전환은 여전히 열린 로그를 닫고 새 로그를 연다', () => {
    expect(sql).toMatch(/update\s+machine_logs\s+set\s+end_time\s*=\s*now\(\)/i);
    expect(sql).toMatch(/insert\s+into\s+machine_logs\s*\(machine_id,\s*state,\s*start_time/i);
  });

  it('operator GUC 우선 규칙(20260718000004)을 유지한다', () =>
    expect(sql).toMatch(/current_setting\('app\.status_operator_id',\s*true\)/));
});
