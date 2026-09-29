import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import ForecastWorkspace from '../ForecastWorkspace';
import ko from '../../../../public/locales/ko/forecast.json';
import vi from '../../../../public/locales/vi/forecast.json';

let mockFactoryId = 'factory-1';
/** POST calls (inspect, commit). The screen's opening GET of the accepted Forecast goes to mockSaved instead. */
const mockFetch = jest.fn();
const mockSaved = jest.fn();
jest.mock('@/contexts/FactoryContext', () => ({ useFactory: () => ({ factoryId: mockFactoryId, factoryCode: mockFactoryId }) }));
jest.mock('@/lib/authFetch', () => ({ authFetch: (url: string, init?: RequestInit) => (init?.method === 'GET' ? mockSaved : mockFetch)(url, init) }));
// acceptedTitle keeps the file name, so a test can tell which accepted Forecast is shown (R-01).
jest.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string, opts?: { name?: string }) => (key === 'acceptedTitle' ? `${key}:${opts?.name}` : key), language: 'ko' }) }));

const success = (factoryId = 'factory-1', submission?: { submittedAt: string; submissionId?: string }) => ({ ok: true, status: 200, json: async () => ({ success: true, preview: {
  factory: { id: factoryId, code: 'ALT' }, fileName: 'plan.xlsx', parserVersion: 'almus-v1', sourceHash: 'hash', dates: ['2026-09-22'],
  rows: [{ sourceRow: 15, model: 'H8', displayModel: 'H8', vendor: 'ALMUS', processGroup: 'CNC', processLabel: 'CNC 1 ~ CNC 2', processes: ['CNC1', 'CNC2'], issues: [], quantities: [{ date: '2026-09-22', cell: 'I15', quantity: 9000, state: 'number', formula: true, error: null }] }],
  summary: { sourceRows: 1, models: 1 }, capacityPolicy: { status: 'unavailable' }, requiresReview: true, capacityValidated: false, submission,
} }) });
const nothingSaved = { ok: true, status: 200, json: async () => ({ success: true, preview: null }) };
const select = () => fireEvent.change(screen.getByLabelText('selectFile'), { target: { files: [new File(['xlsx'], 'plan.xlsx')] } });
const SUBMISSION_A = '11111111-1111-4111-8111-111111111111';
const SUBMISSION_B = '22222222-2222-4222-8222-222222222222';
/** 접수 번호가 붙은 저장본 - 실제 PO 입력이 가능한 화면. */
const savedForecast = (submissionId = SUBMISSION_A, fileName = 'plan.xlsx') => {
  const base = success('factory-1', { submittedAt: '2026-09-29T02:00:00Z', submissionId });
  return { ...base, json: async () => { const body = await base.json(); return { ...body, preview: { ...body.preview, fileName } }; } };
};
const poAccepted = (quantity = 12000) => ({ ok: true, status: 200, json: async () => ({ success: true, po: { quantity, updatedAt: '2026-09-29T05:00:00Z' }, unchanged: false }) });

