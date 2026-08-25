/**
 * 사용자 삭제·수정의 실패 계약.
 *
 * 이 라우트는 한 트랜잭션 안에 있지 않다(Auth 는 Supabase Auth, 프로필과 참조는 Postgres).
 * 원자성을 만들 수 없으면 **실패했을 때 무엇이 남는지**를 정해야 한다. 그 선택이 이 파일이
 * 고정하는 계약이다.
 *
 *  - Auth 를 먼저 지운다 → 뒤가 실패하면 "고아 프로필"(목록에 보이고 다시 지울 수 있다)
 *  - Auth 를 나중에 지우면 → "로그인은 되는데 프로필이 없는 계정"(목록에 없어 되살릴 수 없다)
 *
 * 그리고 프로필을 참조하는 외래키는 **전부** 비워야 한다. `downtime_entries` 를 빠뜨렸던
 * 예전 코드는, 비가동을 기록한 사용자(운영 DB 기준 13명 중 6명)를 지울 때 FK 위반으로 반드시
 * 실패하면서 `machine_logs` 귀속만 되돌릴 수 없게 지웠다.
 */

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockRequireFactoryUser = jest.fn();

jest.mock('@/lib/apiAuth', () => ({
  fetchAccountRole: jest.fn(async () => 'operator'),
  assertCanManageAccount: jest.fn(),
  assertCanAssignRole: jest.fn(),
  apiAuthErrorResponse: () => null,
}));

jest.mock('@/lib/factoryAuth', () => ({
  requireFactoryUser: (...args: unknown[]) => mockRequireFactoryUser(...args),
}));

// 공장 가드는 여기서 통과시키고, **가드가 실제로 불리는지**는 아래 전용 검사가 본다.
// 통째로 무력화한 채 두면 가드를 지워도 이 파일이 통과한다.
const mockAssertTargetInFactory = jest.fn();
const mockAssertSoleFactory = jest.fn();

jest.mock('@/lib/factoryUserAdmin', () => {
  class FactoryUserNotFoundError extends Error {}
  class CrossFactoryUserError extends Error {}
  return {
    FactoryUserNotFoundError,
    CrossFactoryUserError,
    assertTargetInFactory: (...args: unknown[]) => mockAssertTargetInFactory(...args),
    assertSoleFactory: (...args: unknown[]) => mockAssertSoleFactory(...args),
    factoryUserErrorResponse: (error: unknown) => {
      if (error instanceof FactoryUserNotFoundError) {
        return { status: 404, json: async () => ({ error: error.message }) };
      }
      if (error instanceof CrossFactoryUserError) {
        return { status: 409, json: async () => ({ error: error.message }) };
      }
      return null;
    },
  };
});

interface TableWrite {
  table: string;
  payload: Record<string, unknown>;
  filterValue: unknown;
}

let tableWrites: TableWrite[];
let deletedFrom: string[];
let authDeleteError: { status?: number; code?: string; message: string } | null;
let authUpdateError: { status?: number; code?: string; message: string } | null;
let updateErrorForTable: string | null;
let profileDeleteError: { message: string } | null;
let profileUpdateError: { message: string } | null;

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    auth: {
      admin: {
        deleteUser: async () => ({ error: authDeleteError }),
        updateUserById: async () => ({ error: authUpdateError }),
      },
    },
    from: (table: string) => ({
      update: (payload: Record<string, unknown>) => ({
        eq: async (_column: string, filterValue: unknown) => {
          tableWrites.push({ table, payload, filterValue });
          if (table === 'user_profiles') return { error: profileUpdateError };
          return { error: updateErrorForTable === table ? { message: 'fk boom' } : null };
        },
      }),
      delete: () => ({
        eq: async () => {
          deletedFrom.push(table);
          return { error: profileDeleteError };
        },
      }),
    }),
  },
}));

import { DELETE, PUT } from '../route';

const ctx = { params: Promise.resolve({ userId: 'user-1' }) };
const req = (body: unknown = {}) => ({ json: async () => body }) as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockRequireFactoryUser.mockResolvedValue({
    userId: 'admin-1',
    factoryId: 'factory-alt',
    factoryCode: 'ALT',
    role: 'admin',
    assignedMachineIds: [],
    isGlobalAdmin: false,
  });
  mockAssertTargetInFactory.mockResolvedValue(undefined);
  mockAssertSoleFactory.mockResolvedValue(undefined);
  tableWrites = [];
  deletedFrom = [];
  authDeleteError = null;
  authUpdateError = null;
  updateErrorForTable = null;
  profileDeleteError = null;
  profileUpdateError = null;
});

