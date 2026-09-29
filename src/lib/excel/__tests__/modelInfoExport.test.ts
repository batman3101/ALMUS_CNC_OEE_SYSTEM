import * as XLSX from 'xlsx';
import type { SupabaseClient } from '@supabase/supabase-js';
import ko from '../../../../public/locales/ko/modelInfo.json';
import vi from '../../../../public/locales/vi/modelInfo.json';
import {
  buildModelInfoWorkbook, exportLabels, exportModelInfo, EXPORT_LABEL_KEYS, formatLocalDateTime, loadModelInfoForExport,
  ModelInfoExportError, modelInfoExportFilename, type ExportModelRow, type ExportProcessRow,
} from '../modelInfoExport';

// 파일을 실제로 내려받지는 않는다 - 만든 통합 문서와 파일 이름만 확인한다.
const mockWriteFile = jest.fn();
jest.mock('xlsx', () => ({ ...jest.requireActual('xlsx'), writeFile: (...args: unknown[]) => mockWriteFile(...args) }));

const model = (id: string, name: string, over: Partial<ExportModelRow> = {}): ExportModelRow =>
  ({ id, model_name: name, description: null, created_at: null, updated_at: null, ...over });
const proc = (id: string, modelId: string, order: number, name: string, over: Partial<ExportProcessRow> = {}): ExportProcessRow =>
  ({ id, model_id: modelId, process_name: name, process_order: order, tact_time_seconds: 100, cavity_count: 1, created_at: null, updated_at: null, ...over });

const labels = exportLabels(key => '«' + key + '»');
const NOW = new Date(2026, 8, 29, 14, 5); // 로컬 시간으로 만들어 시간대와 무관하게 같은 문자열이 나온다
const build = (models: ExportModelRow[], processes: ExportProcessRow[], factoryCode: string | null = 'ALT') =>
  buildModelInfoWorkbook({ models, processes, labels, factoryCode, exportedAt: NOW });
const rowsOf = (workbook: XLSX.WorkBook, name: string) =>
  XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: '' });

