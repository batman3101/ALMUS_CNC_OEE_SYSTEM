import type { ForecastPreview } from '@/types/forecast';

const mockUpsert = jest.fn();
const mockMaybeSingle = jest.fn();
const mockSnapshot = jest.fn();
const mockPolicy = jest.fn();

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: () => ({
      upsert: (...args: unknown[]) => { mockUpsert(...args); return { select: () => ({ single: async () => ({ data: { submitted_at: '2026-09-29T02:00:00Z' }, error: null }) }) }; },
      select: () => ({ eq: () => ({ maybeSingle: () => mockMaybeSingle() }) }),
    }),
  },
}));
jest.mock('@/lib/forecast/capacitySnapshot', () => ({ loadForecastCapacitySnapshot: (...args: unknown[]) => mockSnapshot(...args) }));
jest.mock('@/lib/forecast/capacityPolicy', () => ({ loadForecastCapacityPolicy: (...args: unknown[]) => mockPolicy(...args) }));

import { loadForecastSubmission, saveForecastSubmission } from '../submission';

const factory = { id: 'f1', code: 'ALT' };
const parsed: ForecastPreview = {
  parserVersion: 'almus-v1', sourceHash: 'hash-1', sheet: 'CNC', dates: ['2026-10-05'],
  rows: [{ sourceRow: 15, model: 'H8', displayModel: 'H8', vendor: 'ALMUS', processGroup: 'CNC', processLabel: 'CNC 1 ~ CNC 2', processes: ['CNC1', 'CNC2'], issues: [],
    quantities: [{ date: '2026-10-05', cell: 'I15', quantity: 9000, state: 'number', formula: true, error: null }] }],
  summary: { sourceRows: 1, excludedRows: 0, models: 1, formulaCells: 1, numericTotal: 9000, states: { number: 1, blank: 0, error: 0, missing_cache: 0, invalid: 0 }, fractionalCells: 0, rowIssues: 0 },
  requiresReview: true, capacityValidated: false,
};
const snapshotAt = (takenAt: string, modelId: string) => ({
  status: 'available', takenAt, models: [], machines: [{ id: 'm1', name: 'CNC-001', location: 'B', isActive: true, modelId, processId: 'p1' }],
});

describe('forecast submission (one per factory, file data only)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPolicy.mockResolvedValue({ status: 'available', source: 'oee_settings', timezone: 'Asia/Ho_Chi_Minh', shiftAStart: '08:00', shiftBStart: '20:00', breakMinutes: 110, separateEfficiencyMultiplier: false });
  });

  it('stores only what came from the file — never machines, T/T or the capacity policy', async () => {
    mockSnapshot.mockResolvedValue(snapshotAt('2026-09-29T01:00:00Z', 'model-old'));
    const result = await saveForecastSubmission(factory, 'user-1', 'W39.xlsx', parsed);
    const [row, options] = mockUpsert.mock.calls[0];
    expect(options).toEqual({ onConflict: 'factory_id' });
    expect(Object.keys(row.preview).sort()).toEqual(['dates', 'rows', 'summary']);
    expect(JSON.stringify(row)).not.toMatch(/machines|capacitySnapshot|capacityPolicy|tactTime/);
    expect(row).toMatchObject({ factory_id: 'f1', file_name: 'W39.xlsx', source_hash: 'hash-1', submitted_by: 'user-1' });
    expect(result.submission).toEqual({ submittedAt: '2026-09-29T02:00:00Z' });
  });

  it('re-reads the machines at load time, so setup work done after submission is the new "before" layout', async () => {
    mockMaybeSingle.mockResolvedValue({ data: {
      file_name: 'W39.xlsx', source_hash: 'hash-1', parser_version: 'almus-v1', sheet: 'CNC',
      preview: { dates: parsed.dates, rows: parsed.rows, summary: parsed.summary }, submitted_at: '2026-09-29T02:00:00Z',
    }, error: null });
    mockSnapshot.mockResolvedValue(snapshotAt('2026-10-02T09:00:00Z', 'model-after-setup'));
    const loaded = await loadForecastSubmission(factory);
    expect(mockSnapshot).toHaveBeenCalledWith('f1');
    expect(loaded?.capacitySnapshot).toEqual(snapshotAt('2026-10-02T09:00:00Z', 'model-after-setup'));
    expect(loaded).toMatchObject({ fileName: 'W39.xlsx', sourceHash: 'hash-1', rows: parsed.rows, factory, submission: { submittedAt: '2026-09-29T02:00:00Z' } });
  });

  it('returns null when the factory has not accepted a Forecast', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await loadForecastSubmission(factory)).toBeNull();
    expect(mockSnapshot).not.toHaveBeenCalled();
  });
});
