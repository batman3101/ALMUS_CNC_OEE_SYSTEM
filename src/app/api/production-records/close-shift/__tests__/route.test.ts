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

/**
 * 이 Route 는 공장 인지 계약(`requireFactoryUser`)으로 전환됐다.
 *
 * 새 mock 을 따로 만들지 않고 **같은 함수**에 연결한다. 그래야 아래 단언들이 검증하던
 * 성질이 그대로 유지된다 — 거부가 조회보다 먼저인가, 허용 역할 목록이 무엇인가.
 */
jest.mock('@/lib/factoryAuth', () => ({
  requireFactoryUser: (...a: unknown[]) => mockRequireUser(...a),
  assertFactoryMachineAccess: (...a: unknown[]) => mockAssert(...a),
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a), rpc: (...a: unknown[]) => mockRpc(...a) },
}));
jest.mock('@/lib/shiftDowntime', () => ({
  // 라우트는 이제 유예(buffer)까지 함께 받는다 — 마감 허용 시점을 진척 창과 **같은 판정
  // 함수**에서 끌어내기 위해서다(적대적 재감사 #5). 창과 유예를 따로 조회하면 그 사이
  // 설정이 바뀔 때 서로 다른 세대의 값으로 판단하게 된다.
  getShiftReportingWindow: (...a: unknown[]) => mockGetShiftWindow(...a),
  loadDowntimeSourceRows: (...a: unknown[]) => mockLoadRows(...a),
}));
jest.mock('@/lib/plannedRuntime', () => ({ getBreakTimeMinutes: () => mockBreak() }));

import { POST } from '../route';
const MACHINE = '11111111-1111-4111-8111-111111111111';
const WINDOW = { start: new Date('2026-07-17T08:00:00+07:00').getTime(), end: new Date('2026-07-17T20:00:00+07:00').getTime() };
const req = (b: unknown) => ({ url: 'http://x/api/production-records/close-shift', json: async () => b }) as never;

/** 라우트가 부른 순서를 기록한다 — 지문↔행 조회 순서가 #6 수정의 핵심이라 순서를 고정한다. */
let callOrder: string[] = [];

const DIGEST = 'digest-abc123';

/**
 * PostgREST 빌더를 흉내낸다 — 필터 메서드는 **자신을 돌려주고** 종단만 결과를 준다.
 *
 * 예전 mock 들은 `select→eq→eq→...` 중첩 깊이를 코드에 박아 놨다. 그래서 쿼리에 필터가
 * 하나 붙는 순간(여기서는 공장 조건) 검사 내용과 무관한 TypeError 로 전부 죽었고, 더 나쁘게는
 * 그 500 이 원래 검증하려던 상태 코드를 가렸다.
 */
const chain = (result: unknown) => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is', 'in', 'gte', 'lte', 'lt', 'or', 'neq', 'order', 'limit', 'range']) {
    q[m] = () => q;
  }
  q.single = async () => result;
  q.maybeSingle = async () => result;
  q.then = (resolve: (v: unknown) => unknown) => resolve(result);
  return q;
};

// F2(재마감 불량 보존)와 quality/oee 파생은 close_shift_upsert RPC(advisory lock) 안으로
// 이동했다 — 라우트는 production_records 를 직접 읽거나 쓰지 않는다(TOCTOU 차단).
const wireDb = (
  { lastQty = 112, tact = 300, digest = DIGEST as string | null, upsert = { ok: true, preserved_defect: null } as Record<string, unknown> }:
  { lastQty?: number | null; tact?: number | null; digest?: string | null; upsert?: Record<string, unknown> } = {}
) => {
  mockFrom.mockImplementation((t: string) => {
    if (t === 'production_progress_reports') {
      return chain({ data: lastQty === null ? null : { shift_output_qty: lastQty }, error: null });
    }
    if (t === 'machines_with_production_info') {
      return chain({ data: { current_tact_time: tact }, error: null });
    }
    throw new Error(`unexpected ${t}`);
  });
  mockRpc.mockImplementation(async (name: string) => {
    callOrder.push(`rpc:${name}`);
    if (name === 'downtime_window_digest') {
      return digest === null
        ? { data: null, error: { message: 'digest failed' } }
        : { data: digest, error: null };
    }
    if (name === 'close_shift_upsert_v3') return { data: upsert, error: null };
    throw new Error(`unexpected rpc ${name}`);
  });
};

const upsertPayload = () => {
  const call = mockRpc.mock.calls.find(c => c[0] === 'close_shift_upsert_v3');
  expect(call).toBeDefined();
  return call![1] as Record<string, unknown>;
};