describe('buildModelInfoWorkbook - 시트 구성', () => {
  it('모델·공정·출력 정보 세 시트를 이 순서로 만든다', () => {
    const { workbook } = build([model('a', 'PA1')], []);
    expect(workbook.SheetNames).toEqual(['«export.sheetModels»', '«export.sheetProcesses»', '«export.sheetInfo»']);
  });

  it('모델 시트: 이름순(숫자는 크기순)이고, 공정 수는 넘겨받은 공정에서 센다', () => {
    const { workbook } = build(
      [model('m10', 'ON 10'), model('m2', 'ON 2', { description: '설명 있음' }), model('m1', 'Hubble Y2')],
      [proc('p1', 'm2', 1, 'CNC #1'), proc('p2', 'm2', 2, 'CNC #2'), proc('p3', 'm1', 1, 'CNC #1')],
    );
    const rows = rowsOf(workbook, '«export.sheetModels»');
    expect(rows[0]).toEqual(['«컬럼.모델명»', '«컬럼.설명»', '«컬럼.공정수»', '«컬럼.등록일»', '«export.updatedAt»']);
    // ON 2 가 ON 10 보다 앞이다(문자 순서였다면 ON 10 이 먼저).
    expect(rows.slice(1).map(r => [r[0], r[1], r[2]])).toEqual([['Hubble Y2', '', 1], ['ON 2', '설명 있음', 2], ['ON 10', '', 0]]);
  });

  it('공정 시트: 모델 이름순 → 모델 안에서 순서대로. 순서·Tact·캐비티는 숫자 칸이고 저장된 값 그대로다', () => {
    const { workbook } = build(
      [model('b', 'PB'), model('a', 'PA')],
      [
        proc('p3', 'b', 1, 'CNC #1', { tact_time_seconds: 560 }),
        proc('p2', 'a', 2, 'CNC #2', { tact_time_seconds: 558, cavity_count: 2 }),
        proc('p1', 'a', 1, 'CNC #1', { tact_time_seconds: 576, cavity_count: 0 }), // 0 을 1 로 고쳐 보이지 않는다
      ],
    );
    const rows = rowsOf(workbook, '«export.sheetProcesses»');
    expect(rows[0]).toEqual(['«컬럼.모델명»', '«컬럼.순서»', '«컬럼.공정명»', '«export.tactTime»', '«컬럼.캐비티수»', '«컬럼.등록일»', '«export.updatedAt»']);
    expect(rows.slice(1).map(r => r.slice(0, 5))).toEqual([['PA', 1, 'CNC #1', 576, 0], ['PA', 2, 'CNC #2', 558, 2], ['PB', 1, 'CNC #1', 560, 1]]);
    for (const row of rows.slice(1)) for (const index of [1, 3, 4]) expect(typeof row[index]).toBe('number');
  });

  it('삭제한(목록에 없는) 모델의 공정은 공정 시트에서 빼고 개수를 알린다', () => {
    const { workbook, counts } = build([model('a', 'PA')], [proc('p1', 'a', 1, 'CNC #1'), proc('p2', 'gone', 1, 'CNC #1'), proc('p3', 'gone', 2, 'CNC #2')]);
    expect(counts).toEqual({ models: 1, processes: 1, excludedProcesses: 2 });
    expect(rowsOf(workbook, '«export.sheetProcesses»')).toHaveLength(2); // 머리글 + 1행
    const info = rowsOf(workbook, '«export.sheetInfo»');
    expect(info.find(r => r[0] === '«export.infoExcluded»')?.[1]).toBe(2);
  });

  it('등록일·수정일은 화면 시간대의 YYYY-MM-DD HH:mm 이고, 비어 있으면 빈 칸이다', () => {
    const created = new Date(2026, 6, 11, 9, 30).toISOString();
    const updated = new Date(2026, 8, 1, 18, 45).toISOString();
    const { workbook } = build([model('a', 'PA', { created_at: created, updated_at: updated }), model('b', 'PB')], []);
    const rows = rowsOf(workbook, '«export.sheetModels»');
    expect([rows[1][3], rows[1][4]]).toEqual(['2026-07-11 09:30', '2026-09-01 18:45']);
    expect([rows[2][3], rows[2][4]]).toEqual(['', '']);
  });

  it('출력 정보 시트: 공장·출력 일시·개수·범위·단위 안내가 들어 있다. 공장 코드가 없으면 짐작하지 않고 -', () => {
    const info = rowsOf(build([model('a', 'PA')], [proc('p1', 'a', 1, 'CNC #1')]).workbook, '«export.sheetInfo»');
    expect(Object.fromEntries(info.slice(1).map(r => [r[0], r[1]]))).toEqual({
      '«export.infoFactory»': 'ALT', '«export.infoExportedAt»': '2026-09-29 14:05', '«export.infoModelCount»': 1, '«export.infoProcessCount»': 1,
      '«export.infoExcluded»': 0, '«export.infoScope»': '«export.infoScopeValue»', '«export.infoTactUnit»': '«export.infoTactUnitValue»',
      '«export.infoCavity»': '«export.infoCavityValue»',
    });
    const noFactory = rowsOf(build([], [], null).workbook, '«export.sheetInfo»');
    expect(noFactory.find(r => r[0] === '«export.infoFactory»')?.[1]).toBe('-');
  });

  it('두 데이터 시트에는 자동 필터가 머리글부터 마지막 행까지 걸린다. 출력 정보 시트에는 없다', () => {
    const { workbook } = build([model('a', 'PA'), model('b', 'PB')], [proc('p1', 'a', 1, 'CNC #1'), proc('p2', 'a', 2, 'CNC #2'), proc('p3', 'b', 1, 'CNC #1')]);
    expect(workbook.Sheets['«export.sheetModels»']['!autofilter']).toEqual({ ref: 'A1:E3' });
    expect(workbook.Sheets['«export.sheetProcesses»']['!autofilter']).toEqual({ ref: 'A1:G4' });
    expect(workbook.Sheets['«export.sheetInfo»']['!autofilter']).toBeUndefined();
  });

  it('데이터가 하나도 없어도 머리글만 있는 정상 파일이 나온다', () => {
    const { workbook, counts } = build([], []);
    expect(counts).toEqual({ models: 0, processes: 0, excludedProcesses: 0 });
    expect(rowsOf(workbook, '«export.sheetModels»')).toHaveLength(1);
    expect(workbook.Sheets['«export.sheetModels»']['!autofilter']).toEqual({ ref: 'A1:E1' });
  });

  it('파일로 쓰고 다시 읽어도 내용이 같고, =로 시작하는 이름은 수식이 아니라 글자로 남는다', () => {
    const { workbook } = build([model('a', '=1+1'), model('b', 'PB', { description: '@메모' })], [proc('p1', 'b', 1, 'CNC #1')]);
    const back = XLSX.read(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' });
    expect(back.SheetNames).toEqual(workbook.SheetNames);
    expect(rowsOf(back, '«export.sheetModels»')).toEqual(rowsOf(workbook, '«export.sheetModels»'));
    const cell = back.Sheets['«export.sheetModels»'].A2;
    expect([cell.t, cell.v, cell.f]).toEqual(['s', '=1+1', undefined]);
  });

  it('시트 이름은 엑셀 제약(31자·금지 문자)을 지킨다', () => {
    const custom = { ...labels, sheetModels: 'a/b?c*[d]:e ' + 'x'.repeat(40) };
    const { workbook } = buildModelInfoWorkbook({ models: [], processes: [], labels: custom, factoryCode: 'ALT', exportedAt: NOW });
    const name = workbook.SheetNames[0];
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[\/?*[\]:]/);
  });
});

