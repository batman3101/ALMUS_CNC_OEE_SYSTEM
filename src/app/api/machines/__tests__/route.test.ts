jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const update = jest.fn();
const mockRequireUser = jest.fn();

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...args: unknown[]) => mockRequireUser(...args),
  apiAuthErrorResponse: (error: unknown) =>
    error instanceof Error && error.message === 'unauthorized'
      ? { status: 401, json: async () => ({ error: 'unauthorized' }) }
      : null,
}));

function awaitable(result: unknown) {
  const query: Record<string, unknown> & PromiseLike<unknown> = {
    select: () => query,
    in: () => query,
    limit: () => query,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return query;
}

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn((table: string) => {
      if (table === 'production_records') {
        return awaitable({ data: [{ machine_id: 'machine-1' }], error: null });
      }
      if (table === 'machines') {
        return {
          update: (values: unknown) => {
            update(values);
            return awaitable({ data: [{ id: 'machine-1', name: 'M1' }], error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    }),
  },
}));

import { DELETE } from '../route';

describe('DELETE /api/machines', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'admin-1', role: 'admin' });
  });

  it('rejects unauthenticated bulk deactivation', async () => {
    mockRequireUser.mockRejectedValueOnce(new Error('unauthorized'));
    const response = await DELETE({ json: async () => ({ machineIds: ['machine-1'] }) } as never);

    expect(response.status).toBe(401);
    expect(update).not.toHaveBeenCalled();
  });

  it('deactivates a retired machine while preserving its production history', async () => {
    const response = await DELETE({
      json: async () => ({ machineIds: ['machine-1'] }),
    } as never);

    expect(response.status).toBe(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ is_active: false }));
  });
});
