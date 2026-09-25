import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import ForecastWorkspace from '../ForecastWorkspace';
import ko from '../../../../public/locales/ko/forecast.json';
import vi from '../../../../public/locales/vi/forecast.json';

let mockFactoryId = 'factory-1';
const mockFetch = jest.fn();
jest.mock('@/contexts/FactoryContext', () => ({ useFactory: () => ({ factoryId: mockFactoryId, factoryCode: mockFactoryId }) }));
jest.mock('@/lib/authFetch', () => ({ authFetch: (...args: unknown[]) => mockFetch(...args) }));
jest.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string) => key, language: 'ko' }) }));

const success = (factoryId = 'factory-1') => ({ ok: true, status: 200, json: async () => ({ success: true, preview: {
  factory: { id: factoryId, code: 'ALT' }, fileName: 'plan.xlsx', parserVersion: 'almus-v1', sourceHash: 'hash', dates: ['2026-09-22'],
  rows: [{ sourceRow: 15, model: 'H8', displayModel: 'H8', vendor: 'ALMUS', processGroup: 'CNC', processLabel: 'CNC 1 ~ CNC 2', processes: ['CNC1', 'CNC2'], issues: [], quantities: [{ date: '2026-09-22', cell: 'I15', quantity: 9000, state: 'number', formula: true, error: null }] }],
  summary: { sourceRows: 1, models: 1 }, capacityPolicy: { status: 'unavailable' }, requiresReview: true, capacityValidated: false,
} }) });
const select = () => fireEvent.change(screen.getByLabelText('selectFile'), { target: { files: [new File(['xlsx'], 'plan.xlsx')] } });

describe('Forecast upload workspace', () => {
  const originalStyle = window.getComputedStyle.bind(window);
  beforeAll(() => { jest.spyOn(window, 'getComputedStyle').mockImplementation(element => originalStyle(element)); });
  afterAll(() => jest.restoreAllMocks());
  beforeEach(() => { jest.clearAllMocks(); mockFactoryId = 'factory-1'; mockFetch.mockResolvedValue(success()); });
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
  it('has matching Korean/Vietnamese translation keys', () => {
    const keys = (value: object, prefix = ''): string[] => Object.entries(value).flatMap(([key, child]) => typeof child === 'object' ? keys(child, prefix + key + '.') : [prefix + key]);
    expect(keys(ko).sort()).toEqual(keys(vi).sort());
  });
});
