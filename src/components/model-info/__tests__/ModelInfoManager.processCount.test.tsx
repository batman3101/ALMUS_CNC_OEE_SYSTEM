import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ModelInfoManager from '../ModelInfoManager';

/**
 * '공정 수' 열 (사용자 승인 2026-09-29): '공정 관리'를 누르면 화면의 공정 목록이 그 모델 것만 남아,
 * 다른 모델의 공정 수가 0 으로 보이던 결함. 모델 표의 공정 수는 항상 전체 공정에서 세어야 한다.
 */
const at = '2026-01-01T00:00:00Z';
const models = [
  { id: 'm1', model_name: 'PA1', description: null, is_active: true, created_at: at, updated_at: at },
  { id: 'm2', model_name: 'PB1', description: null, is_active: true, created_at: at, updated_at: at },
];
const process = (id: string, modelId: string, order: number, name: string, modelName: string) =>
  ({ id, model_id: modelId, process_name: name, process_order: order, tact_time_seconds: 100, cavity_count: 1, created_at: at, updated_at: at, product_models: { model_name: modelName } });
const processes = [process('p1', 'm1', 1, 'CNC #1', 'PA1'), process('p2', 'm1', 2, 'CNC #2', 'PA1'), process('p3', 'm2', 1, 'CNC #1', 'PB1')];

const mockQueries: string[][] = [];
const mockOrders: string[][] = [];
/** 읽기 한 번에 서버가 줄 수 있는 최대 행 수(PostgREST max-rows). 조용히 자른다. */
const mockServer = { cap: Number.POSITIVE_INFINITY };
let mockProcessRows: Record<string, unknown>[] = processes;
const mockReportFailure = jest.fn();
/** eq 조건·range·count 를 실제로 적용하는 메모리 조회 - 서버가 좁히고 자르고 세어 주는 동작을 그대로 흉내 낸다. */
const chain = (table: string) => {
  let rows: Record<string, unknown>[] = table === 'product_models' ? models : mockProcessRows;
  let wantCount = false;
  let window: [number, number] | null = null;
  const api: Record<string, unknown> = {};
  api.select = (_columns: string, options?: { count?: string }) => { wantCount = Boolean(options && options.count); return api; };
  api.order = (column: string) => { mockOrders.push([table, column]); return api; };
  api.eq = (column: string, value: unknown) => { mockQueries.push([table, column, String(value)]); rows = rows.filter(r => r[column] === value); return api; };
  api.range = (from: number, to: number) => { window = [from, to]; return api; };
  api.then = (resolve: (value: unknown) => unknown) => {
    const from = window ? window[0] : 0;
    const to = window ? window[1] + 1 : rows.length;
    const data = rows.slice(from, Math.min(to, from + mockServer.cap));
    return Promise.resolve({ data, error: null, count: wantCount ? rows.length : null }).then(resolve);
  };
  return api;
};
const mockClient = { from: (table: string) => chain(table) };

jest.mock('@/lib/supabase', () => ({ createSupabaseClient: () => mockClient }));
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('@/contexts/FactoryContext', () => ({ useFactory: () => ({ factoryCode: 'ALT' }) }));
jest.mock('@/hooks/useFailureReport', () => ({ useFailureReport: () => (...args: unknown[]) => mockReportFailure(...args) }));
jest.mock('@/hooks/useTranslation', () => ({
  useModelInfoTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts ? key + ':' + JSON.stringify(opts) : key) }),
}));

const countOf = (n: number) => '단위.개값:{"n":' + n + '}';
/** 클릭이 시작한 비동기 재조회가 끝나 화면에 반영될 때까지 기다린다 - 그 전에 단언하면 아직 정상인 숫자를 보게 된다. */
const settle = () => act(async () => { await new Promise(resolve => setTimeout(resolve, 60)); });
const modelRow = (name: string) => screen.getAllByRole('row').find(row => within(row).queryAllByText(name).length > 0 && within(row).queryAllByText(/단위\.개값/).length > 0)!;