describe('formatLocalDateTime · modelInfoExportFilename', () => {
  it('비어 있으면 빈 칸, 읽을 수 없는 값은 가리지 않고 원문 그대로', () => {
    expect(formatLocalDateTime(null)).toBe('');
    expect(formatLocalDateTime(undefined)).toBe('');
    expect(formatLocalDateTime('')).toBe('');
    expect(formatLocalDateTime('not-a-date')).toBe('not-a-date');
    expect(formatLocalDateTime(new Date(2026, 0, 5, 3, 7))).toBe('2026-01-05 03:07');
  });

  it('파일 이름: 공장 코드와 날짜(월·일은 두 자리)가 들어가고, 코드가 없으면 그 조각을 뺀다', () => {
    expect(modelInfoExportFilename('ALT', new Date(2026, 0, 5))).toBe('model-info_ALT_2026-01-05.xlsx');
    expect(modelInfoExportFilename(null, new Date(2026, 8, 29))).toBe('model-info_2026-09-29.xlsx');
    expect(modelInfoExportFilename('', new Date(2026, 8, 29))).toBe('model-info_2026-09-29.xlsx');
  });

  it('파일 이름에 쓸 수 없는 문자는 공장 코드에서 걸러 낸다', () => {
    expect(modelInfoExportFilename('A/L T:1', new Date(2026, 8, 29))).toBe('model-info_ALT1_2026-09-29.xlsx');
  });
});

type Page = { data: unknown[] | null; error: unknown; count: number | null };
/** 화면이 쓰는 supabase 조회 체인(select·eq·order·limit)을 흉내 낸다 - 어떤 조건으로 물었는지도 남긴다. */
function fakeClient(pages: Record<string, Page>) {
  const calls: Record<string, unknown[][]> = {};
  const client = {
    from: (table: string) => {
      calls[table] = [];
      const api: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order', 'limit']) {
        api[method] = (...args: unknown[]) => { calls[table].push([method, ...args]); return api; };
      }
      api.then = (resolve: (value: Page) => unknown, reject?: (reason: unknown) => unknown) => Promise.resolve(pages[table]).then(resolve, reject);
      return api;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}
const okPages = (models: unknown[], processes: unknown[]): Record<string, Page> => ({
  product_models: { data: models, error: null, count: models.length },
  model_processes: { data: processes, error: null, count: processes.length },
});

describe('loadModelInfoForExport', () => {
  it('활성 모델만, 공정은 모두 읽고 개수도 함께 요청한다', async () => {
    const { client, calls } = fakeClient(okPages([model('a', 'PA')], [proc('p1', 'a', 1, 'CNC #1')]));
    const loaded = await loadModelInfoForExport(client);
    expect(loaded.models).toHaveLength(1);
    expect(loaded.processes).toHaveLength(1);
    expect(calls.product_models).toContainEqual(['eq', 'is_active', true]);
    expect(calls.product_models.find(c => c[0] === 'select')?.[2]).toEqual({ count: 'exact' });
    expect(calls.model_processes.find(c => c[0] === 'select')?.[2]).toEqual({ count: 'exact' });
    // 공정에는 is_active 조건이 없다 - 어느 모델의 것인지는 모델 목록과 맞춰 거른다.
    expect(calls.model_processes.some(c => c[0] === 'eq')).toBe(false);
  });

  it.each(['product_models', 'model_processes'])('%s 조회가 실패하면 그 오류를 그대로 던진다', async table => {
    const failure = { code: 'PGRST301', message: 'JWT expired' };
    const { client } = fakeClient({ ...okPages([], []), [table]: { data: null, error: failure, count: null } });
    await expect(loadModelInfoForExport(client)).rejects.toBe(failure);
  });

  it.each(['product_models', 'model_processes'])('%s 를 전체보다 적게 받으면 조용히 내보내지 않고 멈춘다 (서버가 200 으로 자른 경우)', async table => {
    const { client } = fakeClient({ ...okPages([], []), [table]: { data: [model('a', 'PA')], error: null, count: 5 } });
    await expect(loadModelInfoForExport(client)).rejects.toBeInstanceOf(ModelInfoExportError);
  });

  it('전체 개수를 받지 못하면 확인할 수 없으므로 멈춘다', async () => {
    const { client } = fakeClient({ ...okPages([], []), model_processes: { data: [], error: null, count: null } });
    await expect(loadModelInfoForExport(client)).rejects.toMatchObject({ reason: 'truncated' });
  });
});

/** 점(.)으로 이어 쓴 번역 키를 중첩 JSON 에서 찾는다. 없으면 undefined. */
const lookup = (tree: unknown, key: string): unknown => key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree);

