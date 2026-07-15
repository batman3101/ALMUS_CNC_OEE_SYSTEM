jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const insertSingle = jest.fn();
const insertSelect = jest.fn(() => ({ single: insertSingle }));
const insert = jest.fn(() => ({ select: insertSelect }));
const mockRequireUser = jest.fn();
const mockAssertMachineAccess = jest.fn();
let productionInfo: { current_tact_time: number; current_cavity_count: number } | null;
let machineActive: boolean;

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  assertMachineAccess: (...args: unknown[]) => mockAssertMachineAccess(...args),
  apiAuthErrorResponse: (error: unknown) =>
    error instanceof Error && error.message === 'unauthorized'
      ? { status: 401, json: async () => ({ error: 'unauthorized' }) }
      : null,
}));

jest.mock('@/lib/plannedRuntime', () => ({
  getBreakTimeMinutes: jest.fn(async () => 60),
  resolvePlannedRuntime: jest.fn((operating: number, breaks: number) =>
    Math.max(0, (Number.isFinite(operating) && operating > 0 ? operating : 720) - breaks)
  ),
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn((table: string) => {
      if (table === 'machines') {
        return {
          select: () => ({
            eq: () => ({ single: async () => ({ data: { id: 'machine-1', is_active: machineActive }, error: null }) }),
          }),
        };
      }
      if (table === 'machines_with_production_info') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: productionInfo,
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === 'production_records') return { insert };
      throw new Error(`unexpected table ${table}`);
    }),
  },
}));

import { POST } from '../route';

describe('POST /api/production-records', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      userId: 'operator-1', role: 'operator', assignedMachineIds: ['machine-1'],
    });
    productionInfo = { current_tact_time: 120, current_cavity_count: 1 };
    machineActive = true;
    insertSingle.mockResolvedValue({ data: { record_id: 'record-1' }, error: null });
  });

  it('rejects unauthenticated production mutations before writing data', async () => {
    mockRequireUser.mockRejectedValueOnce(new Error('unauthorized'));

    const response = await POST({ json: async () => ({}) } as never);

    expect(response.status).toBe(401);
    expect(insert).not.toHaveBeenCalled();
  });

  it('stores an incomplete OEE record when actual runtime is not reported', async () => {
    const response = await POST({
      json: async () => ({
        machine_id: 'machine-1',
        date: '2026-07-15',
        shift: 'A',
        output_qty: 100,
        defect_qty: 0,
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(mockAssertMachineAccess).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'operator-1' }),
      'machine-1'
    );
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      actual_runtime: null,
      downtime_minutes: null,
      availability: null,
      performance: null,
      oee: null,
    }));
  });

  it('does not invent performance or OEE when the machine has no process standard', async () => {
    productionInfo = null;

    const response = await POST({
      json: async () => ({
        machine_id: 'machine-1',
        date: '2026-07-15',
        shift: 'A',
        output_qty: 100,
        defect_qty: 0,
        actual_runtime: 600,
        planned_runtime: 720,
      }),
    } as never);

    expect(response.status).toBe(200);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      ideal_runtime: null,
      tact_time_seconds: null,
      cavity_count: null,
      performance: null,
      oee: null,
    }));
  });

  it('rejects new production records for a deactivated machine', async () => {
    machineActive = false;

    const response = await POST({
      json: async () => ({
        machine_id: 'machine-1',
        date: '2026-07-15',
        shift: 'A',
        output_qty: 1,
        defect_qty: 0,
      }),
    } as never);

    expect(response.status).toBe(409);
    expect(insert).not.toHaveBeenCalled();
  });
});