describe('DELETE /api/admin/users/[userId]', () => {
  it('프로필을 참조하는 외래키를 전부 비운다', async () => {
    await DELETE(req(), ctx);

    const cleared = tableWrites
      .filter(w => w.payload.operator_id === null)
      .map(w => w.table);

    // 하나라도 빠지면 그 사용자는 FK 위반으로 삭제가 실패한다.
    expect(cleared).toContain('machine_logs');
    expect(cleared).toContain('downtime_entries');
  });

  it('로그인 계정을 먼저 지운다 — 실패하면 아무것도 바꾸지 않는다', async () => {
    authDeleteError = { status: 500, message: 'auth down' };

    const response = await DELETE(req(), ctx);

    expect(response.status).toBe(502);
    // 되돌릴 것이 없는 실패여야 한다.
    expect(tableWrites).toEqual([]);
    expect(deletedFrom).toEqual([]);
  });

  it('참조 정리가 실패하면 프로필을 지우지 않는다', async () => {
    updateErrorForTable = 'downtime_entries';

    const response = await DELETE(req(), ctx);

    expect(response.status).toBe(500);
    expect(deletedFrom).not.toContain('user_profiles');
  });

  it('프로필 삭제 실패를 성공으로 보고하지 않는다', async () => {
    profileDeleteError = { message: 'nope' };

    const response = await DELETE(req(), ctx);

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.not.toMatchObject({ success: true });
  });

  it('Auth 계정이 없는 가상 사용자도 프로필 정리는 끝까지 한다', async () => {
    authDeleteError = { status: 404, code: 'user_not_found', message: 'not found' };

    const response = await DELETE(req(), ctx);

    expect(response.status).toBe(200);
    expect(deletedFrom).toContain('user_profiles');
  });

  it('정상 경로는 성공을 돌려준다', async () => {
    const response = await DELETE(req(), ctx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true });
  });
});

describe('PUT /api/admin/users/[userId]', () => {
  const editBody = {
    email: 'new@example.com',
    currentEmail: 'old@example.com',
    name: '홍길동',
    role: 'operator',
    assigned_machines: [],
  };

  it('로그인 이메일 변경 실패를 성공으로 보고하지 않는다', async () => {
    authUpdateError = { status: 500, message: 'auth down' };

    const response = await PUT(req(editBody), ctx);

    expect(response.status).toBe(502);
  });

  it('이메일 변경이 실패하면 프로필도 쓰지 않는다', async () => {
    authUpdateError = { status: 500, message: 'auth down' };

    await PUT(req(editBody), ctx);

    expect(tableWrites.filter(w => w.table === 'user_profiles')).toEqual([]);
  });

  it('이메일이 그대로면 Auth 를 건드리지 않고 프로필만 저장한다', async () => {
    const response = await PUT(
      req({ ...editBody, email: 'old@example.com' }),
      ctx
    );

    expect(response.status).toBe(200);
    expect(tableWrites.map(w => w.table)).toEqual(['user_profiles']);
  });

  it('프로필 저장 실패를 성공으로 보고하지 않는다', async () => {
    profileUpdateError = { message: 'nope' };

    const response = await PUT(req(editBody), ctx);

    expect(response.status).toBe(500);
  });
});

/**
 * 공장 가드가 **실제로 불리는지**.
 *
 * 위 검사들은 가드를 통과시켜 놓고 돌기 때문에, 가드를 라우트에서 지워도 전부 통과한다.
 * 그래서 가드가 거부할 때 그 거부가 응답까지 도달하는지를 따로 본다 — 호출 여부와
 * 오류 매핑을 한 번에 확인한다.
 *
 * 이 검사가 없던 동안 ALV 관리자가 ALT 사용자의 이름·역할·담당 설비를 바꾸고 계정을
 * 지울 수 있었다. Service Role 로 도는 경로라 RLS 는 이것을 막지 못한다.
 */
describe('다른 공장 사용자는 손댈 수 없다', () => {
  const { FactoryUserNotFoundError, CrossFactoryUserError } =
    jest.requireMock('@/lib/factoryUserAdmin');

  it('PUT 은 이 공장 사람이 아니면 404 이고 아무것도 쓰지 않는다', async () => {
    mockAssertTargetInFactory.mockRejectedValue(
      new FactoryUserNotFoundError('사용자를 찾을 수 없습니다')
    );

    const response = await PUT(req({ name: '이름', role: 'operator' }), ctx);

    expect(response.status).toBe(404);
    expect(tableWrites).toEqual([]);
  });

  it('DELETE 는 이 공장 사람이 아니면 404 이고 계정을 지우지 않는다', async () => {
    mockAssertTargetInFactory.mockRejectedValue(
      new FactoryUserNotFoundError('사용자를 찾을 수 없습니다')
    );

    const response = await DELETE(req(), ctx);

    expect(response.status).toBe(404);
    expect(deletedFrom).toEqual([]);
  });

  it('DELETE 는 여러 공장에 걸친 사용자를 거부한다(409)', async () => {
    // 계정 삭제는 auth.users 까지 지운다. 한 공장의 결정으로 다른 공장에서 사람이
    // 사라지면, 그쪽 관리자는 이유를 알 방법이 없다.
    mockAssertSoleFactory.mockRejectedValue(
      new CrossFactoryUserError('다른 공장에도 소속되어 있습니다')
    );

    const response = await DELETE(req(), ctx);

    expect(response.status).toBe(409);
    expect(deletedFrom).toEqual([]);
  });
});
