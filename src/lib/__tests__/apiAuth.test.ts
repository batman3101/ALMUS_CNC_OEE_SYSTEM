jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      body,
      status: init?.status ?? 200,
    }),
  },
}));

import type { NextRequest } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  ApiAuthError,
  assertMachineAccess,
  requireUser,
  type AuthenticatedUser,
} from '../apiAuth';

const getUserMock = supabaseAdmin.auth.getUser as jest.Mock;
const fromMock = supabaseAdmin.from as jest.Mock;

function requestWithToken(): NextRequest {
  return {
    headers: new Headers({ Authorization: 'Bearer valid-token' }),
  } as NextRequest;
}

function mockProfile(profile: Record<string, unknown> | null, error: unknown = null) {
  const query = {
    select: jest.fn(),
    eq: jest.fn(),
    single: jest.fn().mockResolvedValue({ data: profile, error }),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  fromMock.mockReturnValue(query);
  return query;
}

describe('service-role API authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  });

  it('returns the active profile and assigned machine scope for an operator', async () => {
    const query = mockProfile({
      role: 'operator',
      assigned_machines: ['machine-1', 'machine-2'],
      is_active: true,
    });

    await expect(requireUser(requestWithToken(), ['operator'])).resolves.toEqual({
      userId: 'user-1',
      role: 'operator',
      assignedMachineIds: ['machine-1', 'machine-2'],
    });
    expect(query.select).toHaveBeenCalledWith('role, assigned_machines, is_active');
  });

  it('rejects a deactivated account even when its token is valid', async () => {
    mockProfile({ role: 'operator', assigned_machines: ['machine-1'], is_active: false });

    await expect(requireUser(requestWithToken())).rejects.toMatchObject({
      status: 403,
    });
  });

  it('rejects an unknown role instead of trusting a type assertion', async () => {
    mockProfile({ role: 'superuser', assigned_machines: [], is_active: true });

    await expect(requireUser(requestWithToken())).rejects.toBeInstanceOf(ApiAuthError);
  });

  it('allows operators to mutate only assigned machines', () => {
    const operator: AuthenticatedUser = {
      userId: 'operator-1',
      role: 'operator',
      assignedMachineIds: ['machine-1'],
    };

    expect(() => assertMachineAccess(operator, 'machine-1')).not.toThrow();
    expect(() => assertMachineAccess(operator, 'machine-2')).toThrow(ApiAuthError);
  });

  it('allows engineers and admins to mutate any machine', () => {
    expect(() => assertMachineAccess({
      userId: 'engineer-1',
      role: 'engineer',
      assignedMachineIds: [],
    }, 'machine-2')).not.toThrow();
    expect(() => assertMachineAccess({
      userId: 'admin-1',
      role: 'admin',
      assignedMachineIds: [],
    }, 'machine-2')).not.toThrow();
  });
});
