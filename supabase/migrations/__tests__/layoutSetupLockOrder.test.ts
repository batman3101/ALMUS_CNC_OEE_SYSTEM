import fs from 'fs';
import path from 'path';

/**
 * Layout 확정·셋업 완료의 잠금 순서와 확정 계획 가드 (Codex 감사 2026-09-28 F-01·F-02, 20260928160000).
 *
 * 확정은 설비(FOR SHARE) → 셋업 작업(FOR UPDATE), 완료는 예전에 작업 → 설비 순이라 동시에 돌면 서로를 기다려
 * 교착(40P01)이 났다(로컬 두 세션 재현). 두 경로가 **같은 순서**여야 한다: 설비 먼저, 작업 나중.
 * 마이그레이션 전체에서 각 함수의 **최종 정의**를 모아 검사한다 — 나중 마이그레이션이 순서를 되돌리면 여기서 걸린다.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase/migrations');

function latestDefinition(name: string): string {
  let body = '';
  for (const file of fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    const header = /create\s+(?:or\s+replace\s+)?function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;
    const starts: Array<{ name: string; index: number }> = [];
    let m: RegExpExecArray | null;
    while ((m = header.exec(sql)) !== null) starts.push({ name: m[1].toLowerCase(), index: m.index });
    starts.forEach((s, i) => {
      if (s.name === name) body = sql.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : sql.length);
    });
  }
  if (!body) throw new Error(`${name} not found`);
  // 주석은 빼고 본다: 설명 문장에 나오는 "for update" 가 순서 판정을 속이지 않게.
  return body.replace(/--[^\n]*/g, '');
}

const at = (body: string, re: RegExp) => {
  const m = re.exec(body);
  if (!m) throw new Error(`pattern not found: ${re}`);
  return m.index;
};

const MACHINES_LOCK = /from\s+public\.machines\b[^;]*?for\s+(?:update|share)/i;
const TASK_LOCK = /from\s+public\.machine_setup_tasks\b[^;]*?for\s+update/i;

describe('Layout 확정·셋업 완료 잠금 순서 (감사 F-02)', () => {
  it('셋업 완료: 설비 advisory → 설비 행 → 작업 행', () => {
    const body = latestDefinition('transition_machine_setup_task');
    const advisory = at(body, /pg_advisory_xact_lock\(\s*hashtextextended\(\s*v_machine_id::text\s*,\s*0\s*\)\s*\)/i);
    const machine = at(body, MACHINES_LOCK);
    const task = at(body, TASK_LOCK);
    expect(advisory).toBeLessThan(machine);
    expect(machine).toBeLessThan(task);
  });

  it('확정: 설비 FOR SHARE → 셋업 작업 FOR UPDATE', () => {
    const body = latestDefinition('confirm_layout_plan');
    expect(at(body, /from\s+public\.machines\s+m[\s\S]*?for\s+share\s+of\s+m/i)).toBeLessThan(at(body, TASK_LOCK));
  });
});

describe('셋업 작업은 확정 계획을 따른다 (감사 F-01)', () => {
  it('확정은 이 계획이 바꾸는 설비만이 아니라 공장의 이전 미완료 작업 전부를 대조한다', () => {
    const body = latestDefinition('confirm_layout_plan');
    const loop = /select\s+t\.\*\s+from\s+public\.machine_setup_tasks\s+t\s+where([\s\S]*?)for\s+update\s+of\s+t/i.exec(body);
    expect(loop).not.toBeNull();
    // 예전 결함: 이 계획의 바뀌는 설비(final ≠ base)로 좁혀 순회해 유지 설비의 옛 작업이 살아남았다.
    expect(loop![1]).not.toMatch(/layout_plan_assignments/i);
    expect(loop![1]).toMatch(/t\.plan_id\s*<>\s*p_plan_id/i);
  });

  it('시작·완료는 확정 계획의 작업만 허용한다', () => {
    expect(latestDefinition('transition_machine_setup_task')).toMatch(/SETUP_PLAN_NOT_CURRENT/);
  });
});
