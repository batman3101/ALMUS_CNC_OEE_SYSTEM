jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

type QueryResult = { data: unknown[]; error: null };

const results: Record<string, QueryResult> = {
  machines: { data: [], error: null },
  production_records: { data: [], error: null },
  machine_logs: { data: [], error: null },
  downtime_entries: { data: [], error: null },
  alert_acknowledgements: { data: [], error: null },
};
const mockRequireUser = jest.fn();
const mockUpsert = jest.fn();
const queryCalls: Array<{ table: string; method: string; args: unknown[] }> = [];

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  apiAuthErrorResponse: (error: unknown) =>
    error instanceof Error && error.message === 'unauthorized'
      ? { status: 401, json: async () => ({ error: 'unauthorized' }) }
      : null,
}));

function queryFor(table: string) {
  let rangeStart = 0;
  let rangeEnd: number | null = null;
  const equalityFilters: Array<[string, unknown]> = [];
  const query: Record<string, unknown> & PromiseLike<QueryResult> = {
    select: () => query,
    eq: (...args: unknown[]) => {
      queryCalls.push({ table, method: 'eq', args });
      equalityFilters.push([String(args[0]), args[1]]);
      return query;
    },
    in: () => query,
    gte: (...args: unknown[]) => {
      queryCalls.push({ table, method: 'gte', args });
      return query;
    },
    neq: () => query,
    or: () => query,
    order: () => query,
    limit: () => query,
    upsert: (values: unknown) => {
      mockUpsert(table, values);
      return query;
    },
    range: (from: number, to: number) => {
      rangeStart = from;
      rangeEnd = to;
      return query;
    },
    then: (resolve, reject) => {
      const configured = results[table] ?? { data: [], error: null };
      const filteredData = configured.data.filter(row =>
        equalityFilters.every(([field, expected]) => {
          if (!row || typeof row !== 'object' || !(field in row)) return true;
          return (row as Record<string, unknown>)[field] === expected;
        })
      );
      const result = rangeEnd === null
        ? { ...configured, data: filteredData.slice(0, 1000) }
        : { ...configured, data: filteredData.slice(rangeStart, rangeEnd + 1) };
      return Promise.resolve(result).then(resolve, reject);
    },
  };
  return query;
}

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn((table: string) => queryFor(table)),
  },
}));

import { GET, POST } from '../route';

