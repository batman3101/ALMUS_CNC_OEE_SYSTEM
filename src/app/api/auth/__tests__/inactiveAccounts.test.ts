jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    auth: { getUser: jest.fn() },
    from: jest.fn(),
  },
}));

import { createClient } from '@supabase/supabase-js';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { POST as login } from '../login/route';
import { GET as getProfile, PUT as updateProfile } from '../profile/route';

const mockSignInWithPassword = jest.fn();
const mockSignOut = jest.fn();
const mockGetUser = supabaseAdmin.auth.getUser as jest.Mock;
const mockFrom = supabaseAdmin.from as jest.Mock;
const mockSelect = jest.fn();
const mockUpdate = jest.fn();
const mockEq = jest.fn();
const mockSingle = jest.fn();

const profileQuery: Record<string, unknown> & PromiseLike<{ error: null }> = {
  select: mockSelect,
  update: mockUpdate,
  eq: mockEq,
  single: mockSingle,
  then: (resolve, reject) => Promise.resolve({ error: null }).then(resolve, reject),
};

const inactiveProfile = {
  user_id: 'inactive-user',
  name: 'Inactive User',
  role: 'operator',
  assigned_machines: [],
  is_active: false,
};

describe('inactive account authentication boundaries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelect.mockReturnValue(profileQuery);
    mockUpdate.mockReturnValue(profileQuery);
    mockEq.mockReturnValue(profileQuery);
    mockFrom.mockReturnValue(profileQuery);
    (createClient as jest.Mock).mockReturnValue({
      auth: {
        signInWithPassword: mockSignInWithPassword,
        signOut: mockSignOut,
      },
    });
    mockSingle.mockResolvedValue({ data: inactiveProfile, error: null });
    mockSignInWithPassword.mockResolvedValue({
      data: {
        user: { id: 'inactive-user', email: 'inactive@example.com' },
        session: { access_token: 'issued-token' },
      },
      error: null,
    });
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'inactive-user', email: 'inactive@example.com' } },
      error: null,
    });
  });

  it('rejects login after valid credentials resolve to an inactive profile', async () => {
    const response = await login({
      json: async () => ({ email: 'inactive@example.com', password: 'secret' }),
    } as never);

    expect(response.status).toBe(403);
  });

  it('rejects profile reads for an inactive authenticated user', async () => {
    const response = await getProfile({
      headers: new Headers({ Authorization: 'Bearer issued-token' }),
    } as never);

    expect(response.status).toBe(403);
  });

  it('rejects profile updates before mutating an inactive user', async () => {
    const response = await updateProfile({
      headers: new Headers({ Authorization: 'Bearer issued-token' }),
      json: async () => ({ name: 'Changed Name' }),
    } as never);

    expect(response.status).toBe(403);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
