import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import ModelInfoManager from '../ModelInfoManager';

const mockExport = jest.fn();
const mockSuccess = jest.fn();
const mockReportFailure = jest.fn();
/** 화면이 처음 읽어 오는 모델·공정 조회 - 빈 목록으로 답한다. */
const chain = () => {
  const api: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit', 'range']) api[method] = () => api;
  api.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null, count: 0 }).then(resolve);
  return api;
};
const mockClient = { from: () => chain() };

jest.mock('@/lib/supabase', () => ({ createSupabaseClient: () => mockClient }));
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('@/contexts/FactoryContext', () => ({ useFactory: () => ({ factoryCode: 'ALT' }) }));
jest.mock('@/hooks/useFailureReport', () => ({ useFailureReport: () => (...args: unknown[]) => mockReportFailure(...args) }));
jest.mock('@/hooks/useTranslation', () => ({
  useModelInfoTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => (opts ? key + ':' + JSON.stringify(opts) : key) }),
}));
jest.mock('@/lib/excel/modelInfoExport', () => ({ exportModelInfo: (...args: unknown[]) => mockExport(...args) }));

const exportButton = () => screen.getByRole('button', { name: /export\.button/ });

describe('ModelInfoManager - 엑셀 출력', () => {
  const originalStyle = window.getComputedStyle.bind(window);
  beforeAll(() => { jest.spyOn(window, 'getComputedStyle').mockImplementation(element => originalStyle(element)); });
  afterAll(() => jest.restoreAllMocks());
  beforeEach(() => {
    jest.clearAllMocks();
    mockExport.mockResolvedValue({ models: 57, processes: 120, excludedProcesses: 2 });
    // 성공 알림은 App.useApp() 인스턴스로 나간다 - 화면에 그려지는 토스트 대신 호출을 직접 본다.
    jest.spyOn(App, 'useApp').mockReturnValue({ message: { success: mockSuccess }, notification: {}, modal: {} } as never);
  });

  it('버튼을 누르면 화면 상태가 아니라 DB 에서 새로 읽어 출력하고, 개수를 알린다', async () => {
    render(<ModelInfoManager />);
    fireEvent.click(exportButton());
    await waitFor(() => expect(mockSuccess).toHaveBeenCalledTimes(1));
    const args = mockExport.mock.calls[0][0];
    // 화면의 models/processes 를 넘기지 않는다 - 클라이언트만 넘겨 그쪽이 새로 읽는다.
    expect(Object.keys(args).sort()).toEqual(['client', 'factoryCode', 't']);
    expect(args.client).toBe(mockClient);
    expect(args.factoryCode).toBe('ALT');
    expect(args.t('export.sheetModels')).toBe('export.sheetModels');
    expect(mockSuccess).toHaveBeenCalledWith('export.success:{"models":57,"processes":120}');
    expect(mockReportFailure).not.toHaveBeenCalled();
  });

  it('출력이 실패하면 실패 보고 통로로 알리고 성공 안내는 내지 않는다', async () => {
    const failure = new Error('boom');
    mockExport.mockRejectedValue(failure);
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
    render(<ModelInfoManager />);
    fireEvent.click(exportButton());
    await waitFor(() => expect(mockReportFailure).toHaveBeenCalledWith('export.failed', failure));
    expect(mockSuccess).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('출력하는 동안 다시 눌러도 한 번만 출력한다', async () => {
    let finish: (counts: unknown) => void = () => {};
    mockExport.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<ModelInfoManager />);
    fireEvent.click(exportButton());
    await waitFor(() => expect(mockExport).toHaveBeenCalledTimes(1));
    fireEvent.click(exportButton());
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(mockExport).toHaveBeenCalledTimes(1);
    await act(async () => finish({ models: 1, processes: 1, excludedProcesses: 0 }));
    expect(mockSuccess).toHaveBeenCalledTimes(1);
  });
});
