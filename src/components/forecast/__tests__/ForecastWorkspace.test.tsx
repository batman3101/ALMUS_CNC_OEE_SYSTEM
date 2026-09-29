import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ForecastWorkspace from '../ForecastWorkspace';
import ko from '../../../../public/locales/ko/forecast.json';
import vi from '../../../../public/locales/vi/forecast.json';

let mockFactoryId = 'factory-1';
/** POST calls (inspect, commit). The screen's opening GET of the accepted Forecast goes to mockSaved instead. */
const mockFetch = jest.fn();
const mockSaved = jest.fn();
jest.mock('@/contexts/FactoryContext', () => ({ useFactory: () => ({ factoryId: mockFactoryId, factoryCode: mockFactoryId }) }));
jest.mock('@/lib/authFetch', () => ({ authFetch: (url: string, init?: RequestInit) => (init?.method === 'GET' ? mockSaved : mockFetch)(url, init) }));
jest.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, language: 'ko' }) }));

const success = (factoryId = 'factory-1', submission?: { submittedAt: string }) => ({ ok: true, status: 200, json: async () => ({ success: true, preview: {
  factory: { id: factoryId, code: 'ALT' }, fileName: 'plan.xlsx', parserVersion: 'almus-v1', sourceHash: 'hash', dates: ['2026-09-22'],
  rows: [{ sourceRow: 15, model: 'H8', displayModel: 'H8', vendor: 'ALMUS', processGroup: 'CNC', processLabel: 'CNC 1 ~ CNC 2', processes: ['CNC1', 'CNC2'], issues: [], quantities: [{ date: '2026-09-22', cell: 'I15', quantity: 9000, state: 'number', formula: true, error: null }] }],
  summary: { sourceRows: 1, models: 1 }, capacityPolicy: { status: 'unavailable' }, requiresReview: true, capacityValidated: false, submission,
} }) });
const nothingSaved = { ok: true, status: 200, json: async () => ({ success: true, preview: null }) };
const select = () => fireEvent.change(screen.getByLabelText('selectFile'), { target: { files: [new File(['xlsx'], 'plan.xlsx')] } });

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
  it('has matching Korean/Vietnamese translation keys', () => {
    const keys = (value: object, prefix = ''): string[] => Object.entries(value).flatMap(([key, child]) => typeof child === 'object' ? keys(child, prefix + key + '.') : [prefix + key]);
    expect(keys(ko).sort()).toEqual(keys(vi).sort());
  });
});
