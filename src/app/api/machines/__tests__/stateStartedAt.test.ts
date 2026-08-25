/**
 * `GET /api/machines` 는 현재 상태가 **언제 시작됐는지**를 함께 돌려준다.
 *
 * 이 값이 없으면 알림 화면은 사건 시각을 알 수 없고, 예전에는 그 자리를 `new Date()` 로
 * 메웠다. 그 결과 사흘 전 고장과 방금 난 고장이 같은 1초로 표시됐다(실측 51건 전부 동일).
 */

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockRequireUser = jest.fn();

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  apiAuthErrorResponse: () => null,
}));

// GET 은 공장 인지 계약으로 전환됐다. 이 테스트는 state_started_at 파생을 보는 것이므로
// 인가는 통과시키고 공장만 고정한다.
jest.mock('@/lib/factoryAuth', () => ({
  requireFactoryUser: (...args: unknown[]) => mockRequireUser(...args),
}));

type Row = Record<string, unknown>;
const tables: { machines: Row[]; machine_logs: Row[] } = { machines: [], machine_logs: [] };
let machineLogsError: { message: string } | null = null;

function queryFor(table: 'machines' | 'machine_logs') {
  let start = 0;
  let end: number | null = null;
  const query: Record<string, unknown> & PromiseLike<unknown> = {
    select: () => query,
    eq: () => query,
    is: () => query,
    in: () => query,
    order: () => query,
    range: (from: number, to: number) => { start = from; end = to; return query; },
    then: (resolve, reject) => {
      if (table === 'machine_logs' && machineLogsError) {
        return Promise.resolve({ data: null, error: machineLogsError }).then(resolve, reject);
      }
      const rows = tables[table];
      const page = end === null ? rows.slice(0, 1000) : rows.slice(start, end + 1);
      return Promise.resolve({ data: page, error: null }).then(resolve, reject);
    },
  };
  return query;
}

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn((table: string) => queryFor(table as 'machines' | 'machine_logs')),
  },
}));

import { GET } from '../route';

async function fetchMachines() {
  const response = await GET({ url: 'http://localhost/api/machines' } as never);
  const body = await response.json() as {
    machines: Array<{ id: string; state_started_at: string | null }>;
  };
  return body.machines;
}

describe('GET /api/machines — state_started_at', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    machineLogsError = null;
    mockRequireUser.mockResolvedValue({ userId: 'admin-1', role: 'admin', assignedMachineIds: [], factoryId: 'factory-1', factoryCode: 'ALT', isGlobalAdmin: false });
    tables.machines = [
      { id: 'machine-1', name: 'M1', current_state: 'BREAKDOWN_REPAIR', updated_at: '2026-08-20T14:14:00.000Z' },
      { id: 'machine-2', name: 'M2', current_state: 'NORMAL_OPERATION', updated_at: '2026-08-20T14:14:00.000Z' },
    ];
    tables.machine_logs = [
      { machine_id: 'machine-1', state: 'BREAKDOWN_REPAIR', start_time: '2026-08-19T19:51:19.000Z' },
      { machine_id: 'machine-2', state: 'NORMAL_OPERATION', start_time: '2026-08-01T00:00:00.000Z' },
    ];
  });

  it('열려 있는 machine_logs 행의 start_time 을 싣는다', async () => {
    const machines = await fetchMachines();
    expect(machines.find(m => m.id === 'machine-1')?.state_started_at)
      .toBe('2026-08-19T19:51:19.000Z');
  });

  it('updated_at 을 상태 시작 시각으로 대신 쓰지 않는다', async () => {
    // 실측(CNC-618): updated_at 은 상태와 무관한 수정에도 갱신되어 17시간 어긋났다.
    const machines = await fetchMachines();
    expect(machines.find(m => m.id === 'machine-1')?.state_started_at)
      .not.toBe('2026-08-20T14:14:00.000Z');
  });

  it('열린 로그가 current_state 와 어긋나면 null 이다', async () => {
    tables.machine_logs = [
      { machine_id: 'machine-1', state: 'INSPECTION', start_time: '2026-08-19T19:51:19.000Z' },
    ];
    const machines = await fetchMachines();
    expect(machines.find(m => m.id === 'machine-1')?.state_started_at).toBeNull();
  });

  it('열린 로그가 없으면 null 이다 — 현재 시각으로 메우지 않는다', async () => {
    tables.machine_logs = [];
    const machines = await fetchMachines();
    expect(machines.every(m => m.state_started_at === null)).toBe(true);
  });

  it('로그 조회가 실패해도 설비 목록은 돌려주고 시각만 미상으로 둔다', async () => {
    machineLogsError = { message: 'boom' };
    const machines = await fetchMachines();
    expect(machines).toHaveLength(2);
    expect(machines.every(m => m.state_started_at === null)).toBe(true);
  });
});
