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
/** eq 조건을 실제로 적용하는 메모리 조회 - 서버가 좁혀서 주는 동작을 그대로 흉내 낸다. */
const chain = (table: string) => {
  let rows: Record<string, unknown>[] = table === 'product_models' ? models : processes;
  const api: Record<string, unknown> = {};
  api.select = () => api;
  api.order = () => api;
  api.eq = (column: string, value: unknown) => { mockQueries.push([table, column, String(value)]); rows = rows.filter(r => r[column] === value); return api; };
  api.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve);
  return api;
};
const mockClient = { from: (table: string) => chain(table) };

jest.mock('@/lib/supabase', () => ({ createSupabaseClient: () => mockClient }));
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('@/contexts/FactoryContext', () => ({ useFactory: () => ({ factoryCode: 'ALT' }) }));
jest.mock('@/hooks/useFailureReport', () => ({ useFailureReport: () => jest.fn() }));
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
  beforeEach(() => { mockQueries.length = 0; });

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
});