describe('POST /api/production-records/close-shift', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssert.mockReturnValue(undefined);
    callOrder = [];
    // WINDOW 는 2026-07-17 로 이미 한참 지난 교대라 유예 10분을 더해도 마감 가능하다.
    mockGetShiftWindow.mockResolvedValue({ window: WINDOW, bufferMinutes: 10 });
    mockLoadRows.mockImplementation(async () => { callOrder.push('loadRows'); return []; }); // 비가동 0
    mockBreak.mockResolvedValue(110);
  });

  it('진척 마지막값을 output 으로 RPC 에 위임해 마감한다', async () => {
    wireDb({ lastQty: 112 });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));
    expect(res.status).toBe(201);
    const p = upsertPayload();
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
    expect(upsertPayload().p_output_qty).toBe(130);
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
    const p = upsertPayload() as { p_planned_runtime: number; p_actual_runtime: number | null; p_ideal_runtime: number | null };
    expect(Number.isInteger(p.p_planned_runtime)).toBe(true);
    expect(p.p_ideal_runtime === null || Number.isInteger(p.p_ideal_runtime)).toBe(true);
    expect(p.p_actual_runtime === null || Number.isInteger(p.p_actual_runtime)).toBe(true);
  });

  // Codex 감사 #2: tact 미확인이면 120초 같은 임의값으로 성능을 날조하지 않는다(NULL≠0).
  it('tact 가 없으면 ideal/perf/tact 를 null 로 넘긴다 (avail 은 계산)', async () => {
    wireDb({ lastQty: 100, tact: null });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));
    expect(res.status).toBe(201);
    const p = upsertPayload();
    expect(p.p_tact_time_seconds).toBeNull();
    expect(p.p_ideal_runtime).toBeNull();
    expect(p.p_performance).toBeNull();
    expect(typeof p.p_availability).toBe('number');   // 비가동 0 → avail 계산 가능
  });

  it('RPC 실패(ok=false)면 500', async () => {
    wireDb({ upsert: { ok: false } });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));
    expect(res.status).toBe(500);
  });

  // 자체 감사 #4: UI 는 현재 교대를 제외하지만 API 를 직접 치면 진행 중·미래 교대를
  // "마감"해 가동률 100% 확정 record 를 만들 수 있었다 — 교대 종료 후에만 마감 허용.
  it('아직 끝나지 않은 교대는 400 (이른 마감 금지)', async () => {
    wireDb();
    const future = Date.now() + 60 * 60 * 1000;
    mockGetShiftWindow.mockResolvedValue({
      window: { start: future - 12 * 3600_000, end: future },
      bufferMinutes: 10,
    });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A', final_qty: 10 }));
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  // 적대적 재감사 #5: 교대는 끝났지만 **진척 유예가 아직 열려 있는** 10분. 예전에는 이
  // 구간에서 마감이 허용됐고, 마감이 잠금 밖에서 읽어둔 수량 위로 그 사이 승인된 더 큰
  // 진척이 얹혀 원천과 확정 레코드가 어긋날 수 있었다.
  it('교대는 끝났지만 진척 유예가 남아 있으면 400 (겹침 제거)', async () => {
    wireDb();
    const end = Date.now() - 5 * 60_000;           // 5분 전에 교대 종료
    mockGetShiftWindow.mockResolvedValue({
      window: { start: end - 12 * 3600_000, end },
      bufferMinutes: 10,                            // 유예는 아직 5분 남음
    });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A', final_qty: 10 }));
    expect(res.status).toBe(400);
    // 저장은커녕 지문 조회조차 하지 않는다 — 거부는 가장 앞에서 끝나야 한다.
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('진척 유예가 끝나면 마감할 수 있다', async () => {
    wireDb();
    const end = Date.now() - 11 * 60_000;          // 종료 후 11분 = 유예 10분 경과
    mockGetShiftWindow.mockResolvedValue({
      window: { start: end - 12 * 3600_000, end },
      bufferMinutes: 10,
    });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A', final_qty: 10 }));
    expect(res.status).toBe(201);
  });

  // 자체 감사 #2: 확정 불량보다 작은 output 재마감은 RPC 가 거부(output_lt_defect) → 409.
  it('확정 불량보다 작은 output 재마감은 409', async () => {
    wireDb({ upsert: { ok: false, reason: 'output_lt_defect', defect_qty: 8 } });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A', final_qty: 5 }));
    expect(res.status).toBe(409);
  });

  // ── Codex 감사 #6: 읽기↔저장 TOCTOU ─────────────────────────────────────
  //
  // 라우트는 비가동 원천을 트랜잭션 밖에서 읽어 지표를 계산한 뒤 RPC 로 저장한다.
  // 그 사이 비가동이 정정되면 원천과 다른 확정 OEE 가 **영구** 저장된다(스냅샷 보존 원칙
  // 때문에 나중에 원천을 고쳐도 따라오지 않는다). 원천 지문을 잠금 아래에서 대조해 막는다.
  describe('원천 지문 대조', () => {
    it('지문을 행 조회보다 **먼저** 읽는다', async () => {
      // 이 순서가 정확성의 전부다. 뒤집으면(행 먼저, 지문 나중) 그 사이의 변경이 지문에는
      // 반영되고 행에는 반영되지 않아 RPC 대조가 통과한다 — 낡은 값이 확정 저장되는
      // 거짓 음성이다. 지금 순서에서는 같은 변경이 지문 불일치를 만들어 409 가 된다.
      wireDb();

      await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));

      expect(callOrder.indexOf('rpc:downtime_window_digest')).toBeGreaterThanOrEqual(0);
      expect(callOrder.indexOf('loadRows')).toBeGreaterThanOrEqual(0);
      expect(callOrder.indexOf('rpc:downtime_window_digest'))
        .toBeLessThan(callOrder.indexOf('loadRows'));
    });

    it('읽은 지문과 계산에 쓴 시간창을 그대로 RPC 에 넘긴다', async () => {
      wireDb();

      await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));

      const p = upsertPayload();
      expect(p.p_expected_digest).toBe(DIGEST);
      // 지문을 계산한 창과 저장에 쓴 창이 다르면 대조가 무의미해진다 — 같은 창을 넘긴다.
      expect(p.p_window_start).toBe(new Date(WINDOW.start).toISOString());
      expect(p.p_window_end).toBe(new Date(WINDOW.end).toISOString());
      const digestCall = mockRpc.mock.calls.find(c => c[0] === 'downtime_window_digest')![1] as Record<string, unknown>;
      expect(digestCall.p_window_start).toBe(p.p_window_start);
      expect(digestCall.p_window_end).toBe(p.p_window_end);
    });

    it('원천이 바뀌었으면 409 + retryable (저장하지 않는다)', async () => {
      wireDb({ upsert: { ok: false, reason: 'source_changed' } });

      const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));

      expect(res.status).toBe(409);
      // retryable 이 없으면 클라이언트가 재시도하지 않아, 정상 마감이 조용히 실패로 끝난다.
      expect(await res.json()).toEqual(expect.objectContaining({ retryable: true }));
    });

    it('지문 조회가 실패하면 500 이고 저장을 시도하지 않는다', async () => {
      // 대조 재료가 없는 채로 저장하면 이 수정 전과 똑같아진다 — 차라리 실패한다.
      wireDb({ digest: null });

      const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));

      expect(res.status).toBe(500);
      expect(mockRpc.mock.calls.some(c => c[0] === 'close_shift_upsert_v3')).toBe(false);
    });
  });

  /**
   * 진척보다 낮은 마감.
   *
   * 진척 보고는 누적이라 줄어들 수 없다(감소는 409). 그런데 마감은 같은 규칙을 따르지 않아
   * `final_qty` 로 진척보다 작은 값을 보내면 그대로 확정됐고, 진척 이력과 확정 실적이 어긋난
   * 채 남았다 — 확정 레코드가 생기므로 마감 대기 목록에서도 사라져 아무도 다시 보지 못했다.
   *
   * 현장에서 실제로 일어날 수 있는 일이라(진척 오입력을 종이 카운트로 정정) **막지 않고**
   * 사유를 받아 감사 기록에 남기기로 했다(사용자 확정 2026-08-04).
   *
   * 판정은 RPC 가 잠금 아래에서 한다. 라우트는 사유를 **그대로 넘기기만** 해야 한다 —
   * 여기서 진척을 읽어 미리 비교하면 그 읽기와 저장 사이에 새 진척이 들어와, 사유가
   * 필요한 마감이 사유 없이 통과할 수 있다.
   */
  describe('진척보다 낮은 마감', () => {
    it('사유를 그대로 RPC 에 넘긴다', async () => {
      wireDb();

      await POST(req({
        machine_id: MACHINE, date: '2026-07-17', shift: 'A',
        final_qty: 10, below_progress_reason: '진척 오입력, 종이 카운트로 정정',
      }));

      expect(upsertPayload()).toEqual(expect.objectContaining({
        p_output_qty: 10,
        p_below_progress_reason: '진척 오입력, 종이 카운트로 정정',
      }));
    });

    it('사유가 없으면 null 로 넘겨 RPC 가 판정하게 한다', async () => {
      wireDb();

      await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A', final_qty: 10 }));

      expect(upsertPayload()).toEqual(expect.objectContaining({ p_below_progress_reason: null }));
    });

    it('감사 기록의 주체로 요청자를 넘긴다', async () => {
      wireDb();

      await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A', final_qty: 10 }));

      // 서비스 롤로 부르므로 RPC 안에서 auth.uid() 를 쓸 수 없다 — 라우트가 실어 줘야 한다.
      expect(upsertPayload()).toEqual(expect.objectContaining({ p_actor_id: 'op-1' }));
    });

    it('사유가 필요하다는 RPC 응답을 409 + 마지막 진척값으로 전한다', async () => {
      wireDb({ upsert: { ok: false, reason: 'below_progress_needs_reason', last_progress_qty: 112 } });

      const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A', final_qty: 10 }));

      // 500 이면 화면이 "저장 실패"만 띄우고 사유를 물을 수 없다.
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual(expect.objectContaining({
        error: 'below_progress_needs_reason',
        last_progress_qty: 112,
      }));
    });
  });
});
