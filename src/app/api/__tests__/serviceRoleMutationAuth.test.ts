const mockRequireUser = jest.fn();
const mockAssertMachineAccess = jest.fn();

class MockApiAuthError extends Error {
  constructor(message: string, readonly status: 401 | 403) {
    super(message);
  }
}

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));

jest.mock('@/lib/apiAuth', () => ({
  ApiAuthError: class MockRouteApiAuthError extends Error {
    constructor(message: string, readonly status: 401 | 403) {
      super(message);
    }
  },
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  assertMachineAccess: (...args: unknown[]) => mockAssertMachineAccess(...args),
  apiAuthErrorResponse: (error: unknown) => {
    const candidate = error as { message?: string; status?: number };
    return candidate?.status === 401 || candidate?.status === 403
      ? { body: { success: false, error: candidate.message }, status: candidate.status }
      : null;
  },
}));

/**
 * 이 Route 는 공장 인지 계약(`requireFactoryUser`)으로 전환됐다.
 *
 * 새 mock 을 따로 만들지 않고 **같은 함수**에 연결한다. 그래야 아래 단언들이 검증하던
 * 성질이 그대로 유지된다 — 거부가 조회보다 먼저인가, 허용 역할 목록이 무엇인가.
 * 별도 mock 을 두면 두 벌이 되고, 한쪽만 고쳐지는 순간 검사가 헐거워진다.
 */
jest.mock('@/lib/factoryAuth', () => ({
  requireFactoryUser: (...args: unknown[]) => mockRequireUser(...args),
  assertFactoryMachineAccess: (...args: unknown[]) => mockAssertMachineAccess(...args),
}));


const mockQuery = {
  select: jest.fn(),
  eq: jest.fn(),
  // 생산실적 수정은 읽은 스냅샷과 대조하는 조건부 UPDATE 를 쓴다. NULL 컬럼은 `.eq` 로
  // 비교할 수 없어 `.is` 로 걸므로, 모킹도 그 체인을 알아야 한다.
  is: jest.fn(),
  in: jest.fn(),
  single: jest.fn(),
  maybeSingle: jest.fn(),
  insert: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
  lt: jest.fn(),
  or: jest.fn(),
  order: jest.fn(),
};

Object.values(mockQuery).forEach(method => method.mockReturnValue(mockQuery));

const mockRpc = jest.fn();
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(() => mockQuery),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

jest.mock('@/lib/plannedRuntime', () => ({
  getBreakTimeMinutes: jest.fn().mockResolvedValue(60),
  resolvePlannedRuntime: (operating: number, breakMinutes: number) =>
    Math.max(0, operating - breakMinutes),
}));

jest.mock('@/lib/machineUpdate', () => ({
  applyMachineUpdate: jest.fn(),
  machineUpdateErrorResponse: jest.fn(() => null),
}));

import * as downtimeCollection from '@/app/api/downtime-entries/route';
import * as downtimeItem from '@/app/api/downtime-entries/[id]/route';
import * as dailyProduction from '@/app/api/production-records/daily/route';
import * as productionItem from '@/app/api/production-records/[recordId]/route';
import * as machineItem from '@/app/api/machines/[machineId]/route';

type MockRequest = {
  headers: Headers;
  url: string;
  json: () => Promise<Record<string, unknown>>;
};

const request = (body: Record<string, unknown> = {}): MockRequest => ({
  headers: new Headers(),
  url: 'http://localhost/api/test',
  json: jest.fn().mockResolvedValue(body),
});

