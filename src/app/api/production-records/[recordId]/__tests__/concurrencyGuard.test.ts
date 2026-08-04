/**
 * 생산실적 수정(PUT/PATCH)의 낙관적 동시성 계약.
 *
 * 이 라우트는 행을 읽고 → Node 에서 파생지표를 전부 재계산하고 → 통째로 덮어쓴다.
 * 같은 행을 고치는 `confirm_shift_defect` / `close_shift_upsert_v2` 는 advisory lock 아래에서
 * 도는데, advisory lock 은 평범한 UPDATE 를 차단하지 않는다. 그래서 이 라우트가 읽은 값이
 * 낡았는지 **스스로** 확인하지 않으면 확정 불량과 OEE 가 조용히 되돌아간다.
 *
 * 아래 테스트는 그 계약을 세 방향에서 고정한다.
 *  1. 그 사이 값이 바뀌었으면 200 이 아니라 409 여야 한다
 *  2. 덮어쓰는 컬럼 **전부**가 대조에 들어가야 한다 (지문을 좁히면 실패)
 *  3. NULL 컬럼은 `.eq` 가 아니라 `.is` 로 걸어야 한다 (SQL 에서 `col = NULL` 은 참이 될 수 없다)
 *
 * 4번은 별건이지만 같은 코드 경로다 — 불량 미검사(NULL)를 0 으로 접지 않는지 본다.
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
const mockAssertMachineAccess = jest.fn();

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  assertMachineAccess: (...args: unknown[]) => mockAssertMachineAccess(...args),
  apiAuthErrorResponse: () => null,
}));

jest.mock('@/lib/plannedRuntime', () => ({
  DEFAULT_OPERATING_MINUTES: 720,
  getBreakTimeMinutes: jest.fn(async () => 60),
  resolvePlannedRuntime: jest.fn((operating: number, breaks: number) =>
    Math.max(0, (Number.isFinite(operating) && operating > 0 ? operating : 720) - breaks)
  ),
}));

interface ExistingRow {
  record_id: string;
  machine_id: string;
  date: string;
  shift: string | null;
  planned_runtime: number | null;
  actual_runtime: number | null;
  ideal_runtime: number | null;
  output_qty: number;
  defect_qty: number | null;
  tact_time_seconds: number | null;
  cavity_count: number | null;
  downtime_minutes: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
}

/** 그 교대가 마감은 됐지만 불량은 아직 확정 전인 행 (defect_qty = NULL). */
const pendingDefectRow: ExistingRow = {
  record_id: 'record-1',
  machine_id: 'machine-1',
  date: '2026-08-01',
  shift: 'A',
  planned_runtime: 660,
  actual_runtime: 600,
  ideal_runtime: 576,
  output_qty: 60,
  defect_qty: null,
  tact_time_seconds: 576,
  cavity_count: 2,
  downtime_minutes: 60,
  availability: 0.9091,
  performance: 0.96,
  quality: null,
  oee: null,
};

/** 불량까지 확정된 행. */
const confirmedRow: ExistingRow = {
  ...pendingDefectRow,
  defect_qty: 3,
  quality: 0.95,
  oee: 0.8291,
};

let existingRow: ExistingRow;
let updateMatchesRow: boolean;
let appliedFilters: Array<{ op: 'eq' | 'is'; column: string; value: unknown }>;
let appliedPayload: Record<string, unknown> | null;

const makeUpdateChain = () => {
  const chain = {
    eq(column: string, value: unknown) {
      appliedFilters.push({ op: 'eq', column, value });
      return chain;
    },
    is(column: string, value: unknown) {
      appliedFilters.push({ op: 'is', column, value });
      return chain;
    },
    select: () => chain,
    // 조건이 하나라도 어긋나면 0행이 갱신된다 → data: null
    maybeSingle: async () => ({
      data: updateMatchesRow ? { ...existingRow, ...appliedPayload } : null,
      error: null,
    }),
  };
  return chain;
};

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: string) => {
      if (table === 'production_records') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: existingRow, error: null }),
            }),
          }),
          update: (payload: Record<string, unknown>) => {
            appliedPayload = payload;
            return makeUpdateChain();
          },
        };
      }
      if (table === 'machines_with_production_info') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: { current_tact_time: 576 }, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));

