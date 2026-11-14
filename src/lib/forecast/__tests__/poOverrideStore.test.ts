const mockSubmission = jest.fn();
/** 수정값 조회 한 쪽: (from, to, 옵션) 을 받아 { data, error, count } 를 돌려주는 가짜 서버. 테스트가 구현을 바꿔 끼운다. */
const mockOverrides = jest.fn();
const mockOverrideFilters: unknown[][] = [];
const mockOverrideOrders: unknown[][] = [];
const mockRpc = jest.fn();

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => (table === 'forecast_submissions'
      ? { select: () => ({ eq: () => ({ maybeSingle: () => mockSubmission() }) }) }
      : {
        select: (_columns: string, options?: unknown) => {
          const api: Record<string, unknown> = {};
          api.eq = (...args: unknown[]) => { mockOverrideFilters.push(args); return api; };
          api.order = (...args: unknown[]) => { mockOverrideOrders.push(args); return api; };
          api.range = (from: number, to: number) => mockOverrides(from, to, options);
          return api;
        },
      }),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

import { applyPoOverride, loadPoOverrides, PoOverrideError, revertPoOverride } from '../poOverrideStore';

const SUBMISSION = '11111111-1111-4111-8111-111111111111';
const factory = { id: 'f1' };
const stored = (overrides: { processes?: string[]; model?: string } = {}) => ({
  submission_id: SUBMISSION,
  preview: { rows: [
    { sourceRow: 15, model: overrides.model ?? 'ON 1', processes: overrides.processes ?? ['CNC1', 'CNC2'], quantities: [
      { date: '2026-10-05', state: 'number', quantity: 3500 },
      { date: '2026-10-06', state: 'blank', quantity: null },
    ] },
    { sourceRow: 40, model: 'CNC3 ONLY', processes: [], quantities: [{ date: '2026-10-05', state: 'number', quantity: 10 }] },
  ] },
});
const target = { submissionId: SUBMISSION, sourceRow: 15, date: '2026-10-05' };
const rejection = async (promise: Promise<unknown>) => { try { await promise; } catch (e) { return e; } throw new Error('거부되어야 한다'); };

beforeEach(() => {
  jest.clearAllMocks();
  mockOverrideFilters.length = 0;
  mockOverrideOrders.length = 0;
  mockSubmission.mockResolvedValue({ data: stored(), error: null });
  mockRpc.mockResolvedValue({ data: { quantity: 4200, updated_at: '2026-09-29T03:00:00Z', unchanged: false }, error: null });
});

const overrideRow = (i: number, quantity = i) => ({ source_row: i + 1, work_date: '2026-10-05', quantity, updated_at: 't' });
/** 전체 total 행을 가진 서버: 한 번에 cap 개까지만 준다(PostgREST max-rows). */
const serverPage = (total: number, cap: number, last?: { quantity: number }) => (from: number, to: number) => {
  const end = Math.min(to + 1, from + cap, total);
  const data = Array.from({ length: Math.max(0, end - from) }, (_, i) => overrideRow(from + i, from + i === total - 1 && last ? last.quantity : from + i));
  return Promise.resolve({ data, error: null, count: total });
};

