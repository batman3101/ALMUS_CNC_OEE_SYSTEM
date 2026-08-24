jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock('@/lib/apiAuth', () => ({
  ApiAuthError: class ApiAuthError extends Error {},
}));

/**
 * 이 라우트는 공장 인지 계약으로 전환됐다. 세션은 공장까지 확정해서 돌려준다 —
 * `factoryId` 가 없으면 아래 UPDATE 의 `.eq('factory_id', ...)` 가 undefined 로 걸려
 * 아무 행도 갱신하지 않고, 라우트는 그것을 404 로 읽는다.
 */
jest.mock('@/lib/factoryAuth', () => ({
  requireFactoryUser: jest.fn(async () => ({
    userId: 'admin-1',
    factoryId: 'factory-1',
    factoryCode: 'ALT',
    role: 'admin',
    assignedMachineIds: [],
    isGlobalAdmin: false,
  })),
}));

const update = jest.fn();
const eqCalls: Array<[string, unknown]> = [];

function updateQuery() {
  const query = {
    eq: (column: string, value: unknown) => {
      eqCalls.push([column, value]);
      return query;
    },
    select: () => query,
    maybeSingle: async () => ({ data: { id: 'machine-1' }, error: null }),
  };
  return query;
}

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(() => ({
      update: (values: unknown) => {
        update(values);
        return updateQuery();
      },
    })),
  },
}));

jest.mock('@/lib/machineUpdate', () => ({
  applyMachineUpdate: jest.fn(),
  // 소유 공장 확인은 DB 를 친다. 이 테스트가 보는 것은 "물리 삭제가 아니라 비활성화인가"
  // 이므로 통과시킨다 — 공장 경계 자체는 라우트 원장과 SQL 격리 테스트가 지킨다.
  assertMachineInFactory: jest.fn(async () => undefined),
  machineUpdateErrorResponse: jest.fn(() => null),
  pickMachineUpdates: jest.fn(),
}));

import { DELETE } from '../route';

describe('DELETE /api/admin/machines/[machineId]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    eqCalls.length = 0;
  });

  it('soft-deactivates the machine so historical records remain intact', async () => {
    const response = await DELETE(
      {} as never,
      { params: Promise.resolve({ machineId: 'machine-1' }) }
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }));
    // 공장 조건이 UPDATE 의 WHERE 에 함께 있어야 한다. 사전 조회로 대신하면 조회와 쓰기가
    // 갈라지고, 그 틈이 다른 공장 설비를 끄는 경로가 된다.
    expect(eqCalls).toContainEqual(['factory_id', 'factory-1']);
  });
});