describe('ModelInfoManager - 모델 표의 공정 수', () => {
  const originalStyle = window.getComputedStyle.bind(window);
  beforeAll(() => { jest.spyOn(window, 'getComputedStyle').mockImplementation(element => originalStyle(element)); });
  afterAll(() => jest.restoreAllMocks());
  beforeEach(() => {
    mockQueries.length = 0;
    mockOrders.length = 0;
    mockServer.cap = Number.POSITIVE_INFINITY;
    mockProcessRows = processes;
    mockReportFailure.mockClear();
  });

  it('처음에는 모델마다 자기 공정 수가 보인다', async () => {
    render(<ModelInfoManager />);
    await waitFor(() => expect(within(modelRow('PA1')).getByText(countOf(2))).toBeInTheDocument());
    expect(within(modelRow('PB1')).getByText(countOf(1))).toBeInTheDocument();
  });

  it("한 모델의 '공정 관리'를 눌러도 다른 모델의 공정 수는 그대로다 - 공정 표만 그 모델 것으로 좁혀진다", async () => {
    render(<ModelInfoManager />);
    await waitFor(() => expect(within(modelRow('PA1')).getByText(countOf(2))).toBeInTheDocument());
    fireEvent.click(within(modelRow('PA1')).getByRole('button', { name: /버튼\.공정관리/ }));
    await waitFor(() => expect(screen.getByText('선택된모델공정설명:{"modelName":"PA1"}')).toBeInTheDocument());
    await settle();
    // 다른 모델이 0 으로 바뀌면 안 된다.
    expect(within(modelRow('PB1')).getByText(countOf(1))).toBeInTheDocument();
    expect(within(modelRow('PA1')).getByText(countOf(2))).toBeInTheDocument();
    // 공정 표는 선택한 모델의 공정만 보인다(PB1 의 공정은 빠진다): PA1 은 모델 표 1 + 선택 상자 1 + 공정 표 2행.
    expect(screen.getAllByText('PA1')).toHaveLength(4);
    expect(screen.getAllByText('PB1')).toHaveLength(1);
  });

  it('공정은 모델별로 서버에서 좁혀 읽지 않는다 (좁혀 읽으면 그 결과로 다른 모델의 공정 수를 셀 수 없다)', async () => {
    render(<ModelInfoManager />);
    await waitFor(() => expect(within(modelRow('PA1')).getByText(countOf(2))).toBeInTheDocument());
    fireEvent.click(within(modelRow('PB1')).getByRole('button', { name: /버튼\.공정관리/ }));
    await waitFor(() => expect(screen.getByText('선택된모델공정설명:{"modelName":"PB1"}')).toBeInTheDocument());
    await settle();
    expect(mockQueries.filter(([table, column]) => table === 'model_processes' && column === 'model_id')).toEqual([]);
    expect(within(modelRow('PA1')).getByText(countOf(2))).toBeInTheDocument();
  });

  it('MODEL-01: 공정 조회는 쪽 경계가 흔들리지 않게 유일한 열(id)까지 정렬한다', async () => {
    render(<ModelInfoManager />);
    await waitFor(() => expect(within(modelRow('PA1')).getByText(countOf(2))).toBeInTheDocument());
    // 첫 읽기의 정렬 키: 표시 순서(process_order) 다음에 유일한 id - 같은 순서의 공정이 쪽 경계에서 중복·누락되지 않는다.
    expect(mockOrders.filter(([table]) => table === 'model_processes').map(([, column]) => column)).toEqual(['process_order', 'id']);
  });

  // 감사 MODEL-01 (2026-09-29): 전체 공정을 한 번만 읽으면 서버 상한을 넘는 순간 뒤쪽 모델의 공정이 통째로 사라진다.
  it('MODEL-01: 전체 공정 수가 서버 반환 상한을 넘어도 모든 모델의 공정 수가 맞고, 뒤쪽 모델의 공정도 관리할 수 있다', async () => {
    mockServer.cap = 3;
    mockProcessRows = [
      ...[1, 2, 3, 4, 5].map(order => process('a' + order, 'm1', order, 'CNC #' + order, 'PA1')),
      process('b1', 'm2', 1, 'CNC #1', 'PB1'),
    ];
    render(<ModelInfoManager />);
    await waitFor(() => expect(within(modelRow('PA1')).getByText(countOf(5))).toBeInTheDocument());
    // 상한(3) 뒤에 있는 PB1 의 공정도 세어진다.
    expect(within(modelRow('PB1')).getByText(countOf(1))).toBeInTheDocument();
    fireEvent.click(within(modelRow('PB1')).getByRole('button', { name: /버튼\.공정관리/ }));
    await waitFor(() => expect(screen.getByText('선택된모델공정설명:{"modelName":"PB1"}')).toBeInTheDocument());
    await settle();
    // 공정 표에 PB1 의 공정이 보인다: 모델 표 1 + 선택 상자 1 + 공정 표 1.
    expect(screen.getAllByText('PB1')).toHaveLength(3);
    expect(within(modelRow('PB1')).getByText(countOf(1))).toBeInTheDocument();
    expect(mockReportFailure).not.toHaveBeenCalled();
  });

  it('MODEL-01: 서버가 전체 개수를 주지 않아 완전성을 확인할 수 없으면 틀린 숫자를 조용히 쓰지 않고 실패를 알린다', async () => {
    // count 를 요구했는데 못 받는 서버 - 위 가짜 서버에서 wantCount 를 끄는 대신 select 옵션을 무시하게 만든다.
    const original = mockClient.from;
    mockClient.from = (table: string) => {
      const api = original(table) as Record<string, unknown>;
      if (table === 'model_processes') api.select = () => api;
      return api;
    };
    render(<ModelInfoManager />);
    await waitFor(() => expect(mockReportFailure).toHaveBeenCalled());
    expect(mockReportFailure.mock.calls[0][0]).toBe('에러.공정목록조회실패');
    expect(mockReportFailure.mock.calls[0][1]).toMatchObject({ name: 'IncompleteReadError', reason: 'count_missing' });
    mockClient.from = original;
  });
});