describe('Forecast upload workspace', () => {
  const originalStyle = window.getComputedStyle.bind(window);
  beforeAll(() => { jest.spyOn(window, 'getComputedStyle').mockImplementation(element => originalStyle(element)); });
  afterAll(() => jest.restoreAllMocks());
  beforeEach(() => { jest.clearAllMocks(); mockFactoryId = 'factory-1'; mockFetch.mockResolvedValue(success()); mockSaved.mockResolvedValue(nothingSaved); });
  it('uploads with the selected factory expectation and displays source preview', async () => {
    render(<ForecastWorkspace />); select(); fireEvent.click(screen.getByRole('button', { name: 'inspect' }));
    expect(await screen.findByText('plan.xlsx')).toBeInTheDocument();
    expect(mockFetch.mock.calls[0][1].headers['x-forecast-factory-id']).toBe('factory-1');
    expect(screen.getByText('CNC1 / CNC2')).toBeInTheDocument();
    expect(screen.getByText('capacityUnavailable')).toBeInTheDocument();
  });
  it('does not display a different factory response', async () => {
    mockFetch.mockResolvedValue(success('factory-2'));
    render(<ForecastWorkspace />); select(); fireEvent.click(screen.getByRole('button', { name: 'inspect' }));
    expect(await screen.findByText('errors.factory_changed')).toBeInTheDocument(); expect(screen.queryByText('plan.xlsx')).not.toBeInTheDocument();
  });
  it('clears results and aborts stale work when the factory changes', async () => {
    let resolveResponse: (response: ReturnType<typeof success>) => void = () => {};
    mockFetch.mockImplementation(() => new Promise(resolve => { resolveResponse = resolve; }));
    const view = render(<ForecastWorkspace />); select(); fireEvent.click(screen.getByRole('button', { name: 'inspect' }));
    mockFactoryId = 'factory-2'; view.rerender(<ForecastWorkspace />);
    await act(async () => resolveResponse(success()));
    expect(mockFetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(screen.queryByText('plan.xlsx')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'inspect' })).toBeDisabled();
  });
  it('allows retry after a failed request', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network'));
    render(<ForecastWorkspace />); select(); fireEvent.click(screen.getByRole('button', { name: 'inspect' }));
    expect(await screen.findByText('errors.preview_failed')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'inspect' })).not.toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'inspect' })); expect(await screen.findByText('plan.xlsx')).toBeInTheDocument();
  });
  it('accepts a dropped file and sends that file', async () => {
    render(<ForecastWorkspace />);
    const dropped = new File(['xlsx'], 'dropped.xlsx');
    fireEvent.drop(screen.getByTestId('forecast-drop-zone'), { dataTransfer: { files: [dropped] } });
    expect(screen.getByText('selectedFile')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'inspect' }));
    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(mockFetch.mock.calls[0][1].body).toBe(dropped);
  });
  it('rejects a dropped non-xlsx file before any request', () => {
    render(<ForecastWorkspace />);
    fireEvent.drop(screen.getByTestId('forecast-drop-zone'), { dataTransfer: { files: [new File(['x'], 'plan.xls')] } });
    expect(screen.getByText('errors.invalid_filename')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'inspect' })).toBeDisabled();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('opens on the factory\'s accepted Forecast without re-uploading', async () => {
    mockSaved.mockResolvedValue(success('factory-1', { submittedAt: '2026-09-29T02:00:00Z' }));
    render(<ForecastWorkspace />);
    expect(await screen.findByText('plan.xlsx')).toBeInTheDocument();
    expect(mockSaved.mock.calls[0][0]).toBe('/api/forecasts/submission');
    expect(screen.getByTestId('accepted-forecast')).toBeInTheDocument();
    expect(screen.queryByTestId('unsaved-forecast')).not.toBeInTheDocument();
    expect(mockFetch).not.toHaveBeenCalled();
  });
  it('says so when nothing has been accepted yet', async () => {
    render(<ForecastWorkspace />);
    expect(await screen.findByTestId('no-accepted-forecast')).toBeInTheDocument();
  });
  it('keeps an inspected file unsaved until 접수 확정, then stores it pinned to the inspected hash', async () => {
    render(<ForecastWorkspace />); select(); fireEvent.click(screen.getByRole('button', { name: 'inspect' }));
    expect(await screen.findByTestId('unsaved-forecast')).toBeInTheDocument();
    expect(mockFetch).toHaveBeenCalledTimes(1);
    mockFetch.mockResolvedValueOnce(success('factory-1', { submittedAt: '2026-09-29T02:00:00Z' }));
    fireEvent.click(screen.getByTestId('commit-forecast'));
    expect(await screen.findByTestId('accepted-forecast')).toBeInTheDocument();
    const [url, init] = mockFetch.mock.calls[1];
    expect(url).toBe('/api/forecasts/submission');
    expect(init.method).toBe('POST');
    expect(init.headers['x-forecast-source-hash']).toBe('hash');
    expect(screen.queryByTestId('unsaved-forecast')).not.toBeInTheDocument();
  });
  it('does not mark the file accepted when 접수 확정 fails', async () => {
    render(<ForecastWorkspace />); select(); fireEvent.click(screen.getByRole('button', { name: 'inspect' }));
    await screen.findByTestId('unsaved-forecast');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ success: false, code: 'source_changed' }) });
    fireEvent.click(screen.getByTestId('commit-forecast'));
    expect(await screen.findByText('errors.source_changed')).toBeInTheDocument();
    expect(screen.queryByTestId('accepted-forecast')).not.toBeInTheDocument();
  });
  // Codex 감사 F-01 (2026-09-29): 저장본 조회 상태를 '없음'과 섞지 않는다.
  it('F-01: picking a file while the accepted Forecast is still loading does not cancel it or claim there is none', async () => {
    let finish: (r: ReturnType<typeof success>) => void = () => {};
    mockSaved.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<ForecastWorkspace />);
    select();
    expect(mockSaved.mock.calls[0][1].signal.aborted).toBe(false);
    expect(screen.queryByTestId('no-accepted-forecast')).not.toBeInTheDocument();
    await act(async () => finish(success('factory-1', { submittedAt: '2026-09-29T02:00:00Z' })));
    expect(screen.getByTestId('accepted-forecast')).toBeInTheDocument();
    expect(screen.queryByTestId('no-accepted-forecast')).not.toBeInTheDocument();
    // The chosen file is not replaced by the accepted one's preview.
    expect(screen.queryByText('plan.xlsx')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'inspect' })).not.toBeDisabled();
  });
  it('F-01: an accepted Forecast arriving after a new inspection does not overwrite the inspected preview', async () => {
    let finish: (r: ReturnType<typeof success>) => void = () => {};
    mockSaved.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<ForecastWorkspace />); select(); fireEvent.click(screen.getByRole('button', { name: 'inspect' }));
    expect(await screen.findByTestId('unsaved-forecast')).toBeInTheDocument();
    await act(async () => finish(success('factory-1', { submittedAt: '2026-09-29T02:00:00Z' })));
    expect(screen.getByTestId('unsaved-forecast')).toBeInTheDocument();
    expect(screen.getByTestId('accepted-forecast')).toBeInTheDocument();
  });
  it('F-01: a failed lookup says it could not check — never "none" — and can be retried', async () => {
    mockSaved.mockRejectedValueOnce(new Error('network failure'));
    render(<ForecastWorkspace />);
    expect(await screen.findByTestId('accepted-load-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('no-accepted-forecast')).not.toBeInTheDocument();
    mockSaved.mockResolvedValueOnce(success('factory-1', { submittedAt: '2026-09-29T02:00:00Z' }));
    fireEvent.click(screen.getByTestId('retry-accepted'));
    expect(await screen.findByTestId('accepted-forecast')).toBeInTheDocument();
    expect(screen.queryByTestId('accepted-load-failed')).not.toBeInTheDocument();
  });
  it('F-01: a server error on the lookup is also "could not check", not "none"', async () => {
    mockSaved.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ success: false, code: 'submission_load_failed' }) });
    render(<ForecastWorkspace />);
    expect(await screen.findByTestId('accepted-load-failed')).toBeInTheDocument();
    expect(screen.queryByTestId('no-accepted-forecast')).not.toBeInTheDocument();
  });
  // Codex 재감사 R-01 (2026-09-29): 접수 성공보다 먼저 시작한 조회가 늦게 와도 성공 상태를 되돌리지 않는다.
  const oldAccepted = { ok: true, status: 200, json: async () => ({ success: true, preview: {
    factory: { id: 'factory-1', code: 'ALT' }, fileName: 'old-W39.xlsx', parserVersion: 'almus-v1', sourceHash: 'old', dates: ['2026-09-15'], rows: [],
    summary: { sourceRows: 0, models: 0 }, capacityPolicy: { status: 'unavailable' }, requiresReview: true, capacityValidated: false,
    submission: { submittedAt: '2026-09-20T02:00:00Z' },
  } }) };
  const serverError = { ok: false, status: 500, json: async () => ({ success: false, code: 'submission_load_failed' }) };
  it.each([
    ['none', nothingSaved],
    ['an older accepted file', oldAccepted],
    ['an error', serverError],
  ])('R-01: a lookup started before 접수 확정 that returns %s afterwards does not undo the new acceptance', async (_label, stale) => {
    let finish: (r: unknown) => void = () => {};
    mockSaved.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<ForecastWorkspace />); select(); fireEvent.click(screen.getByRole('button', { name: 'inspect' }));
    await screen.findByTestId('unsaved-forecast');
    mockFetch.mockResolvedValueOnce(success('factory-1', { submittedAt: '2026-09-29T02:00:00Z' }));
    fireEvent.click(screen.getByTestId('commit-forecast'));
    await screen.findByTestId('accepted-forecast');
    await act(async () => finish(stale));
    expect(screen.getByTestId('accepted-forecast')).toBeInTheDocument();
    expect(screen.queryByTestId('no-accepted-forecast')).not.toBeInTheDocument();
    expect(screen.queryByTestId('accepted-load-failed')).not.toBeInTheDocument();
    expect(screen.queryByTestId('unsaved-forecast')).not.toBeInTheDocument();
    expect(screen.getByTestId('accepted-forecast')).toHaveTextContent('acceptedTitle:plan.xlsx');
    expect(screen.getByText('plan.xlsx')).toBeInTheDocument();
  });
  it('R-01: a failed 접수 확정 leaves the lookup running, so the accepted Forecast still shows when it arrives', async () => {
    let finish: (r: unknown) => void = () => {};
    mockSaved.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<ForecastWorkspace />); select(); fireEvent.click(screen.getByRole('button', { name: 'inspect' }));
    await screen.findByTestId('unsaved-forecast');
    mockFetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ success: false, code: 'source_changed' }) });
    fireEvent.click(screen.getByTestId('commit-forecast'));
    await screen.findByText('errors.source_changed');
    expect(mockSaved.mock.calls[0][1].signal.aborted).toBe(false);
    await act(async () => finish(oldAccepted));
    expect(screen.getByTestId('accepted-forecast')).toHaveTextContent('acceptedTitle:old-W39.xlsx');
    expect(screen.getByTestId('unsaved-forecast')).toBeInTheDocument();
  });
  // 실제 PO 수정값 (사용자 요청 2026-09-29): 접수 후 실제 PO 가 바뀌면 날짜마다 입력·적용하고, 시뮬레이션이 그 값을 쓴다.
  describe('실제 PO 수량 입력', () => {
    const openFirstRow = async (saved = savedForecast()) => {
      mockSaved.mockResolvedValue(saved);
      render(<App><ForecastWorkspace /></App>);
      await screen.findByText('plan.xlsx');
      fireEvent.click(screen.getByRole('button', { name: 'Expand row' }));
    };
    const typePo = (value: string) => fireEvent.change(screen.getByLabelText('po.input 2026-09-22'), { target: { value } });
    const apply = () => fireEvent.click(screen.getByRole('button', { name: 'po.apply 2026-09-22' }));

    it('적용하면 서버에 기록하고, 표와 검토 열에 수정값이 나타난다 - 위쪽 소계는 접수한 원본 기준 그대로다', async () => {
      await openFirstRow();
      typePo('12000');
      mockFetch.mockResolvedValueOnce(poAccepted(12000));
      apply();
      expect(await screen.findByText('po.tag')).toBeInTheDocument();
      const [url, init] = mockFetch.mock.calls[0];
      expect(url).toBe('/api/forecasts/po-overrides');
      expect(init.method).toBe('PUT');
      expect(JSON.parse(init.body)).toEqual({ submissionId: SUBMISSION_A, sourceRow: 15, date: '2026-09-22', quantity: 12000 });
      expect(screen.getByText('po.modifiedDays')).toBeInTheDocument();
      expect(screen.getByText('12,000')).toBeInTheDocument();
      expect(screen.getByText('9,000')).toBeInTheDocument();
    });

    it('[원복]하면 수정값이 사라지고 원본 Forecast 수량으로 돌아온다', async () => {
      await openFirstRow();
      typePo('12000');
      mockFetch.mockResolvedValueOnce(poAccepted(12000));
      apply();
      await screen.findByText('po.tag');
      mockFetch.mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ success: true, reverted: true }) });
      fireEvent.click(screen.getByRole('button', { name: 'po.revert 2026-09-22' }));
      await waitFor(() => expect(screen.queryByText('po.tag')).not.toBeInTheDocument());
      expect(mockFetch.mock.calls[1][1].method).toBe('DELETE');
      expect(screen.queryByText('po.modifiedDays')).not.toBeInTheDocument();
    });

    it('그사이 새 Forecast 가 접수돼 409 가 오면 알리고, 저장본을 다시 불러와 새 접수본을 보인다', async () => {
      await openFirstRow();
      typePo('12000');
      mockFetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ success: false, code: 'submission_changed' }) });
      mockSaved.mockResolvedValue(savedForecast(SUBMISSION_B, 'W40.xlsx'));
      apply();
      expect(await screen.findByText('errors.submission_changed')).toBeInTheDocument();
      expect(await screen.findByText('W40.xlsx')).toBeInTheDocument();
      expect(mockSaved).toHaveBeenCalledTimes(2);
      // 펼쳐 둔 행은 그대로지만 새 접수본의 표다 - 옛 접수본에 입력하던 값이 남아 있으면 안 된다.
      expect(screen.getByLabelText('po.input 2026-09-22')).toHaveValue('');
    });

    it('직접 접수한 파일을 보고 있을 때 409 가 와도 저장본으로 화면을 바꾼다 (낡은 접수본에 계속 입력하지 않게)', async () => {
      render(<App><ForecastWorkspace /></App>); select(); fireEvent.click(screen.getByRole('button', { name: 'inspect' }));
      await screen.findByTestId('unsaved-forecast');
      mockFetch.mockResolvedValueOnce(savedForecast(SUBMISSION_A));
      fireEvent.click(screen.getByTestId('commit-forecast'));
      await screen.findByTestId('accepted-forecast');
      fireEvent.click(screen.getByRole('button', { name: 'Expand row' }));
      typePo('12000');
      mockFetch.mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ success: false, code: 'submission_changed' }) });
      mockSaved.mockResolvedValue(savedForecast(SUBMISSION_B, 'W40.xlsx'));
      apply();
      expect(await screen.findByText('W40.xlsx')).toBeInTheDocument();
    });

    it('접수 확정 전 미리보기에서는 입력이 막히고 이유가 보인다', async () => {
      render(<App><ForecastWorkspace /></App>); select(); fireEvent.click(screen.getByRole('button', { name: 'inspect' }));
      await screen.findByTestId('unsaved-forecast');
      fireEvent.click(screen.getByRole('button', { name: 'Expand row' }));
      expect(screen.getByTestId('po-disabled-reason')).toHaveTextContent('po.needsAcceptance');
      expect(screen.getByLabelText('po.input 2026-09-22')).toBeDisabled();
    });

    it('응답이 오기 전에 다른 접수본으로 바뀌었다면 늦게 온 응답은 새 접수본에 붙이지 않는다', async () => {
      await openFirstRow();
      typePo('12000');
      let finishPut: (response: unknown) => void = () => {};
      mockFetch.mockImplementation((url: string) => {
        if (url === '/api/forecasts/po-overrides') return new Promise(resolve => { finishPut = resolve; });
        if (url === '/api/forecasts/preview') return Promise.resolve(success());
        return Promise.resolve(savedForecast(SUBMISSION_B, 'W40.xlsx'));
      });
      apply();
      select(); fireEvent.click(screen.getByRole('button', { name: 'inspect' }));
      await screen.findByTestId('unsaved-forecast');
      fireEvent.click(screen.getByTestId('commit-forecast'));
      await screen.findByText('W40.xlsx');
      await act(async () => finishPut(poAccepted(12000)));
      expect(screen.queryByText('po.modifiedDays')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Expand row' }));
      expect(screen.queryByText('po.tag')).not.toBeInTheDocument();
      expect(screen.getByLabelText('po.input 2026-09-22')).toHaveValue('');
    });

    it.each([
      [403, { code: 'forbidden' }, 'errors.forbidden'],
      [404, { code: 'po_target_not_found' }, 'errors.po_target_not_found'],
      [422, { code: 'po_row_unsupported' }, 'errors.po_row_unsupported'],
      [500, { code: 'po_save_failed' }, 'errors.po_save_failed'],
    ] as [number, object, string][])('서버가 %s 로 거부하면 표 가까이에 토스트로 알린다 (%j → %s)', async (status, body, message) => {
      await openFirstRow();
      typePo('12000');
      mockFetch.mockResolvedValueOnce({ ok: false, status, json: async () => ({ success: false, ...body }) });
      apply();
      expect(await screen.findByText(message)).toBeInTheDocument();
      expect(screen.queryByText('po.tag')).not.toBeInTheDocument();
    });

    it('세션이 끝난 401 은 토스트로 겹쳐 말하지 않는다 (만료 안내가 이미 떠 있다)', async () => {
      await openFirstRow();
      typePo('12000');
      mockFetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ success: false }) });
      apply();
      await waitFor(() => expect(screen.getByLabelText('po.input 2026-09-22')).toBeEnabled());
      // 대조군: 다른 실패는 토스트가 뜬다. 토스트는 비동기로 그려지므로 '없다'를 바로 단언하면 뜨기 전에 통과해 버린다 -
      // 반드시 뜨는 토스트가 보인 뒤에도 401 토스트가 없어야 '말하지 않았다'가 성립한다.
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ success: false, code: 'po_save_failed' }) });
      // antd 버튼의 로딩 표시는 렌더보다 한 박자 늦게 풀린다 - 풀리기 전의 클릭은 무시되므로 기다린다.
      await waitFor(() => expect(screen.getByRole('button', { name: 'po.apply 2026-09-22' })).not.toHaveClass('ant-btn-loading'));
      apply();
      expect(await screen.findByText('errors.po_save_failed')).toBeInTheDocument();
      expect(screen.queryByText('errors.unauthorized')).not.toBeInTheDocument();
    });
  });

  it('has matching Korean/Vietnamese translation keys', () => {
    const keys = (value: object, prefix = ''): string[] => Object.entries(value).flatMap(([key, child]) => typeof child === 'object' ? keys(child, prefix + key + '.') : [prefix + key]);
    expect(keys(ko).sort()).toEqual(keys(vi).sort());
  });
});