describe('service-role mutation route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAssertMachineAccess.mockReset();
    Object.values(mockQuery).forEach(method => method.mockReturnValue(mockQuery));
    mockQuery.single.mockResolvedValue({ data: null, error: { code: 'PGRST116' } });
    mockRpc.mockResolvedValue({ data: null, error: { message: 'RECORD_NOT_FOUND' } });
    mockRequireUser.mockRejectedValue(new MockApiAuthError('인증이 필요합니다', 401));
  });

  it.each([
    ['downtime POST', () => downtimeCollection.POST(request() as never)],
    ['downtime GET', () => downtimeCollection.GET(request() as never)],
    ['downtime DELETE', () => downtimeItem.DELETE(request() as never, { params: Promise.resolve({ id: '' }) })],
    ['downtime PATCH', () => downtimeItem.PATCH(request() as never, { params: Promise.resolve({ id: '' }) })],
    ['daily production POST', () => dailyProduction.POST(request() as never)],
    ['production PUT', () => productionItem.PUT(request() as never, { params: Promise.resolve({ recordId: 'record-1' }) })],
    ['production DELETE', () => productionItem.DELETE(request() as never, { params: Promise.resolve({ recordId: 'record-1' }) })],
    ['production PATCH', () => productionItem.PATCH(request() as never, { params: Promise.resolve({ recordId: 'record-1' }) })],
    ['machine PUT', () => machineItem.PUT(request() as never, { params: Promise.resolve({ machineId: 'machine-1' }) })],
    ['machine PATCH', () => machineItem.PATCH(request() as never, { params: Promise.resolve({ machineId: 'machine-1' }) })],
  ])('returns 401 before processing %s', async (_name, invoke) => {
    const response = await invoke() as unknown as { status: number };
    expect(response.status).toBe(401);
  });

  it.each([
    ['production DELETE', () => productionItem.DELETE(request() as never, { params: Promise.resolve({ recordId: 'record-1' }) })],
    ['machine PUT', () => machineItem.PUT(request() as never, { params: Promise.resolve({ machineId: 'machine-1' }) })],
  ])('requires a manager role for destructive/configuration operation: %s', async (_name, invoke) => {
    mockRequireUser.mockResolvedValue({
      userId: 'admin-1', role: 'admin', assignedMachineIds: [],
    });

    await invoke();

    // 2026-07-31: 관리자(engineer)도 '설정 제외 모든 페이지 CRUD' 이므로 기록 삭제와
    // 설비 수정을 한다. 사용자(operator)는 읽기/쓰기/수정까지라 여전히 빠진다.
    expect(mockRequireUser).toHaveBeenCalledWith(expect.anything(), ['admin', 'engineer']);
  });

  it('rejects an operator changing an unassigned machine state', async () => {
    mockRequireUser.mockResolvedValue({
      userId: 'operator-1', role: 'operator', assignedMachineIds: ['machine-2'],
    });
    mockAssertMachineAccess.mockImplementation(() => {
      throw new MockApiAuthError('담당 설비에 대한 권한이 없습니다', 403);
    });

    const response = await machineItem.PATCH(
      request({ current_state: 'NORMAL_OPERATION' }) as never,
      { params: Promise.resolve({ machineId: 'machine-1' }) }
    ) as unknown as { status: number };

    expect(response.status).toBe(403);
    expect(mockAssertMachineAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'operator-1' }),
      'machine-1'
    );
  });

  it.each([
    ['downtime POST', () => downtimeCollection.POST(request({
      machine_id: 'machine-1',
      date: '2026-07-14',
      shift: 'A',
      start_time: '2026-07-14T01:00:00.000Z',
      end_time: '2026-07-14T02:00:00.000Z',
      reason: 'failure',
    }) as never)],
    ['daily production POST', () => dailyProduction.POST(request({
      machine_id: 'machine-1',
      date: '2026-07-14',
    }) as never)],
    ['downtime PATCH', () => downtimeItem.PATCH(request({ description: 'update', expected_version: 1 }) as never, {
      params: Promise.resolve({ id: 'downtime-1' }),
    })],
    ['downtime DELETE', () => downtimeItem.DELETE(request({ expected_version: 1 }) as never, {
      params: Promise.resolve({ id: 'downtime-1' }),
    })],
    ['production PUT', () => productionItem.PUT(request({ output_qty: 10 }) as never, {
      params: Promise.resolve({ recordId: 'record-1' }),
    })],
    ['production PATCH', () => productionItem.PATCH(request({ output_qty: 10 }) as never, {
      params: Promise.resolve({ recordId: 'record-1' }),
    })],
  ])('rejects an operator mutating an unassigned machine through %s', async (_name, invoke) => {
    mockRequireUser.mockResolvedValue({
      userId: 'operator-1', role: 'operator', assignedMachineIds: ['machine-2'],
    });
    mockQuery.single.mockResolvedValue({
      data: {
        id: 'downtime-1',
        record_id: 'record-1',
        machine_id: 'machine-1',
        date: '2026-07-14',
        shift: 'A',
        start_time: '2026-07-14T01:00:00.000Z',
        end_time: '2026-07-14T02:00:00.000Z',
        operator_id: 'operator-1',
        version: 1,
        planned_runtime: 660,
        actual_runtime: 600,
        ideal_runtime: 20,
        output_qty: 10,
        defect_qty: 0,
        tact_time_seconds: 120,
        cavity_count: 1,
        downtime_minutes: 60,
      },
      error: null,
    });
    mockAssertMachineAccess.mockImplementation(() => {
      throw new MockApiAuthError('담당 설비에 대한 권한이 없습니다', 403);
    });

    const response = await invoke() as unknown as { status: number };

    expect(response.status).toBe(403);
    expect(mockAssertMachineAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'operator-1' }),
      'machine-1'
    );
  });

  it('uses the authenticated operator ID and lifecycle RPC for direct downtime creation', async () => {
    mockRequireUser.mockResolvedValue({
      userId: 'operator-1', role: 'operator', assignedMachineIds: ['machine-1'],
    });
    mockQuery.single.mockResolvedValue({ data: { id: 'machine-1', name: 'CNC-1', is_active: true }, error: null });
    mockRpc.mockResolvedValue({ data: { id: 'downtime-1', version: 1 }, error: null });

    const response = await downtimeCollection.POST(request({
      machine_id: 'machine-1',
      date: '2026-07-14',
      shift: 'A',
      start_time: '2026-07-14T01:00:00.000Z',
      end_time: '2026-07-14T02:00:00.000Z',
      reason: 'failure',
      operator_id: 'spoofed-user',
    }) as never) as unknown as { status: number };

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('upsert_downtime_entry', expect.objectContaining({
      p_machine_id: 'machine-1',
      p_operator_id: 'operator-1',
    }));
    expect(mockQuery.insert).not.toHaveBeenCalled();
  });

  it('creates an ongoing downtime entry without a production record or end time', async () => {
    mockRequireUser.mockResolvedValue({
      userId: 'operator-1', role: 'operator', assignedMachineIds: ['machine-1'],
    });
    mockQuery.single.mockResolvedValue({ data: { id: 'machine-1', name: 'CNC-1', is_active: true }, error: null });
    mockRpc.mockResolvedValue({ data: { id: 'downtime-open', end_time: null, version: 1 }, error: null });

    const response = await downtimeCollection.POST(request({
      machine_id: 'machine-1',
      date: '2026-07-14',
      shift: 'A',
      start_time: '2026-07-14T01:00:00.000Z',
      end_time: null,
      reason: 'failure',
    }) as never) as unknown as { status: number };

    expect(response.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('upsert_downtime_entry', expect.objectContaining({
      p_end_time: null,
      p_expected_version: null,
    }));
  });

  it('rejects a new downtime event for a deactivated machine', async () => {
    mockRequireUser.mockResolvedValue({
      userId: 'operator-1', role: 'operator', assignedMachineIds: ['machine-1'],
    });
    mockQuery.single.mockResolvedValue({
      data: { id: 'machine-1', name: 'CNC-1', is_active: false },
      error: null,
    });

    const response = await downtimeCollection.POST(request({
      machine_id: 'machine-1',
      date: '2026-07-14',
      shift: 'A',
      start_time: '2026-07-14T01:00:00.000Z',
      reason: 'failure',
    }) as never) as unknown as { status: number };

    expect(response.status).toBe(409);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('lets an operator delete their own assigned-machine downtime with optimistic concurrency', async () => {
    mockRequireUser.mockResolvedValue({
      userId: 'operator-1', role: 'operator', assignedMachineIds: ['machine-1'],
    });
    mockQuery.single.mockResolvedValue({
      data: { id: 'downtime-1', machine_id: 'machine-1', operator_id: 'operator-1', version: 3 },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: 'downtime-1', error: null });

    const response = await downtimeItem.DELETE(
      request({ expected_version: 3 }) as never,
      { params: Promise.resolve({ id: 'downtime-1' }) }
    ) as unknown as { status: number };

    expect(response.status).toBe(200);
    expect(mockRequireUser).toHaveBeenCalledWith(expect.anything(), ['admin', 'engineer', 'operator']);
    expect(mockAssertMachineAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'operator-1' }),
      'machine-1'
    );
    expect(mockRpc).toHaveBeenCalledWith('delete_downtime_entry', {
      p_id: 'downtime-1',
      p_expected_version: 3,
    });
  });

  it('lets the next assigned operator close an ongoing downtime without taking ownership', async () => {
    mockRequireUser.mockResolvedValue({
      userId: 'operator-2', role: 'operator', assignedMachineIds: ['machine-1'],
    });
    mockQuery.single.mockResolvedValue({
      data: {
        id: 'downtime-1', machine_id: 'machine-1', date: '2026-07-14', shift: 'B',
        start_time: '2026-07-14T13:00:00.000Z', end_time: null,
        reason: 'failure', description: null, operator_id: 'operator-1', version: 3,
      },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: { id: 'downtime-1', version: 4 }, error: null });

    const response = await downtimeItem.PATCH(
      request({ end_time: '2026-07-15T01:00:00.000Z', expected_version: 3 }) as never,
      { params: Promise.resolve({ id: 'downtime-1' }) }
    ) as unknown as { status: number };

    expect(response.status).toBe(200);
    expect(mockAssertMachineAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'operator-2' }),
      'machine-1'
    );
    expect(mockRpc).toHaveBeenCalledWith('upsert_downtime_entry', expect.objectContaining({
      p_id: 'downtime-1',
      p_operator_id: 'operator-1',
      p_expected_version: 3,
    }));
  });

  it('does not let the next operator rewrite another operators downtime details', async () => {
    mockRequireUser.mockResolvedValue({
      userId: 'operator-2', role: 'operator', assignedMachineIds: ['machine-1'],
    });
    mockQuery.single.mockResolvedValue({
      data: {
        id: 'downtime-1', machine_id: 'machine-1', date: '2026-07-14', shift: 'B',
        start_time: '2026-07-14T13:00:00.000Z', end_time: null,
        reason: 'failure', description: null, operator_id: 'operator-1', version: 3,
      },
      error: null,
    });

    const response = await downtimeItem.PATCH(
      request({ reason: 'plannedStop', expected_version: 3 }) as never,
      { params: Promise.resolve({ id: 'downtime-1' }) }
    ) as unknown as { status: number };

    expect(response.status).toBe(403);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('keeps unknown runtime and OEE metrics null when only quantities are edited', async () => {
    mockRequireUser.mockResolvedValue({
      userId: 'admin-1', role: 'admin', assignedMachineIds: [],
    });
    mockQuery.single
      .mockResolvedValueOnce({
        data: {
          record_id: 'record-1', machine_id: 'machine-1', date: '2026-07-14', shift: 'A',
          planned_runtime: 660, actual_runtime: null, ideal_runtime: 20,
          output_qty: 10, defect_qty: 0, tact_time_seconds: 120, cavity_count: 1,
          downtime_minutes: null, availability: null, performance: null, quality: 1, oee: null,
        },
        error: null,
      });
    // 조건부 UPDATE 는 `.maybeSingle()` 로 끝난다 — 갱신된 행이 없으면(동시 수정) null 이다.
    mockQuery.maybeSingle.mockResolvedValueOnce({ data: { record_id: 'record-1' }, error: null });

    const response = await productionItem.PUT(
      request({ output_qty: 20, defect_qty: 1 }) as never,
      { params: Promise.resolve({ recordId: 'record-1' }) }
    ) as unknown as { status: number };

    expect(response.status).toBe(200);
    expect(mockQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      output_qty: 20,
      defect_qty: 1,
      planned_runtime: 660,
      actual_runtime: null,
      ideal_runtime: 40,
      downtime_minutes: null,
      availability: null,
      performance: null,
      quality: 0.95,
      oee: null,
    }));
  });

  it('does not invent planned runtime or process metrics for an incomplete legacy row', async () => {
    mockRequireUser.mockResolvedValue({
      userId: 'admin-1', role: 'admin', assignedMachineIds: [],
    });
    mockQuery.single
      .mockResolvedValueOnce({
        data: {
          record_id: 'record-2', machine_id: 'machine-1', date: '2026-07-14', shift: 'A',
          planned_runtime: null, actual_runtime: null, ideal_runtime: null,
          output_qty: 0, defect_qty: 0, tact_time_seconds: null, cavity_count: null,
          downtime_minutes: null, availability: null, performance: null, quality: null, oee: null,
        },
        error: null,
      });
    mockQuery.maybeSingle.mockResolvedValueOnce({ data: { record_id: 'record-2' }, error: null });

    const response = await productionItem.PATCH(
      request({ output_qty: 5, defect_qty: 0 }) as never,
      { params: Promise.resolve({ recordId: 'record-2' }) }
    ) as unknown as { status: number };

    expect(response.status).toBe(200);
    expect(mockQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      planned_runtime: null,
      actual_runtime: null,
      ideal_runtime: null,
      availability: null,
      performance: null,
      quality: 1,
      oee: null,
    }));
  });

  it('does not use a default tact time when neither history nor the current process is known', async () => {
    mockRequireUser.mockResolvedValue({
      userId: 'admin-1', role: 'admin', assignedMachineIds: [],
    });
    mockQuery.single
      .mockResolvedValueOnce({
        data: {
          record_id: 'record-3', machine_id: 'machine-1', date: '2026-07-14', shift: 'A',
          planned_runtime: 660, actual_runtime: null, ideal_runtime: null,
          output_qty: 0, defect_qty: 0, tact_time_seconds: null, cavity_count: null,
          downtime_minutes: null, availability: null, performance: null, quality: null, oee: null,
        },
        error: null,
      });
    // 순서대로 ① 설비 tact 조회(미확인 → null) ② 조건부 UPDATE 결과
    mockQuery.maybeSingle
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { record_id: 'record-3' }, error: null });

    const response = await productionItem.PATCH(
      request({ output_qty: 5, defect_qty: 0, actual_runtime: 100 }) as never,
      { params: Promise.resolve({ recordId: 'record-3' }) }
    ) as unknown as { status: number };

    expect(response.status).toBe(200);
    expect(mockQuery.update).toHaveBeenCalledWith(expect.objectContaining({
      planned_runtime: 660,
      actual_runtime: 100,
      downtime_minutes: 560,
      ideal_runtime: null,
      availability: 0.1515,
      performance: null,
      quality: 1,
      oee: null,
    }));
  });
});
