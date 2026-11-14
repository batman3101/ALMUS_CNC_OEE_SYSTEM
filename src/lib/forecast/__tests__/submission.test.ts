import type { ForecastPreview } from '@/types/forecast';

const mockUpsert = jest.fn();
const mockMaybeSingle = jest.fn();
const mockOverrides = jest.fn();
const mockSnapshot = jest.fn();
const mockPolicy = jest.fn();
const SUBMISSION_ID = '11111111-1111-4111-8111-111111111111';

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => (table === 'forecast_po_overrides'
      // 실제 PO 수정값은 (공장, 접수 번호)로 좁혀 읽는다.
      ? {
        select: () => {
          const filters: unknown[][] = [];
          const api: Record<string, unknown> = {};
          api.eq = (...args: unknown[]) => { filters.push(args); return api; };
          api.order = () => api;
          api.range = () => mockOverrides(filters);
          return api;
        },
      }
      : {
        // 접수를 확정하면 DB 트리거가 새 submission_id 를 만들어 돌려준다(초기화).
        upsert: (...args: unknown[]) => { mockUpsert(...args); return { select: () => ({ single: async () => ({ data: { submitted_at: '2026-09-29T02:00:00Z', submission_id: SUBMISSION_ID }, error: null }) }) }; },
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
const storedRow = (extra: object = {}) => ({
  data: {
    file_name: 'W39.xlsx', source_hash: 'hash-1', parser_version: 'almus-v1', sheet: 'CNC',
    preview: { dates: parsed.dates, rows: parsed.rows, summary: parsed.summary }, submitted_at: '2026-09-29T02:00:00Z', submission_id: SUBMISSION_ID, ...extra,
  },
  error: null,
});

describe('forecast submission (one per factory, file data only)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOverrides.mockResolvedValue({ data: [], error: null, count: 0 });
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
    expect(result.submission).toEqual({ submittedAt: '2026-09-29T02:00:00Z', submissionId: SUBMISSION_ID });
  });

  it('새로 접수한 Forecast 는 실제 PO 수정값 없이 시작한다 (새 접수 = 초기화, 사용자 결정 2026-09-29)', async () => {
    mockSnapshot.mockResolvedValue(snapshotAt('2026-09-29T01:00:00Z', 'm'));
    const result = await saveForecastSubmission(factory, 'user-1', 'W40.xlsx', parsed);
    expect(result.rows.flatMap(r => r.quantities).some(q => q.po)).toBe(false);
    // 옛 수정값을 지우지도 읽지도 않는다 — 새 접수 번호와 맞지 않아 쓰이지 않을 뿐이고, 이력으로 남는다.
    expect(mockOverrides).not.toHaveBeenCalled();
    // 접수 번호는 DB 트리거가 정한다 — 앱이 번호를 만들어 넣지 않는다.
    expect(mockUpsert.mock.calls[0][0]).not.toHaveProperty('submission_id');
  });

  it('re-reads the machines at load time, so setup work done after submission is the new "before" layout', async () => {
    mockMaybeSingle.mockResolvedValue(storedRow());
    mockSnapshot.mockResolvedValue(snapshotAt('2026-10-02T09:00:00Z', 'model-after-setup'));
    const loaded = await loadForecastSubmission(factory);
    expect(mockSnapshot).toHaveBeenCalledWith('f1');
    expect(loaded?.capacitySnapshot).toEqual(snapshotAt('2026-10-02T09:00:00Z', 'model-after-setup'));
    expect(loaded).toMatchObject({ fileName: 'W39.xlsx', sourceHash: 'hash-1', rows: parsed.rows, factory, submission: { submittedAt: '2026-09-29T02:00:00Z', submissionId: SUBMISSION_ID } });
  });

  it('현재 접수 번호의 실제 PO 수정값을 원본 수량 옆에 붙여 돌려준다 (원본은 그대로)', async () => {
    mockMaybeSingle.mockResolvedValue(storedRow());
    mockOverrides.mockResolvedValue({ data: [{ source_row: 15, work_date: '2026-10-05', quantity: 12000, updated_at: '2026-09-29T05:00:00Z' }], error: null, count: 1 });
    mockSnapshot.mockResolvedValue(snapshotAt('t', 'm'));
    const loaded = await loadForecastSubmission(factory);
    expect(loaded?.rows[0].quantities[0]).toMatchObject({ quantity: 9000, state: 'number', po: { quantity: 12000, updatedAt: '2026-09-29T05:00:00Z' } });
    // 수정값은 (공장, 접수 번호)로 좁혀 읽는다.
    expect(mockOverrides).toHaveBeenCalledWith([['factory_id', 'f1'], ['submission_id', SUBMISSION_ID]]);
  });

  it('수정값 조회가 실패하면 "수정값 없음"으로 뭉개지 않고 실패한다 — 시뮬레이션이 조용히 Forecast 로 돌아가면 안 된다', async () => {
    mockMaybeSingle.mockResolvedValue(storedRow());
    mockOverrides.mockResolvedValue({ data: null, error: { message: 'relation "forecast_po_overrides" does not exist' }, count: null });
    mockSnapshot.mockResolvedValue(snapshotAt('t', 'm'));
    await expect(loadForecastSubmission(factory)).rejects.toMatchObject({ message: expect.stringContaining('does not exist') });
  });

  it('returns null when the factory has not accepted a Forecast', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });
    expect(await loadForecastSubmission(factory)).toBeNull();
    expect(mockSnapshot).not.toHaveBeenCalled();
    expect(mockOverrides).not.toHaveBeenCalled();
  });
});