describe('GET /api/alerts', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers().setSystemTime(new Date('2026-07-15T03:00:00.000Z'));
    queryCalls.length = 0;
    mockRequireUser.mockResolvedValue({ userId: 'admin-1', role: 'admin' });
    results.machines = {
      data: [{ id: 'machine-1', name: 'M1', current_state: 'NORMAL_OPERATION' }],
      error: null,
    };
    results.production_records = {
      data: [
        {
          machine_id: 'machine-1', oee: 0.8, availability: 0.9, performance: 0.9,
          quality: 0.99, date: '2026-07-15', shift: 'B', machines: { name: 'M1' },
        },
        {
          machine_id: 'machine-1', oee: 0.2, availability: 0.4, performance: 0.5,
          quality: 0.9, date: '2026-07-15', shift: 'A', machines: { name: 'M1' },
        },
      ],
      error: null,
    };
    results.machine_logs = { data: [], error: null };
    results.downtime_entries = { data: [], error: null };
    results.alert_acknowledgements = { data: [], error: null };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('uses only the current A shift and ignores a pre-entered future B shift', async () => {
    const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
    const body = await response.json() as {
      alerts: Array<{ alert_type: string; current_value: number }>;
    };

    expect(queryCalls).toContainEqual({
      table: 'production_records',
      method: 'eq',
      args: ['shift', 'A'],
    });
    expect(body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ alert_type: 'oee', current_value: 20 }),
    ]));
  });

  it('queries exactly the current business date and never includes future production dates', async () => {
    const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
    const body = await response.json() as {
      metadata: { analysis_window: { performance_business_date: string } };
    };

    expect(queryCalls).toContainEqual({
      table: 'production_records',
      method: 'eq',
      args: ['date', body.metadata.analysis_window.performance_business_date],
    });
    expect(queryCalls).not.toContainEqual(expect.objectContaining({
      table: 'production_records',
      method: 'gte',
      args: ['date', expect.any(String)],
    }));
  });

  it('returns a stable domain key instead of a request-order alert number', async () => {
    results.production_records.data[0] = {
      ...(results.production_records.data[0] as object),
      oee: 0.2,
    };

    const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
    const body = await response.json() as {
      alerts: Array<{ id: string; machine_id: string; alert_type: string }>;
    };
    const alert = body.alerts.find(item => item.alert_type === 'oee');

    expect(alert?.id).toMatch(/^oee:machine-1:/);
  });

  it('calculates elapsed time for an ongoing downtime instead of treating NULL duration as zero', async () => {
    const now = Date.now();
    results.production_records = { data: [], error: null };
    results.machine_logs = {
      data: [{
        machine_id: 'machine-1',
        state: 'BREAKDOWN_REPAIR',
        start_time: new Date(now - 125 * 60_000).toISOString(),
        end_time: null,
        duration: null,
        machines: { name: 'M1' },
      }],
      error: null,
    };

    const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
    const body = await response.json() as {
      alerts: Array<{ alert_type: string; severity: string; current_value: number }>;
    };
    const downtime = body.alerts.find(alert => alert.alert_type === 'downtime');

    expect(downtime).toEqual(expect.objectContaining({
      severity: 'critical',
      current_value: expect.any(Number),
    }));
    expect(downtime?.current_value).toBeGreaterThanOrEqual(120);
  });

  it('does not turn incomplete nullable OEE metrics into false critical alerts', async () => {
    results.production_records = {
      data: [{
        machine_id: 'machine-1',
        oee: null,
        availability: null,
        performance: null,
        quality: null,
        date: '2026-07-15',
        shift: 'A',
        machines: { name: 'M1' },
      }],
      error: null,
    };

    const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
    const body = await response.json() as { alerts: Array<{ alert_type: string }> };

    expect(body.alerts.filter(alert =>
      ['oee', 'availability', 'performance', 'quality'].includes(alert.alert_type)
    )).toHaveLength(0);
  });

  it('creates the previously missing performance alert when performance is actually reported', async () => {
    results.production_records = {
      data: [{
        machine_id: 'machine-1',
        oee: 0.8,
        availability: 0.9,
        performance: 0.5,
        quality: 0.99,
        date: '2026-07-15',
        shift: 'A',
        machines: { name: 'M1' },
      }],
      error: null,
    };

    const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
    const body = await response.json() as { alerts: Array<{ alert_type: string }> };

    expect(body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ alert_type: 'performance' }),
    ]));
  });

  it('alerts on an independent ongoing downtime entry even when no machine log exists', async () => {
    results.production_records = { data: [], error: null };
    results.machine_logs = { data: [], error: null };
    results.downtime_entries = {
      data: [{
        id: 'downtime-1',
        machine_id: 'machine-1',
        reason: 'equipmentFailure',
        start_time: new Date(Date.now() - 130 * 60_000).toISOString(),
        end_time: null,
        duration_minutes: null,
        machines: { name: 'M1' },
      }],
      error: null,
    };

    const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
    const body = await response.json() as {
      alerts: Array<{ id: string; alert_type: string; severity: string }>;
    };

    expect(body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'downtime:machine-1:downtime-1:critical',
        alert_type: 'downtime',
        severity: 'critical',
      }),
    ]));
  });

  it('continues past the first Supabase page so every active machine can be evaluated', async () => {
    const normalRows = Array.from({ length: 1000 }, (_, index) => ({
      machine_id: `machine-${index}`,
      oee: 0.8,
      availability: 0.9,
      performance: 0.9,
      quality: 0.99,
      date: '2026-07-15',
      shift: 'A',
      machines: { name: `M${index}` },
    }));
    results.production_records = {
      data: [...normalRows, {
        machine_id: 'machine-last',
        oee: 0.2,
        availability: 0.4,
        performance: 0.5,
        quality: 0.99,
        date: '2026-07-15',
        shift: 'A',
        machines: { name: 'Last machine' },
      }],
      error: null,
    };

    const response = await GET({ url: 'http://localhost/api/alerts?limit=5000' } as never);
    const body = await response.json() as {
      alerts: Array<{ machine_id: string; alert_type: string }>;
    };

    expect(body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ machine_id: 'machine-last', alert_type: 'oee' }),
    ]));
  });

  it('continues past the first machine page so the last abnormal machine is not hidden', async () => {
    results.production_records = { data: [], error: null };
    results.machines = {
      data: [
        ...Array.from({ length: 1000 }, (_, index) => ({
          id: `machine-${index}`,
          name: `M${index}`,
          current_state: 'NORMAL_OPERATION',
          updated_at: '2026-07-15T00:00:00.000Z',
        })),
        {
          id: 'machine-last',
          name: 'Last machine',
          current_state: 'BREAKDOWN_REPAIR',
          updated_at: '2026-07-15T01:00:00.000Z',
        },
      ],
      error: null,
    };

    const response = await GET({ url: 'http://localhost/api/alerts?limit=5000' } as never);
    const body = await response.json() as {
      alerts: Array<{ machine_id: string; alert_type: string }>;
    };

    expect(body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ machine_id: 'machine-last', alert_type: 'maintenance' }),
    ]));
  });

  it('continues past the first acknowledgement page so old alert decisions remain effective', async () => {
    results.production_records.data[0] = {
      ...(results.production_records.data[0] as object),
      oee: 0.2,
    };
    results.alert_acknowledgements = {
      data: [
        ...Array.from({ length: 1000 }, (_, index) => ({
          alert_key: `old-alert-${index}`,
          action: 'acknowledge',
        })),
        {
          alert_key: 'oee:machine-1:2026-07-15:A:critical',
          action: 'dismiss',
        },
      ],
      error: null,
    };

    const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
    const body = await response.json() as {
      alerts: Array<{ id: string; acknowledged: boolean; is_active: boolean }>;
    };

    expect(body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'oee:machine-1:2026-07-15:A:critical',
        acknowledged: true,
        is_active: false,
      }),
    ]));
  });

  it('does not carry a warning acknowledgement into a later critical generation', async () => {
    results.production_records.data[0] = {
      ...(results.production_records.data[0] as object),
      oee: 0.2,
    };
    results.alert_acknowledgements = {
      data: [{
        alert_key: 'oee:machine-1:2026-07-15:A:warning',
        action: 'acknowledge',
      }],
      error: null,
    };

    const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
    const body = await response.json() as {
      alerts: Array<{ id: string; acknowledged: boolean }>;
    };

    expect(body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'oee:machine-1:2026-07-15:A:critical',
        acknowledged: false,
      }),
    ]));
  });

  it('keeps acknowledgement for one source event but not a later same-severity event', async () => {
    results.production_records = {
      data: [{
        machine_id: 'machine-1', record_id: 'record-new', oee: 0.2, availability: 0.9,
        performance: 0.9, quality: 0.99, date: '2026-07-15', shift: 'A',
        created_at: '2026-07-15T12:00:00.000Z', machines: { name: 'M1' },
      }],
      error: null,
    };
    results.alert_acknowledgements = {
      data: [{
        alert_key: 'oee:machine-1:record-old:critical',
        action: 'acknowledge',
      }],
      error: null,
    };

    const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
    const body = await response.json() as {
      alerts: Array<{ id: string; alert_type: string; acknowledged: boolean }>;
    };

    expect(body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'oee:machine-1:record-new:critical',
        alert_type: 'oee',
        acknowledged: false,
      }),
    ]));
  });

  it('persists acknowledgement for the authenticated administrator', async () => {
    const response = await POST({
      json: async () => ({ alert_id: 'downtime:machine-1:event-1', action: 'acknowledge' }),
    } as never);

    expect(response.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      'alert_acknowledgements',
      expect.objectContaining({
        alert_key: 'downtime:machine-1:event-1',
        user_id: 'admin-1',
        action: 'acknowledge',
      })
    );
  });

  it('rejects unauthenticated acknowledgement requests', async () => {
    mockRequireUser.mockRejectedValueOnce(new Error('unauthorized'));
    const response = await POST({ json: async () => ({}) } as never);

    expect(response.status).toBe(401);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