import { PATCH, PUT } from '../route';

const ctx = { params: Promise.resolve({ recordId: 'record-1' }) };
const req = (body: unknown) => ({ json: async () => body }) as never;

/**
 * 이 라우트가 덮어쓰는 컬럼 전부. 하나라도 대조에서 빠지면 그 컬럼이 그 사이 바뀌어도
 * 갱신이 통과한다 — 좁은 지문은 지문이 아니다.
 */
const REQUIRED_GUARD_COLUMNS = [
  'output_qty',
  'defect_qty',
  'planned_runtime',
  'actual_runtime',
  'ideal_runtime',
  'downtime_minutes',
  'tact_time_seconds',
  'availability',
  'performance',
  'quality',
  'oee',
];

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireUser.mockResolvedValue({
    userId: 'operator-1',
    role: 'operator',
    assignedMachineIds: ['machine-1'],
  });
  existingRow = confirmedRow;
  updateMatchesRow = true;
  appliedFilters = [];
  appliedPayload = null;
});

describe('생산실적 수정의 낙관적 동시성', () => {
  it('읽은 뒤 행이 바뀌었으면 200 이 아니라 409 를 돌려준다', async () => {
    // 불량확정 RPC 가 먼저 들어와 defect_qty 를 바꾼 상황 = 조건 불일치 = 0행 갱신
    updateMatchesRow = false;

    const response = await PATCH(req({ output_qty: 80 }), ctx);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ error: 'record_changed' });
  });

  it('덮어쓰는 컬럼 전부를 대조 조건에 건다', async () => {
    await PATCH(req({ output_qty: 80 }), ctx);

    const guarded = appliedFilters.filter(f => f.column !== 'record_id').map(f => f.column);
    for (const column of REQUIRED_GUARD_COLUMNS) {
      expect(guarded).toContain(column);
    }
  });

  it('대상 행은 record_id 로 특정한다', async () => {
    await PATCH(req({ output_qty: 80 }), ctx);

    expect(appliedFilters).toContainEqual({ op: 'eq', column: 'record_id', value: 'record-1' });
  });

  it('스냅샷이 NULL 인 컬럼은 eq 가 아니라 is 로 건다', async () => {
    // `col = NULL` 은 SQL 에서 참이 될 수 없다. eq 로 걸면 이 행은 영원히 갱신되지 않는다.
    existingRow = pendingDefectRow;

    await PATCH(req({ output_qty: 80 }), ctx);

    expect(appliedFilters).toContainEqual({ op: 'is', column: 'defect_qty', value: null });
    expect(appliedFilters).not.toContainEqual({ op: 'eq', column: 'defect_qty', value: null });
  });

  it('PUT 도 PATCH 와 같은 규율을 따른다', async () => {
    updateMatchesRow = false;

    const response = await PUT(req({ output_qty: 80 }), ctx);

    expect(response.status).toBe(409);
  });

  it('경쟁이 없으면 정상적으로 저장된다', async () => {
    const response = await PATCH(req({ output_qty: 80 }), ctx);

    expect(response.status).toBe(200);
    expect(appliedPayload).toMatchObject({ output_qty: 80 });
  });
});

describe('불량 미검사(NULL)를 0 으로 접지 않는다', () => {
  it('불량대기 행의 생산량만 수정해도 400 이 아니다', async () => {
    // 예전에는 defect_qty=null 을 "정수 아님"으로 보고 400 을 냈다.
    // 즉 가장 손대야 할 행이 오히려 수정 불가였다.
    existingRow = pendingDefectRow;

    const response = await PATCH(req({ output_qty: 80 }), ctx);

    expect(response.status).toBe(200);
  });

  it('불량이 미검사면 품질과 OEE 를 NULL 로 남긴다', async () => {
    existingRow = pendingDefectRow;

    await PATCH(req({ output_qty: 80 }), ctx);

    expect(appliedPayload).toMatchObject({ defect_qty: null, quality: null, oee: null });
  });

  it('불량이 확정된 행에서는 품질을 정상적으로 파생한다', async () => {
    existingRow = confirmedRow;

    await PATCH(req({ output_qty: 100 }), ctx);

    // (100 - 3) / 100
    expect(appliedPayload).toMatchObject({ quality: 0.97 });
  });
});
