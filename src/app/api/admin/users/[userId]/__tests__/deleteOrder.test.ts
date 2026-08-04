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

const mockRequireUserManager = jest.fn();

jest.mock('@/lib/apiAuth', () => ({
  requireUserManager: (...args: unknown[]) => mockRequireUserManager(...args),
  fetchAccountRole: jest.fn(async () => 'operator'),
  assertCanManageAccount: jest.fn(),
  assertCanAssignRole: jest.fn(),
  apiAuthErrorResponse: () => null,
}));

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
  mockRequireUserManager.mockResolvedValue({
    userId: 'admin-1',
    role: 'admin',
    assignedMachineIds: [],
  });
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
