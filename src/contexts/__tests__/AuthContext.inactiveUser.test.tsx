import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';

jest.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
      signOut: jest.fn(),
      signInWithPassword: jest.fn(),
      onAuthStateChange: jest.fn(() => ({
        data: { subscription: { unsubscribe: jest.fn() } },
      })),
    },
    from: jest.fn(),
  },
}));

jest.mock('@/lib/logger', () => ({
  log: {
    error: jest.fn(),
    warn: jest.fn(),
  },
  LogCategories: { AUTH: 'AUTH' },
}));

import { supabase } from '@/lib/supabase';
import { AuthProvider, useAuth } from '../AuthContext';

const mockGetSession = supabase.auth.getSession as jest.Mock;
const mockSignOut = supabase.auth.signOut as jest.Mock;
const mockFrom = supabase.from as jest.Mock;

function AuthProbe() {
  const { user, loading } = useAuth();
  return <div data-testid="auth-state">{loading ? 'loading' : user?.email ?? 'signed-out'}</div>;
}

describe('AuthContext inactive account handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'issued-token',
          user: { id: 'inactive-user', email: 'inactive@example.com' },
        },
      },
      error: null,
    });
    mockSignOut.mockResolvedValue({ error: null });
    mockFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          single: async () => ({
            data: {
              user_id: 'inactive-user',
              email: 'inactive@example.com',
              name: 'Inactive User',
              role: 'operator',
              assigned_machines: [],
              is_active: false,
            },
            error: null,
          }),
        }),
      }),
    });
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 403,
    }) as jest.Mock;
  });

  it('does not bypass a 403 profile response through the browser Supabase fallback', async () => {
    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>
    );

    await waitFor(() => expect(mockSignOut).toHaveBeenCalled());
    expect(mockFrom).not.toHaveBeenCalled();
    expect(screen.getByTestId('auth-state').textContent).toBe('signed-out');
  });
});
