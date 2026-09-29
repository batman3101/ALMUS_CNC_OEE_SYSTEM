import fs from 'fs';
import path from 'path';

/**
 * 코드 ↔ DB 계약. poOverrideStore 는 DB 함수를 이름과 인자 이름으로 부르고 컬럼 이름으로 조회한다.
 * 각 쪽의 단위 테스트는 자기 쪽 목록만 확인하므로, 한쪽만 오타가 나면 둘 다 통과한 채 운영에서 깨진다.
 * 여기서는 마이그레이션 파일(정본)에서 이름을 읽어 코드가 실제로 쓰는 이름과 맞춘다.
 * (줄 단위로 읽는다 - 정규식의 이스케이프에 기대지 않는다.)
 */
const mockRpc = jest.fn();
const mockSelects: string[] = [];
const SUBMISSION = '11111111-1111-4111-8111-111111111111';
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => ({
      select: (columns: string) => {
        mockSelects.push(table + ':' + columns);
        return table === 'forecast_submissions'
          ? { eq: () => ({ maybeSingle: async () => ({ data: { submission_id: '11111111-1111-4111-8111-111111111111', preview: { rows: [{ sourceRow: 15, model: 'ON 1', processes: ['CNC1'], quantities: [{ date: '2026-10-05', state: 'number', quantity: 9000 }] }] } }, error: null }) }) }
          : { eq: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }) };
      },
    }),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));
import { applyPoOverride, loadPoOverrides, revertPoOverride } from '../poOverrideStore';

const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const lines = (relative: string) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8').split(CR).join('').split(LF);
const migration = lines('supabase/migrations/20260929130000_forecast_po_overrides.sql');
const submissionsMigration = lines('supabase/migrations/20260929100000_forecast_submissions.sql');

/** create or replace function public.<name>( 다음 줄부터 ')' 로 시작하는 줄까지의 인자 이름들. */
const functionParams = (name: string): string[] => {
  const start = migration.findIndex(line => line.startsWith('create or replace function public.' + name + '('));
  if (start < 0) throw new Error(name + ' 정의를 마이그레이션에서 찾지 못했다');
  const names: string[] = [];
  for (let i = start + 1; i < migration.length && !migration[i].startsWith(')'); i += 1) {
    const token = migration[i].trim().split(' ')[0];
    if (token.startsWith('p_')) names.push(token);
  }
  return names.sort();
};

/** create table public.<table> ( 다음 줄부터 ');' 줄까지, 두 칸 들여쓴 '이름 타입' 줄의 이름들. */
const tableColumns = (source: string[], table: string): string[] => {
  const start = source.findIndex(line => line.startsWith('create table public.' + table + ' ('));
  if (start < 0) throw new Error(table + ' 정의를 찾지 못했다');
  const types = ['uuid', 'integer', 'date', 'text', 'numeric', 'timestamptz', 'jsonb', 'boolean'];
  const columns: string[] = [];
  for (let i = start + 1; i < source.length && source[i] !== ');'; i += 1) {
    const line = source[i];
    if (!line.startsWith('  ') || line.startsWith('   ')) continue;
    const [name, type] = line.trim().split(' ');
    if (types.includes((type ?? '').split(',').join(''))) columns.push(name);
  }
  return columns;
};

const target = { submissionId: SUBMISSION, sourceRow: 15, date: '2026-10-05' };
beforeEach(() => {
  jest.clearAllMocks();
  mockSelects.length = 0;
  mockRpc.mockResolvedValue({ data: { quantity: 1, updated_at: 't', unchanged: false, reverted: true }, error: null });
});

describe('코드 ↔ DB 계약 (마이그레이션 20260929130000)', () => {
  it('정의 파서가 실제로 인자·컬럼을 읽는다 (빈 목록끼리 같아서 통과하는 일이 없게)', () => {
    expect(functionParams('apply_forecast_po_override')).toHaveLength(9);
    expect(functionParams('revert_forecast_po_override')).toHaveLength(5);
    expect(tableColumns(migration, 'forecast_po_overrides')).toEqual(expect.arrayContaining(['factory_id', 'submission_id', 'source_row', 'work_date', 'quantity', 'updated_at']));
    expect(tableColumns(submissionsMigration, 'forecast_submissions')).toEqual(expect.arrayContaining(['factory_id', 'preview', 'submitted_at']));
  });

  it('apply RPC: 부르는 함수 이름과 인자 이름이 마이그레이션의 함수 정의와 같다', async () => {
    await applyPoOverride({ id: 'f1' }, 'user-1', { ...target, quantity: 5 });
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe('apply_forecast_po_override');
    expect(Object.keys(args).sort()).toEqual(functionParams('apply_forecast_po_override'));
  });

  it('revert RPC: 부르는 함수 이름과 인자 이름이 마이그레이션의 함수 정의와 같다', async () => {
    await revertPoOverride({ id: 'f1' }, 'user-1', target);
    const [name, args] = mockRpc.mock.calls[0];
    expect(name).toBe('revert_forecast_po_override');
    expect(Object.keys(args).sort()).toEqual(functionParams('revert_forecast_po_override'));
  });

  it('현재 수정값을 읽을 때 고르는 컬럼은 모두 forecast_po_overrides 에 있다', async () => {
    await loadPoOverrides('f1', SUBMISSION);
    const selected = mockSelects.find(s => s.startsWith('forecast_po_overrides:'))!.split(':')[1].split(',').map(c => c.trim());
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.filter(c => !tableColumns(migration, 'forecast_po_overrides').includes(c))).toEqual([]);
  });

  it('접수본을 읽을 때 고르는 컬럼은 forecast_submissions 에 있다 (submission_id 는 이번 마이그레이션이 더한다)', async () => {
    await applyPoOverride({ id: 'f1' }, 'user-1', { ...target, quantity: 5 });
    const selected = mockSelects.find(s => s.startsWith('forecast_submissions:'))!.split(':')[1].split(',').map(c => c.trim());
    const added = migration.some(line => line.startsWith('  add column if not exists submission_id ')) ? ['submission_id'] : [];
    const known = [...tableColumns(submissionsMigration, 'forecast_submissions'), ...added];
    expect(selected.filter(c => !known.includes(c))).toEqual([]);
  });

  it('DB 함수가 돌려주는 키를 마이그레이션이 실제로 만든다 (updated_at·unchanged·reverted)', () => {
    const text = migration.join(LF);
    for (const key of ["'updated_at'", "'unchanged'", "'reverted'"]) expect(text).toContain(key);
  });
});
