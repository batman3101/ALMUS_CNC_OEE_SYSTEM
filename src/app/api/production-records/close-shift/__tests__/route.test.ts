jest.mock('next/server', () => ({
  NextResponse: { json: (b: unknown, i?: { status?: number }) => ({ status: i?.status ?? 200, json: async () => b }) },
}));
const mockRequireUser = jest.fn();
const mockAssert = jest.fn();
const mockFrom = jest.fn();
const mockGetShiftWindow = jest.fn();
const mockLoadRows = jest.fn();
const mockBreak = jest.fn();
jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: (...a: unknown[]) => mockAssert(...a),
  apiAuthErrorResponse: () => null,
}));
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a) } }));
jest.mock('@/lib/shiftDowntime', () => ({
  getShiftWindow: (...a: unknown[]) => mockGetShiftWindow(...a),
  loadDowntimeSourceRows: (...a: unknown[]) => mockLoadRows(...a),
}));
jest.mock('@/lib/plannedRuntime', () => ({ getBreakTimeMinutes: () => mockBreak() }));

import { POST } from '../route';
const MACHINE = '11111111-1111-4111-8111-111111111111';
const WINDOW = { start: new Date('2026-07-17T08:00:00+07:00').getTime(), end: new Date('2026-07-17T20:00:00+07:00').getTime() };
const req = (b: unknown) => ({ url: 'http://x/api/production-records/close-shift', json: async () => b }) as never;

const wireDb = ({ lastQty = 112, tact = 300, existingDefect = null, upsert = jest.fn().mockResolvedValue({ data: [{ record_id: 'r1' }], error: null }) }: { lastQty?: number | null; tact?: number | null; existingDefect?: number | null; upsert?: jest.Mock } = {}) => {
  mockFrom.mockImplementation((t: string) => {
    if (t === 'production_progress_reports') return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: lastQty === null ? null : { shift_output_qty: lastQty }, error: null }) }) }) }) }) }) }) };
    if (t === 'machines_with_production_info') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { current_tact_time: tact }, error: null }) }) }) };
    if (t === 'production_records') return {
      // 재마감 시 기존 record 의 확정 불량을 읽는 경로(F2).
      select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingDefect === null ? null : { defect_qty: existingDefect }, error: null }) }) }) }) }),
      upsert,
    };
    throw new Error(`unexpected ${t}`);
  });
  return { upsert };
};

describe('POST /api/production-records/close-shift', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssert.mockReturnValue(undefined);
    mockGetShiftWindow.mockResolvedValue(WINDOW);
    mockLoadRows.mockResolvedValue([]);      // 비가동 0
    mockBreak.mockResolvedValue(110);
  });

  it('진척 마지막값을 output 으로, defect NULL 로 마감한다', async () => {
    const { upsert } = wireDb({ lastQty: 112 });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));
    expect(res.status).toBe(201);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ machine_id: MACHINE, date: '2026-07-17', shift: 'A', output_qty: 112, defect_qty: null }),
      expect.anything(),
    );
  });

  it('final_qty 를 주면 그 값으로 마감한다 (종이 전사)', async () => {
    const { upsert } = wireDb({ lastQty: 112 });
    await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A', final_qty: 130 }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ output_qty: 130, defect_qty: null }), expect.anything());
  });

  it('진척도 없고 final_qty 도 없으면 400 (마감할 수량 없음)', async () => {
    wireDb({ lastQty: null });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));
    expect(res.status).toBe(400);
  });

  it('담당이 아닌 설비는 거부', async () => {
    wireDb();
    mockAssert.mockImplementation(() => { throw new Error('forbidden'); });
    await expect(POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }))).rejects.toThrow();
  });

  // 브라우저 E2E 에서 잡은 회귀: runtime 은 정수 컬럼이라 반올림해야 한다(fractional tact 방어).
  it('정수 컬럼(planned/actual/ideal_runtime)을 반올림해 저장한다', async () => {
    const { upsert } = wireDb({ lastQty: 112, tact: 322 }); // 112*322/60 = 601.07 → 반올림 필요
    await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));
    const payload = upsert.mock.calls[0][0] as { planned_runtime: number; actual_runtime: number | null; ideal_runtime: number };
    expect(Number.isInteger(payload.planned_runtime)).toBe(true);
    expect(Number.isInteger(payload.ideal_runtime)).toBe(true);
    expect(payload.actual_runtime === null || Number.isInteger(payload.actual_runtime)).toBe(true);
  });

  // F2(감사): 다음날 불량이 이미 확정된 교대를 재마감해도 그 확정 불량을 null 로 덮지 않는다.
  it('이미 확정된 불량이 있으면 재마감이 defect 를 보존하고 quality 를 재파생한다', async () => {
    const { upsert } = wireDb({ existingDefect: 8, lastQty: 100 });
    await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A', final_qty: 100 }));
    const payload = upsert.mock.calls[0][0] as { defect_qty: number | null; quality: number | null; oee: number | null };
    expect(payload.defect_qty).toBe(8);                       // 덮어쓰지 않고 보존
    expect(payload.quality).toBeCloseTo((100 - 8) / 100, 4);  // 새 output 기준 재파생
  });

  it('기존 record 가 없거나 불량 미확정이면 defect 는 NULL 로 마감한다(기존 동작)', async () => {
    const { upsert } = wireDb({ existingDefect: null, lastQty: 112 });
    await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));
    const payload = upsert.mock.calls[0][0] as { defect_qty: number | null; quality: number | null };
    expect(payload.defect_qty).toBeNull();
    expect(payload.quality).toBeNull();
  });
});
