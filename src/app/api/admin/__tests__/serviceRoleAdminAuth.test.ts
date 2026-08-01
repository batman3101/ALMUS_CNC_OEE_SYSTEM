const mockRequireUser = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));

jest.mock('@/lib/apiAuth', () => {
  // 사용자 관리 라우트는 `requireUserManager` 를 거치지만, 그건 결국 `requireUser` 에
  // 역할 목록을 넘기는 얇은 위임이다. 같은 위임 관계를 mock 에서도 유지해야 "인가가
  // 먼저 실행된다"는 이 파일의 주장이 실제 구조를 검사한 것이 된다.
  const { USER_MANAGEMENT_ROLES } = jest.requireActual('@/lib/pageAccess');
  return {
    requireUser: (...args: unknown[]) => mockRequireUser(...args),
    requireUserManager: (request: unknown) => mockRequireUser(request, [...USER_MANAGEMENT_ROLES]),
    // 인가 통과 이후에만 쓰이는 것들 — 이 파일은 거부 경로만 본다.
    assertCanManageAccount: jest.fn(),
    assertCanAssignRole: jest.fn(),
    fetchAccountRole: jest.fn(),
    parseUserRole: (value: unknown) => value,
    apiAuthErrorResponse: (error: unknown) => {
      const candidate = error as { message?: string; status?: number };
      return candidate.status === 401 || candidate.status === 403
        ? { body: { success: false, error: candidate.message }, status: candidate.status }
        : null;
    },
  };
});

const mockFrom = jest.fn();
const mockListUsers = jest.fn();
const mockCreateUser = jest.fn();
const mockUpdateUserById = jest.fn();
const mockDeleteUser = jest.fn();

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
    auth: {
      admin: {
        listUsers: (...args: unknown[]) => mockListUsers(...args),
        createUser: (...args: unknown[]) => mockCreateUser(...args),
        updateUserById: (...args: unknown[]) => mockUpdateUserById(...args),
        deleteUser: (...args: unknown[]) => mockDeleteUser(...args),
      },
    },
  },
}));

jest.mock('@/lib/excel/machineTemplate', () => ({
  parseMachineExcel: jest.fn(),
  convertToMachineData: jest.fn(),
  validateMachineData: jest.fn(),
}));

import * as usersCollection from '@/app/api/admin/users/route';
import * as userItem from '@/app/api/admin/users/[userId]/route';
import * as setupRealUser from '@/app/api/admin/setup-real-user/route';
import * as machineBulkUpload from '@/app/api/admin/machines/bulk-upload/route';
import { USER_MANAGEMENT_ROLES } from '@/lib/pageAccess';

type MockRequest = {
  headers: Headers;
  url: string;
  json: jest.Mock;
  formData: jest.Mock;
};

const makeRequest = (): MockRequest => ({
  headers: new Headers(),
  url: 'http://localhost/api/admin/test',
  json: jest.fn().mockResolvedValue({}),
  formData: jest.fn().mockResolvedValue(new FormData()),
});

const invokeWithRequest = (
  handler: unknown,
  request: MockRequest,
  context?: { params: { userId: string } }
) => (handler as (req: MockRequest, ctx?: typeof context) => Promise<unknown>)(request, context);

describe('admin service-role route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockRejectedValue({ message: '인증이 필요합니다', status: 401 });
  });

  // 기대 역할을 라우트마다 함께 적는다. 예전에는 전부 `['admin']` 이었지만 2026-07-31
  // 3등급 체계에서 사용자 관리와 설비 일괄 등록이 관리자에게도 열렸다. 역할이 조용히
  // 넓어지는 것을 이 열이 잡는다.
  const MANAGERS = ['admin', 'engineer'];
  const ADMIN_ONLY = ['admin'];

  it.each([
    ['users GET', usersCollection.GET, undefined, [...USER_MANAGEMENT_ROLES]],
    ['users POST', usersCollection.POST, undefined, [...USER_MANAGEMENT_ROLES]],
    ['users DELETE', usersCollection.DELETE, undefined, [...USER_MANAGEMENT_ROLES]],
    ['user PUT', userItem.PUT, { params: { userId: 'user-1' } }, [...USER_MANAGEMENT_ROLES]],
    ['user DELETE', userItem.DELETE, { params: { userId: 'user-1' } }, [...USER_MANAGEMENT_ROLES]],
    // 최초 시스템 관리자 계정 생성은 등급을 만들어내는 부트스트랩이라 admin 전용이다.
    ['setup-real-user GET', setupRealUser.GET, undefined, ADMIN_ONLY],
    ['setup-real-user POST', setupRealUser.POST, undefined, ADMIN_ONLY],
    ['machine bulk-upload POST', machineBulkUpload.POST, undefined, MANAGERS],
  ])('%s returns 401 before parsing or using the service role', async (_name, handler, context, roles) => {
    const request = makeRequest();

    const response = await invokeWithRequest(handler, request, context) as {
      status: number;
      body: unknown;
    };

    expect(response).toEqual({
      status: 401,
      body: { success: false, error: '인증이 필요합니다' },
    });
    expect(mockRequireUser).toHaveBeenCalledWith(request, roles);
    expect(request.json).not.toHaveBeenCalled();
    expect(request.formData).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
    expect(mockListUsers).not.toHaveBeenCalled();
    expect(mockCreateUser).not.toHaveBeenCalled();
    expect(mockUpdateUserById).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
  });

  it('preserves the authorization helper 403 response for a non-admin', async () => {
    mockRequireUser.mockRejectedValue({ message: '권한이 없습니다', status: 403 });
    const request = makeRequest();

    const response = await invokeWithRequest(usersCollection.GET, request) as {
      status: number;
      body: unknown;
    };

    expect(response).toEqual({
      status: 403,
      body: { success: false, error: '권한이 없습니다' },
    });
  });
});
