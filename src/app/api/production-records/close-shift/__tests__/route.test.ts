jest.mock('next/server', () => ({
  NextResponse: { json: (b: unknown, i?: { status?: number }) => ({ status: i?.status ?? 200, json: async () => b }) },
}));
const mockRequireUser = jest.fn();
const mockAssert = jest.fn();
const mockFrom = jest.fn();
const mockRpc = jest.fn();
const mockGetShiftWindow = jest.fn();
const mockLoadRows = jest.fn();
const mockBreak = jest.fn();
jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: (...a: unknown[]) => mockAssert(...a),
  apiAuthErrorResponse: () => null,
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a), rpc: (...a: unknown[]) => mockRpc(...a) },
}));
jest.mock('@/lib/shiftDowntime', () => ({
  getShiftWindow: (...a: unknown[]) => mockGetShiftWindow(...a),
  loadDowntimeSourceRows: (...a: unknown[]) => mockLoadRows(...a),
}));
jest.mock('@/lib/plannedRuntime', () => ({ getBreakTimeMinutes: () => mockBreak() }));

import { POST } from '../route';
const MACHINE = '11111111-1111-4111-8111-111111111111';
const WINDOW = { start: new Date('2026-07-17T08:00:00+07:00').getTime(), end: new Date('2026-07-17T20:00:00+07:00').getTime() };
const req = (b: unknown) => ({ url: 'http://x/api/production-records/close-shift', json: async () => b }) as never;

// F2(재마감 불량 보존)와 quality/oee 파생은 close_shift_upsert RPC(advisory lock) 안으로
// 이동했다 — 라우트는 production_records 를 직접 읽거나 쓰지 않는다(TOCTOU 차단).
const wireDb = ({ lastQty = 112, tact = 300 }: { lastQty?: number | null; tact?: number | null } = {}) => {
  mockFrom.mockImplementation((t: string) => {
    if (t === 'production_progress_reports') return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: lastQty === null ? null : { shift_output_qty: lastQty }, error: null }) }) }) }) }) }) }) };
    if (t === 'machines_with_production_info') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { current_tact_time: tact }, error: null }) }) }) };
    throw new Error(`unexpected ${t}`);
  });
  mockRpc.mockResolvedValue({ data: { ok: true, preserved_defect: null }, error: null });
};

const rpcPayload = () => {
  expect(mockRpc).toHaveBeenCalledWith('close_shift_upsert', expect.anything());
  return mockRpc.mock.calls[0][1] as Record<string, unknown>;
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

  it('진척 마지막값을 output 으로 RPC 에 위임해 마감한다', async () => {
    wireDb({ lastQty: 112 });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));
    expect(res.status).toBe(201);
    const p = rpcPayload();
    expect(p.p_machine_id).toBe(MACHINE);
    expect(p.p_date).toBe('2026-07-17');
    expect(p.p_shift).toBe('A');
    expect(p.p_output_qty).toBe(112);
    // defect 는 라우트가 만지지 않는다 — RPC 가 락 아래에서 기존 확정 불량을 보존·재파생한다.
    expect('p_defect_qty' in p).toBe(false);
  });

  it('final_qty 를 주면 그 값으로 마감한다 (종이 전사)', async () => {
    wireDb({ lastQty: 112 });
    await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A', final_qty: 130 }));
    expect(rpcPayload().p_output_qty).toBe(130);
  });

  it('진척도 없고 final_qty 도 없으면 400 (마감할 수량 없음)', async () => {
    wireDb({ lastQty: null });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('담당이 아닌 설비는 거부', async () => {
    wireDb();
    mockAssert.mockImplementation(() => { throw new Error('forbidden'); });
    await expect(POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }))).rejects.toThrow();
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // 브라우저 E2E 에서 잡은 회귀: runtime 은 정수 컬럼이라 반올림해야 한다(fractional tact 방어).
  it('정수 컬럼(planned/actual/ideal_runtime)을 반올림해 넘긴다', async () => {
    wireDb({ lastQty: 112, tact: 322 }); // 112*322/60 = 601.07 → 반올림 필요
    await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));
    const p = rpcPayload() as { p_planned_runtime: number; p_actual_runtime: number | null; p_ideal_runtime: number | null };
    expect(Number.isInteger(p.p_planned_runtime)).toBe(true);
    expect(p.p_ideal_runtime === null || Number.isInteger(p.p_ideal_runtime)).toBe(true);
    expect(p.p_actual_runtime === null || Number.isInteger(p.p_actual_runtime)).toBe(true);
  });

  // Codex 감사 #2: tact 미확인이면 120초 같은 임의값으로 성능을 날조하지 않는다(NULL≠0).
  it('tact 가 없으면 ideal/perf/tact 를 null 로 넘긴다 (avail 은 계산)', async () => {
    wireDb({ lastQty: 100, tact: null });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));
    expect(res.status).toBe(201);
    const p = rpcPayload();
    expect(p.p_tact_time_seconds).toBeNull();
    expect(p.p_ideal_runtime).toBeNull();
    expect(p.p_performance).toBeNull();
    expect(typeof p.p_availability).toBe('number');   // 비가동 0 → avail 계산 가능
  });

  it('RPC 실패(ok=false)면 500', async () => {
    wireDb();
    mockRpc.mockResolvedValue({ data: { ok: false }, error: null });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));
    expect(res.status).toBe(500);
  });
});
