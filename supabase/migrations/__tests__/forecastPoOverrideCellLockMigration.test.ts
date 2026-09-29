import fs from 'fs';
import path from 'path';

/**
 * 20260929150000 (감사 PO-02): 같은 칸의 적용·원복을 advisory 잠금으로 직렬화한다.
 * 실제 동시 실행은 진짜 Postgres 두 연결로 검증했다(원본은 최초 동시 수정에서 이력의 이전 값이 틀리고 이벤트가 중복됨).
 * 여기서는 그 잠금 규약이 이후 편집에서 조용히 사라지지 않게 정의 파일을 정적으로 지킨다.
 * (줄·문자열 단위로만 읽는다 - 정규식의 이스케이프에 기대지 않는다.)
 */
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const read = (name: string) => fs.readFileSync(path.join(process.cwd(), 'supabase/migrations', name), 'utf8').split(CR).join('');
const original = read('20260929130000_forecast_po_overrides.sql');
const fix = read('20260929150000_forecast_po_override_cell_lock.sql');
const FUNCTIONS = ['apply_forecast_po_override', 'revert_forecast_po_override'];

/** create or replace function public.<name>( 부터 다음 함수 정의·권한 문장 직전까지. */
function functionText(source: string, name: string): string {
  const start = source.indexOf('create or replace function public.' + name + '(');
  if (start < 0) throw new Error(name + ' 정의를 찾지 못했다');
  const rest = source.slice(start + 1);
  const stops = [rest.indexOf('create or replace function'), rest.indexOf('revoke all on function')].filter(i => i >= 0);
  return source.slice(start, stops.length ? start + 1 + Math.min(...stops) : source.length);
}
/** 'returns' 앞까지(이름과 인자 목록)를 공백을 접어 비교한다. */
const signature = (text: string) => text.split('returns')[0].split(LF).map(line => line.trim()).join(' ');
/** perform pg_advisory_xact_lock( ... , 0)); 문장 전체. */
function lockStatement(text: string): string {
  const start = text.indexOf('perform pg_advisory_xact_lock(');
  if (start < 0) return '';
  return text.slice(start, text.indexOf(', 0));', start) + 6).split(LF).map(line => line.trim()).join(' ');
}
const firstIndexOf = (text: string, needles: string[]) => Math.min(...needles.map(n => text.indexOf(n)).filter(i => i >= 0));

describe('20260929150000 forecast_po_override_cell_lock', () => {
  it('두 함수의 정의를 실제로 찾는다 (빈 비교로 통과하지 않게)', () => {
    for (const name of FUNCTIONS) expect(functionText(fix, name).length).toBeGreaterThan(400);
  });

  it('시그니처가 원본과 같다 - 인자가 다르면 create or replace 가 덮어쓰지 않고 오버로드를 만든다', () => {
    for (const name of FUNCTIONS) expect(signature(functionText(fix, name))).toBe(signature(functionText(original, name)));
  });

  it('적용·원복이 같은 칸 잠금을 쓴다: 표현이 완전히 같고 공장·접수·행·날짜 네 가지를 모두 키로 삼는다', () => {
    const [apply, revert] = FUNCTIONS.map(name => lockStatement(functionText(fix, name)));
    expect(apply).not.toBe('');
    expect(apply).toBe(revert);
    for (const part of ['p_factory_id', 'p_submission_id', 'p_source_row', 'p_work_date']) expect(apply).toContain(part);
    expect(apply).toContain('pg_advisory_xact_lock(hashtextextended(');
  });

  it('잠금이 접수 행·수정값 행의 첫 읽기·쓰기보다 앞선다 (advisory → FOR SHARE → FOR UPDATE 순서)', () => {
    for (const name of FUNCTIONS) {
      const text = functionText(fix, name);
      const lock = text.indexOf('perform pg_advisory_xact_lock(');
      expect(lock).toBeGreaterThan(0);
      const firstTouch = firstIndexOf(text, ['from public.forecast_submissions', 'from public.forecast_po_overrides', 'insert into public.forecast_po_overrides', 'delete from public.forecast_po_overrides']);
      expect(lock).toBeLessThan(firstTouch);
    }
  });

  it('보안 성질과 권한이 그대로다: security definer · search_path 고정 · anon/authenticated 회수 · service_role 만 실행', () => {
    for (const name of FUNCTIONS) {
      const text = functionText(fix, name);
      expect(text).toContain('security definer');
      expect(text).toContain('set search_path = public, pg_temp');
    }
    // 두 RPC 의 권한 블록(첫 revoke 부터 commit 앞까지)이 원본과 같다. 원본 파일에는 트리거 함수·표의 권한 문장도 있어 그것은 비교하지 않는다.
    const grants = (source: string) => {
      const from = source.indexOf('revoke all on function public.apply_forecast_po_override(');
      expect(from).toBeGreaterThan(0);
      return source.slice(from, source.lastIndexOf('commit;')).split(LF).map(line => line.trim()).filter(Boolean).join(LF);
    };
    expect(grants(fix)).toBe(grants(original));
    expect(grants(fix)).toContain('to service_role');
  });

  it('한 트랜잭션이고, 이미 적용된 원본 파일은 건드리지 않고 덧쓴다', () => {
    expect(fix.split(LF).filter(line => line.trim() === 'begin;')).toHaveLength(1);
    expect(fix.trimEnd().endsWith('commit;')).toBe(true);
    // 원본에는 잠금이 없다 - 원본을 고쳤다면 적용 원장의 해시와 어긋나 check:migrations 가 잡는다.
    expect(original).not.toContain('pg_advisory_xact_lock');
  });
});