describe('loadPoOverrides', () => {
  it('공장과 접수 번호로 좁혀, 기본 키 순서로, 전체 개수와 함께 읽고 화면이 쓰는 모양으로 바꾼다', async () => {
    mockOverrides.mockResolvedValue({ data: [{ source_row: 15, work_date: '2026-10-05', quantity: 4200, updated_at: 't1' }], error: null, count: 1 });
    await expect(loadPoOverrides('f1', SUBMISSION)).resolves.toEqual([{ sourceRow: 15, date: '2026-10-05', quantity: 4200, updatedAt: 't1' }]);
    expect(mockOverrideFilters).toEqual([['factory_id', 'f1'], ['submission_id', SUBMISSION]]);
    expect(mockOverrideOrders).toEqual([['source_row', { ascending: true }], ['work_date', { ascending: true }]]);
    expect(mockOverrides.mock.calls[0][2]).toEqual({ count: 'exact' });
  });

  it('수정값이 하나도 없으면 빈 목록이다(빈 결과를 잘림으로 오해하지 않는다)', async () => {
    mockOverrides.mockResolvedValue({ data: [], error: null, count: 0 });
    await expect(loadPoOverrides('f1', SUBMISSION)).resolves.toEqual([]);
  });

  it('조회가 실패하면 "수정값 없음"으로 뭉개지 않고 던진다', async () => {
    mockOverrides.mockResolvedValue({ data: null, error: { message: 'relation "forecast_po_overrides" does not exist' }, count: null });
    await expect(loadPoOverrides('f1', SUBMISSION)).rejects.toMatchObject({ message: expect.stringContaining('does not exist') });
  });

  // 감사 PO-01 (2026-09-29): 서버 반환 상한이 요청한 크기보다 낮아도 잘린 결과를 정상으로 쓰면 안 된다.
  it('PO-01: 서버가 상한(1000)으로 잘라 줘도 끝까지 읽어 마지막 칸의 PO 도 빠지지 않는다', async () => {
    mockOverrides.mockImplementation(serverPage(1001, 1000, { quantity: 9999 }));
    const loaded = await loadPoOverrides('f1', SUBMISSION);
    expect(loaded).toHaveLength(1001);
    expect(loaded[1000]).toMatchObject({ sourceRow: 1001, quantity: 9999 });
    expect(new Set(loaded.map(o => o.sourceRow)).size).toBe(1001);
  });

  it('PO-01: 상한이 쪽 크기보다 훨씬 낮아도(400) 이어 읽는다', async () => {
    mockOverrides.mockImplementation(serverPage(2300, 400));
    await expect(loadPoOverrides('f1', SUBMISSION)).resolves.toHaveLength(2300);
  });

  it('PO-01: 전체 개수를 받지 못하면 잘렸는지 확인할 수 없으므로 실패한다', async () => {
    mockOverrides.mockResolvedValue({ data: [overrideRow(0)], error: null, count: null });
    await expect(loadPoOverrides('f1', SUBMISSION)).rejects.toMatchObject({ name: 'IncompleteReadError', reason: 'count_missing' });
  });

  // 재감사 PAGE-01 (2026-09-29): 쪽 경계에서 같은 칸이 두 번 읽히면(오프셋 이동) 그 결과를 정상으로 쓰지 않는다.
  it('PAGE-01: 같은 칸(행 번호·날짜)이 두 번 읽히면 완전한 결과로 받아들이지 않고 실패한다', async () => {
    mockOverrides.mockResolvedValue({ data: [overrideRow(0), overrideRow(0)], error: null, count: 2 });
    await expect(loadPoOverrides('f1', SUBMISSION)).rejects.toMatchObject({ name: 'IncompleteReadError', reason: 'changed' });
  });

  it('PO-01: 개수는 더 있다는데 빈 쪽이 오면 조용히 넘기지 않고 실패한다', async () => {
    mockOverrides.mockResolvedValue({ data: [], error: null, count: 3 });
    await expect(loadPoOverrides('f1', SUBMISSION)).rejects.toMatchObject({ name: 'IncompleteReadError', reason: 'short_page' });
  });
});

