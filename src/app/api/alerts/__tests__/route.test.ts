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

  /**
   * 알림의 시각은 **사건이 일어난 시각**이어야 한다.
   *
   * 예전에는 여기에 조회 시각(`new Date()`)이 들어갔다. 그래서 사흘 전 고장 난 설비와 방금
   * 고장 난 설비가 관리자 화면에서 같은 1초로 표시됐고(실측 51건 전부 동일), 시간순 정렬도
   * 의미를 잃었다. 사용자가 "로그인 시각으로 알림이 온다"고 보고한 것이 이 증상이다.
   */
  describe('알림 시각은 조회 시각이 아니라 사건 시각이다', () => {
    it('설비 상태 알림은 열려 있는 machine_logs 행의 start_time 을 쓴다', async () => {
      results.machines = {
        data: [{
          id: 'machine-1', name: 'M1', current_state: 'BREAKDOWN_REPAIR',
          // updated_at 은 상태와 무관한 수정에도 갱신되므로 사건 시각의 근거가 될 수 없다.
          updated_at: '2026-07-15T02:59:00.000Z',
        }],
        error: null,
      };
      results.production_records = { data: [], error: null };
      results.machine_logs = {
        data: [{
          machine_id: 'machine-1', state: 'BREAKDOWN_REPAIR',
          start_time: '2026-07-12T01:02:03.000Z', end_time: null, duration: null,
          machines: { name: 'M1' },
        }],
        error: null,
      };

      const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
      const body = await response.json() as {
        alerts: Array<{ alert_type: string; timestamp: string | null }>;
      };

      const maintenance = body.alerts.find(alert => alert.alert_type === 'maintenance');
      expect(maintenance).toBeDefined();
      expect(maintenance!.timestamp).toBe('2026-07-12T01:02:03.000Z');
      // 조회 시각(고정된 시스템 시각)이 새어 들어오지 않았는지 못박는다.
      expect(maintenance!.timestamp).not.toBe('2026-07-15T03:00:00.000Z');
    });

    it('열린 로그가 current_state 와 어긋나면 시각을 지어내지 않고 null 로 둔다', async () => {
      results.machines = {
        data: [{
          id: 'machine-1', name: 'M1', current_state: 'BREAKDOWN_REPAIR',
          updated_at: '2026-07-15T02:59:00.000Z',
        }],
        error: null,
      };
      results.production_records = { data: [], error: null };
      // 열린 로그의 상태가 다르다 = 정합성이 깨진 상태. 시각을 특정할 수 없다.
      results.machine_logs = {
        data: [{
          machine_id: 'machine-1', state: 'INSPECTION',
          start_time: '2026-07-12T01:02:03.000Z', end_time: null, duration: null,
          machines: { name: 'M1' },
        }],
        error: null,
      };

      const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
      const body = await response.json() as {
        alerts: Array<{ alert_type: string; timestamp: string | null }>;
      };

      const maintenance = body.alerts.find(alert => alert.alert_type === 'maintenance');
      expect(maintenance).toBeDefined();
      expect(maintenance!.timestamp).toBeNull();
    });

    it('지표 알림은 그 지표가 담긴 생산실적의 등록 시각을 쓴다', async () => {
      results.machines = {
        data: [{ id: 'machine-1', name: 'M1', current_state: 'NORMAL_OPERATION' }],
        error: null,
      };
      results.production_records = {
        data: [{
          machine_id: 'machine-1', oee: 0.2, availability: 0.4, performance: 0.5,
          quality: 0.9, date: '2026-07-15', shift: 'A',
          created_at: '2026-07-15T00:10:00.000Z', machines: { name: 'M1' },
        }],
        error: null,
      };
      results.machine_logs = { data: [], error: null };

      const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
      const body = await response.json() as {
        alerts: Array<{ alert_type: string; timestamp: string | null }>;
      };

      const metricAlerts = body.alerts.filter(alert =>
        ['oee', 'availability', 'performance', 'quality'].includes(alert.alert_type));
      expect(metricAlerts.length).toBeGreaterThan(0);
      metricAlerts.forEach(alert => {
        expect(alert.timestamp).toBe('2026-07-15T00:10:00.000Z');
      });
    });

    it('서로 다른 시각에 발생한 알림은 서로 다른 시각으로 나온다', async () => {
      results.machines = {
        data: [
          { id: 'machine-1', name: 'M1', current_state: 'BREAKDOWN_REPAIR' },
          { id: 'machine-2', name: 'M2', current_state: 'BREAKDOWN_REPAIR' },
        ],
        error: null,
      };
      results.production_records = { data: [], error: null };
      results.machine_logs = {
        data: [
          {
            machine_id: 'machine-1', state: 'BREAKDOWN_REPAIR',
            start_time: '2026-07-12T01:00:00.000Z', end_time: null, duration: null,
            machines: { name: 'M1' },
          },
          {
            machine_id: 'machine-2', state: 'BREAKDOWN_REPAIR',
            start_time: '2026-07-14T22:00:00.000Z', end_time: null, duration: null,
            machines: { name: 'M2' },
          },
        ],
        error: null,
      };

      const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
      const body = await response.json() as {
        alerts: Array<{ alert_type: string; machine_id: string; timestamp: string | null }>;
      };

      const maintenance = body.alerts.filter(alert => alert.alert_type === 'maintenance');
      expect(maintenance).toHaveLength(2);
      const stamps = new Set(maintenance.map(alert => alert.timestamp));
      // 이 집합의 크기가 1이 되는 것이 사용자가 본 증상이었다.
      expect(stamps.size).toBe(2);
    });
  });

  /**
   * 알림 id 는 **사건의 정체성**이다 — 확인(acknowledge)이 그 id 에 붙는다.
   *
   * 예전에는 `machines.updated_at` 을 썼다. 상태와 무관한 수정만으로도 id 가 바뀌어, 관리자가
   * 이미 확인한 알림이 되살아났다. 사건은 그대로인데 식별자만 흔들린 것이다.
   */
  describe('설비 상태 알림 id 는 사건을 가리킨다', () => {
    const machineRow = (overrides: Record<string, unknown> = {}) => ({
      id: 'machine-1', name: 'M1', current_state: 'BREAKDOWN_REPAIR',
      updated_at: '2026-07-15T02:59:00.000Z', ...overrides,
    });
    const openLog = (startTime: string) => ({
      machine_id: 'machine-1', state: 'BREAKDOWN_REPAIR',
      start_time: startTime, end_time: null, duration: null, machines: { name: 'M1' },
    });

    async function maintenanceAlertId() {
      const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
      const body = await response.json() as { alerts: Array<{ alert_type: string; id: string }> };
      return body.alerts.find(alert => alert.alert_type === 'maintenance')?.id;
    }

    beforeEach(() => {
      results.production_records = { data: [], error: null };
    });

    it('상태 시작 시각을 사건 식별자로 쓴다', async () => {
      results.machines = { data: [machineRow()], error: null };
      results.machine_logs = { data: [openLog('2026-07-12T01:02:03.000Z')], error: null };

      expect(await maintenanceAlertId())
        .toBe('maintenance:machine-1:BREAKDOWN_REPAIR:2026-07-12T01:02:03.000Z');
    });

    it('상태와 무관한 설비 수정으로는 id 가 바뀌지 않는다 — 확인이 유지된다', async () => {
      results.machines = { data: [machineRow()], error: null };
      results.machine_logs = { data: [openLog('2026-07-12T01:02:03.000Z')], error: null };
      const before = await maintenanceAlertId();

      // 생산 모델 변경 등으로 updated_at 만 갱신된 상황. 사건은 그대로다.
      results.machines = {
        data: [machineRow({ updated_at: '2026-07-15T02:59:59.000Z' })],
        error: null,
      };
      const after = await maintenanceAlertId();

      // 이 둘이 달라지는 것이 "확인한 알림이 되살아난다"의 정체였다.
      expect(after).toBe(before);
    });

    it('복구 후 다시 고장 나면 다른 사건이므로 id 가 바뀐다', async () => {
      results.machines = { data: [machineRow()], error: null };
      results.machine_logs = { data: [openLog('2026-07-12T01:02:03.000Z')], error: null };
      const first = await maintenanceAlertId();

      // 복구 후 재고장 = 새 machine_logs 행이 열린다.
      results.machine_logs = { data: [openLog('2026-07-14T22:00:00.000Z')], error: null };
      const second = await maintenanceAlertId();

      expect(second).not.toBe(first);
    });

    it('상태 시작 시각을 모르면 updated_at 으로 내려간다 — 침묵보다 재알림', async () => {
      results.machines = { data: [machineRow()], error: null };
      results.machine_logs = { data: [], error: null };

      // 고정 문자열('unknown')을 쓰면 확인이 (설비, 상태) 에 영원히 눌어붙어 경보가 조용해진다.
      expect(await maintenanceAlertId())
        .toBe('maintenance:machine-1:BREAKDOWN_REPAIR:2026-07-15T02:59:00.000Z');
    });

    it('id 가 updated_at 으로 내려가도 표시 시각은 지어내지 않는다', async () => {
      results.machines = { data: [machineRow()], error: null };
      results.machine_logs = { data: [], error: null };

      const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
      const body = await response.json() as {
        alerts: Array<{ alert_type: string; timestamp: string | null }>;
      };
      const maintenance = body.alerts.find(alert => alert.alert_type === 'maintenance');
      // 식별자로 쓸 수 있다는 것과 사건 시각이라는 것은 다른 주장이다.
      expect(maintenance!.timestamp).toBeNull();
    });
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