describe('엑셀에 찍히는 번역 키', () => {
  const used = [...Object.values(EXPORT_LABEL_KEYS), 'export.button', 'export.success', 'export.failed'];

  it.each([['ko', ko], ['vi', vi]])('%s: 사용하는 모든 키가 비어 있지 않은 문구로 있다 (없으면 엑셀 머리글에 키 이름이 그대로 찍힌다)', (_lang, tree) => {
    const missing = used.filter(key => { const value = lookup(tree, key); return typeof value !== 'string' || value.trim() === ''; });
    expect(missing).toEqual([]);
  });

  it('베트남어 문구는 한국어와 다르다 (번역 누락 방지)', () => {
    const same = used.filter(key => lookup(ko, key) === lookup(vi, key));
    // 'Tact Time' 같은 고유 용어만 같을 수 있다 - 그 밖에는 없어야 한다.
    expect(same).toEqual([]);
  });

  it('export 그룹의 키 집합이 한국어·베트남어에서 같다', () => {
    expect(Object.keys(vi.export).sort()).toEqual(Object.keys(ko.export).sort());
  });

  it('두 언어의 시트 이름은 서로 달라야 하고 엑셀 제약을 지킨다', () => {
    for (const tree of [ko, vi]) {
      const names = [tree.export.sheetModels, tree.export.sheetProcesses, tree.export.sheetInfo];
      expect(new Set(names).size).toBe(3);
      for (const name of names) { expect(name.length).toBeLessThanOrEqual(31); expect(name).not.toMatch(/[\/?*[\]:]/); }
    }
  });
});

describe('exportModelInfo - 읽기 → 만들기 → 내려받기', () => {
  beforeEach(() => mockWriteFile.mockReset());

  it('읽은 데이터로 통합 문서를 만들어 이름을 붙여 내려받고, 개수를 돌려준다', async () => {
    const { client } = fakeClient(okPages([model('b', 'PB'), model('a', 'PA')], [proc('p1', 'a', 1, 'CNC #1'), proc('p2', 'gone', 1, 'CNC #1')]));
    const counts = await exportModelInfo({ client, t: key => '«' + key + '»', factoryCode: 'ALT', now: NOW });
    expect(counts).toEqual({ models: 2, processes: 1, excludedProcesses: 1 });
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    const [workbook, filename] = mockWriteFile.mock.calls[0];
    expect(filename).toBe('model-info_ALT_2026-09-29.xlsx');
    expect(workbook.SheetNames).toHaveLength(3);
    // 머리글은 넘겨준 번역 함수에서 온다.
    expect(rowsOf(workbook, workbook.SheetNames[0])[0][0]).toBe('«컬럼.모델명»');
  });

  it('읽기가 실패하면 파일을 만들지도 내려받지도 않는다', async () => {
    const failure = new Error('db down');
    const { client } = fakeClient({ ...okPages([], []), product_models: { data: null, error: failure, count: null } });
    await expect(exportModelInfo({ client, t: key => key, factoryCode: 'ALT' })).rejects.toBe(failure);
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