describe('applyPoOverride', () => {
  it('저장된 접수본에서 모델·Forecast 원본 값을 읽어 DB 함수에 넘긴다 — 화면이 보낸 값을 믿지 않는다', async () => {
    const result = await applyPoOverride(factory, 'user-1', { ...target, quantity: 4200 });
    expect(mockRpc).toHaveBeenCalledWith('apply_forecast_po_override', {
      p_factory_id: 'f1', p_submission_id: SUBMISSION, p_actor: 'user-1', p_source_row: 15, p_work_date: '2026-10-05',
      p_model: 'ON 1', p_quantity: 4200, p_forecast_quantity: 3500, p_forecast_state: 'number',
    });
    expect(result).toEqual({ quantity: 4200, updatedAt: '2026-09-29T03:00:00Z', unchanged: false });
  });

  it('원본이 빈 칸이어도 적용할 수 있고, 그때 원본 값은 null·상태는 blank 로 남는다', async () => {
    await applyPoOverride(factory, 'user-1', { ...target, date: '2026-10-06', quantity: 100 });
    expect(mockRpc.mock.calls[0][1]).toMatchObject({ p_forecast_quantity: null, p_forecast_state: 'blank' });
  });

  it('같은 값 재적용은 unchanged 로 알려 준다', async () => {
    mockRpc.mockResolvedValue({ data: { quantity: 3500, updated_at: 't', unchanged: true }, error: null });
    await expect(applyPoOverride(factory, 'u', { ...target, quantity: 3500 })).resolves.toMatchObject({ unchanged: true });
  });

  it('접수가 없으면 404 no_submission', async () => {
    mockSubmission.mockResolvedValue({ data: null, error: null });
    expect(await rejection(applyPoOverride(factory, 'u', { ...target, quantity: 1 }))).toMatchObject({ status: 404, code: 'no_submission' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('화면이 본 접수 번호가 현재와 다르면 409 submission_changed — 쓰지 않는다', async () => {
    const error = await rejection(applyPoOverride(factory, 'u', { ...target, submissionId: '22222222-2222-4222-8222-222222222222', quantity: 1 }));
    expect(error).toBeInstanceOf(PoOverrideError);
    expect(error).toMatchObject({ status: 409, code: 'submission_changed' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it.each([[{ sourceRow: 999 }], [{ date: '2027-01-01' }]])('접수본에 없는 칸(%j)은 404 po_target_not_found', async change => {
    expect(await rejection(applyPoOverride(factory, 'u', { ...target, ...change, quantity: 1 }))).toMatchObject({ status: 404, code: 'po_target_not_found' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('CNC1~CNC2 로 매핑되지 않은 행은 422 po_row_unsupported — 효과 없는 수정값을 남기지 않는다', async () => {
    expect(await rejection(applyPoOverride(factory, 'u', { ...target, sourceRow: 40, quantity: 1 }))).toMatchObject({ status: 422, code: 'po_row_unsupported' });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('DB 함수가 접수 변경으로 거부하면 409, 수량 검사로 거부하면 400 이다', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'SUBMISSION_CHANGED' } });
    expect(await rejection(applyPoOverride(factory, 'u', { ...target, quantity: 1 }))).toMatchObject({ status: 409, code: 'submission_changed' });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'INVALID_PO_QUANTITY' } });
    expect(await rejection(applyPoOverride(factory, 'u', { ...target, quantity: 1 }))).toMatchObject({ status: 400, code: 'invalid_request' });
  });

  it('알 수 없는 DB 오류는 그대로 던진다(라우트가 500 으로 바꾼다)', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'connection reset' } });
    expect(await rejection(applyPoOverride(factory, 'u', { ...target, quantity: 1 }))).toMatchObject({ message: 'connection reset' });
  });

  it('접수 조회가 실패하면 던진다', async () => {
    mockSubmission.mockResolvedValue({ data: null, error: { message: 'db down' } });
    expect(await rejection(applyPoOverride(factory, 'u', { ...target, quantity: 1 }))).toMatchObject({ message: 'db down' });
  });
});

describe('revertPoOverride', () => {
  it('공장·접수·칸을 DB 함수에 넘기고 원복 여부를 돌려준다', async () => {
    mockRpc.mockResolvedValue({ data: { reverted: true, previous: 4200 }, error: null });
    await expect(revertPoOverride(factory, 'user-1', target)).resolves.toEqual({ reverted: true });
    expect(mockRpc).toHaveBeenCalledWith('revert_forecast_po_override', {
      p_factory_id: 'f1', p_submission_id: SUBMISSION, p_actor: 'user-1', p_source_row: 15, p_work_date: '2026-10-05',
    });
  });

  it('되돌릴 수정값이 없으면 reverted: false (오류가 아니다)', async () => {
    mockRpc.mockResolvedValue({ data: { reverted: false }, error: null });
    await expect(revertPoOverride(factory, 'u', target)).resolves.toEqual({ reverted: false });
  });

  it('접수가 바뀌었으면 409 submission_changed', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'SUBMISSION_CHANGED' } });
    expect(await rejection(revertPoOverride(factory, 'u', target))).toMatchObject({ status: 409, code: 'submission_changed' });
  });
});
