const mockRequireUser = jest.fn();

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  apiAuthErrorResponse: (error: unknown) => {
    const candidate = error as { message?: string; status?: number };
    return candidate.status === 401 || candidate.status === 403
      ? { body: { success: false, error: candidate.message }, status: candidate.status }
      : null;
  },
}));

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

  it.each([
    ['users GET', usersCollection.GET, undefined],
    ['users POST', usersCollection.POST, undefined],
    ['users DELETE', usersCollection.DELETE, undefined],
    ['user PUT', userItem.PUT, { params: { userId: 'user-1' } }],
    ['user DELETE', userItem.DELETE, { params: { userId: 'user-1' } }],
    ['setup-real-user GET', setupRealUser.GET, undefined],
    ['setup-real-user POST', setupRealUser.POST, undefined],
    ['machine bulk-upload POST', machineBulkUpload.POST, undefined],
  ])('%s returns 401 before parsing or using the service role', async (_name, handler, context) => {
    const request = makeRequest();

    const response = await invokeWithRequest(handler, request, context) as {
      status: number;
      body: unknown;
    };

    expect(response).toEqual({
      status: 401,
      body: { success: false, error: '인증이 필요합니다' },
    });
    expect(mockRequireUser).toHaveBeenCalledWith(request, ['admin']);
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
