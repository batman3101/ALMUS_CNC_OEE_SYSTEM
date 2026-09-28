import { fireEvent, render, screen, within } from '@testing-library/react';
import type { FactoryForecastPreview } from '@/types/forecast';
import WeeklySimulationCard from '../WeeklySimulationCard';

// The card embeds LayoutPlanLauncher (network + navigation); its flow is covered by scripts/verify-layout-studio-browser.cjs.
jest.mock('@/lib/authFetch', () => ({ authFetch: jest.fn() }));
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => opts && 'count' in opts ? `${key}:${opts.count}` : key, language: 'ko' }) }));

const days = (start: string, count: number) => Array.from({ length: count }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
const dates = days('2026-09-07', 14);
const row = (model: string, week1: number, week2: number, sourceRow = 1): FactoryForecastPreview['rows'][number] => ({
  sourceRow, model, displayModel: model, vendor: 'ALMUS', processGroup: 'CNC', processLabel: 'CNC 1 ~ CNC 2', processes: ['CNC1', 'CNC2'], issues: [],
  quantities: dates.map((date, i) => ({ date, cell: `I${i}`, quantity: i < 7 ? week1 : week2, state: 'number', formula: false, error: null })),
});
const preview = (overrides: Partial<FactoryForecastPreview> = {}): FactoryForecastPreview => ({
  parserVersion: 'almus-v1', sourceHash: 'h', sheet: 'S', dates, rows: [row('ON 1', 1300, 0), row('Hubble Y2', 50, 50, 2)],
  summary: { sourceRows: 2, excludedRows: 0, models: 2, formulaCells: 0, numericTotal: 0, states: { number: 28, blank: 0, error: 0, missing_cache: 0, invalid: 0 }, fractionalCells: 0, rowIssues: 0 },
  requiresReview: true, capacityValidated: false, factory: { id: 'f', code: 'ALT' }, fileName: 'plan.xlsx',
  capacityPolicy: { status: 'available', source: 'oee_settings', timezone: 'Asia/Ho_Chi_Minh', shiftAStart: '08:00', shiftBStart: '20:00', breakMinutes: 110, separateEfficiencyMultiplier: false },
  capacitySnapshot: { status: 'available', takenAt: '2026-09-25T00:00:00Z', models: [
    { id: 'on1', name: 'ON1', isActive: true, processes: [{ id: 'on1-c1', name: 'CNC #1', order: 1, tactTimeSeconds: 560 }, { id: 'on1-c2', name: 'CNC #2', order: 2, tactTimeSeconds: 558 }] },
  ], machines: [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, name: `CNC-${String(i + 1).padStart(3, '0')}`, location: 'A동', isActive: true, modelId: 'on1', processId: 'on1-c1' })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, name: `CNC-${String(i + 101).padStart(3, '0')}`, location: 'B동', isActive: true, modelId: 'on1', processId: 'on1-c2' })),
    { id: 'u', name: 'CNC-500', location: 'B동', isActive: true, modelId: null, processId: null },
  ] },
  ...overrides,
});

describe('WeeklySimulationCard', () => {
  const originalStyle = window.getComputedStyle.bind(window);
  beforeAll(() => { jest.spyOn(window, 'getComputedStyle').mockImplementation(element => originalStyle(element)); });
  afterAll(() => jest.restoreAllMocks());
  it('defaults to the first week and shows required vs current per model/process', () => {
    render(<WeeklySimulationCard preview={preview()} />);
    // ON 1 peak 1300, CAPA 130/day → 10 needed; CNC1 has 12 (surplus 2), CNC2 has 8 (shortage 2)
    const table = screen.getByTestId('requirements-table');
    expect(within(table).getByText('simulation.statuses.surplus')).toBeInTheDocument();
    expect(within(table).getByText('simulation.statuses.shortage')).toBeInTheDocument();
    expect(within(table).getAllByText('simulation.statuses.unmapped').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('simulation.unmappedTitle:1')).toBeInTheDocument();
  });
  it('proposes moving surplus machines before the unassigned one, highest number first', () => {
    render(<WeeklySimulationCard preview={preview()} />);
    const moves = screen.getByTestId('moves-table');
    const names = within(moves).getAllByText(/^CNC-\d{3}$/).map(el => el.textContent);
    expect(names).toEqual(['CNC-012', 'CNC-011']);
    expect(within(moves).getAllByText('simulation.reasons.surplus')).toHaveLength(2);
  });
  it('recomputes when another week is selected', () => {
    render(<WeeklySimulationCard preview={preview()} />);
    fireEvent.mouseDown(within(screen.getByTestId('week-select')).getByRole('combobox'));
    fireEvent.click(screen.getByText('W38 · 09-14~09-20'));
    // week 2: ON 1 demand 0 → both processes zero_demand, nothing to move
    expect(screen.getAllByText('simulation.statuses.zero_demand')).toHaveLength(2);
    expect(screen.getByText('simulation.noMoves')).toBeInTheDocument();
  });
  it('holds the simulation when the snapshot or the OEE settings are unavailable', () => {
    const { rerender } = render(<WeeklySimulationCard preview={preview({ capacitySnapshot: { status: 'unavailable' } })} />);
    expect(screen.getByText('simulation.snapshotUnavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('requirements-table')).not.toBeInTheDocument();
    rerender(<WeeklySimulationCard preview={preview({ capacityPolicy: { status: 'unavailable' } })} />);
    expect(screen.getByText('simulation.policyUnavailable')).toBeInTheDocument();
  });
});
