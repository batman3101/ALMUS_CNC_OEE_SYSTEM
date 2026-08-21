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

  /**
   * 페이징 관심사는 `machines` 에서 `machine_logs` 로 옮겨왔다.
   *
   * 설비 상태 알림이 `NotificationContext` 로 넘어가면서 이 라우트는 `machines` 를 더 이상
   * 읽지 않는다(그쪽 페이징은 `GET /api/machines` 가 책임진다). 여기서 Supabase 행 상한에
   * 걸릴 수 있는 쿼리는 이제 다운타임 로그다.
   */
  it('continues past the first downtime-log page so the last long downtime is not hidden', async () => {
    results.production_records = { data: [], error: null };
    results.machine_logs = {
      data: [
        ...Array.from({ length: 1000 }, (_, index) => ({
          machine_id: `machine-${index}`,
          state: 'BREAKDOWN_REPAIR',
          start_time: '2026-07-15T02:00:00.000Z',
          end_time: '2026-07-15T02:01:00.000Z',
          duration: 1, // 임계값 미만 — 알림이 생기지 않는다
          machines: { name: `M${index}` },
        })),
        {
          machine_id: 'machine-last',
          state: 'BREAKDOWN_REPAIR',
          start_time: '2026-07-14T02:00:00.000Z',
          end_time: null,
          duration: 600, // critical(60분) 초과
          machines: { name: 'Last machine' },
        },
      ],
      error: null,
    };

    const response = await GET({ url: 'http://localhost/api/alerts?limit=5000' } as never);
    const body = await response.json() as {
      alerts: Array<{ machine_id: string; alert_type: string }>;
    };

    expect(body.alerts).toEqual(expect.arrayContaining([
      expect.objectContaining({ machine_id: 'machine-last', alert_type: 'downtime' }),
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
    it('지표 알림은 그 지표가 담긴 생산실적의 등록 시각을 쓴다', async () => {
      results.machines = { data: [], error: null };
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
        // 조회 시각(고정된 시스템 시각)이 새어 들어오지 않았는지 못박는다.
        expect(alert.timestamp).not.toBe('2026-07-15T03:00:00.000Z');
      });
    });

    it('다운타임 알림은 로그의 시작 시각을 쓰고, 사건마다 시각이 다르다', async () => {
      results.machines = { data: [], error: null };
      results.production_records = { data: [], error: null };
      results.machine_logs = {
        data: [
          {
            machine_id: 'machine-1', state: 'BREAKDOWN_REPAIR',
            start_time: '2026-07-12T01:00:00.000Z', end_time: null, duration: 600,
            machines: { name: 'M1' },
          },
          {
            machine_id: 'machine-2', state: 'BREAKDOWN_REPAIR',
            start_time: '2026-07-14T22:00:00.000Z', end_time: null, duration: 300,
            machines: { name: 'M2' },
          },
        ],
        error: null,
      };

      const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
      const body = await response.json() as {
        alerts: Array<{ alert_type: string; timestamp: string | null }>;
      };

      const downtime = body.alerts.filter(alert => alert.alert_type === 'downtime');
      expect(downtime).toHaveLength(2);
      // 이 집합의 크기가 1이 되는 것이 사용자가 본 증상이었다.
      expect(new Set(downtime.map(alert => alert.timestamp)).size).toBe(2);
    });
  });

  /**
   * 설비 상태 알림은 이 라우트가 만들지 않는다.
   *
   * `current_state !== 'NORMAL_OPERATION'` 이라는 똑같은 술어를 `NotificationContext` 가
   * 이미 평가한다. 둘 다 만들면 관리자 화면에 같은 고장이 두 번(다운타임까지 세 번) 나열된다 —
   * 실측으로 설비 17대에 알림 51건이었다.
   */
  describe('설비 상태 알림을 중복 생성하지 않는다', () => {
    it('비정상 상태 설비만으로는 알림을 만들지 않는다', async () => {
      results.machines = {
        data: [{
          id: 'machine-1', name: 'M1', current_state: 'BREAKDOWN_REPAIR',
          updated_at: '2026-07-15T02:59:00.000Z',
        }],
        error: null,
      };
      results.production_records = { data: [], error: null };
      results.machine_logs = { data: [], error: null };

      const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
      const body = await response.json() as { alerts: Array<{ alert_type: string }> };

      expect(body.alerts).toHaveLength(0);
    });

    it('설비 한 대의 한 사건에 알림이 하나만 나온다', async () => {
      results.machines = {
        data: [{
          id: 'machine-1', name: 'M1', current_state: 'BREAKDOWN_REPAIR',
          updated_at: '2026-07-15T02:59:00.000Z',
        }],
        error: null,
      };
      results.production_records = { data: [], error: null };
      results.machine_logs = {
        data: [{
          machine_id: 'machine-1', state: 'BREAKDOWN_REPAIR',
          start_time: '2026-07-12T01:00:00.000Z', end_time: null, duration: 600,
          machines: { name: 'M1' },
        }],
        error: null,
      };

      const response = await GET({ url: 'http://localhost/api/alerts?limit=50' } as never);
      const body = await response.json() as {
        alerts: Array<{ machine_id: string; alert_type: string }>;
      };

      // 예전에는 여기서 downtime + maintenance 두 건이 나왔다.
      expect(body.alerts).toHaveLength(1);
      expect(body.alerts[0].alert_type).toBe('downtime');
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
