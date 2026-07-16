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
  requireUser: jest.fn(async () => ({ userId: 'admin-1', role: 'admin' })),
}));

const update = jest.fn();

function updateQuery() {
  const query = {
    eq: () => query,
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
  machineUpdateErrorResponse: jest.fn(() => null),
  pickMachineUpdates: jest.fn(),
}));

import { DELETE } from '../route';

describe('DELETE /api/admin/machines/[machineId]', () => {
  beforeEach(() => jest.clearAllMocks());

  it('soft-deactivates the machine so historical records remain intact', async () => {
    const response = await DELETE(
      {} as never,
      { params: Promise.resolve({ machineId: 'machine-1' }) }
    );

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }));
  });
});
