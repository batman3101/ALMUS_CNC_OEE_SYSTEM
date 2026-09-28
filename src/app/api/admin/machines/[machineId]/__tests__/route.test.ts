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

// A direct table write is exactly what this route must no longer do (see the test below).
const directUpdate = jest.fn();
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: jest.fn(() => ({ update: directUpdate })) },
}));

class MachineNotFoundError extends Error {}
const applyMachineUpdate = jest.fn();
const assertMachineInFactory = jest.fn();
jest.mock('@/lib/machineUpdate', () => ({
  applyMachineUpdate: (...args: unknown[]) => applyMachineUpdate(...args),
  assertMachineInFactory: (...args: unknown[]) => assertMachineInFactory(...args),
  machineUpdateErrorResponse: (error: unknown) =>
    error instanceof MachineNotFoundError ? { status: 404, json: async () => ({ success: false, error: 'Machine not found' }) } : null,
  pickMachineUpdates: jest.fn(),
}));

import { DELETE } from '../route';

const call = (machineId = 'machine-1') => DELETE({} as never, { params: Promise.resolve({ machineId }) });

describe('DELETE /api/admin/machines/[machineId]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    assertMachineInFactory.mockResolvedValue(undefined);
    applyMachineUpdate.mockResolvedValue({ machine: { id: 'machine-1', is_active: false } });
  });

  it('soft-deactivates through the locked machine RPC, never a direct table UPDATE (audit follow-up 2026-09-28)', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    // apply_machine_update takes the machine lock (advisory → FOR UPDATE) and runs the deactivation triggers
    // under it; the old direct UPDATE skipped the lock and could race any other machine write.
    expect(applyMachineUpdate).toHaveBeenCalledWith('machine-1', { is_active: false }, expect.any(String), 'admin-1');
    expect(directUpdate).not.toHaveBeenCalled();
  });

  it('checks the machine belongs to this factory before writing, and answers 404 otherwise', async () => {
    assertMachineInFactory.mockRejectedValueOnce(new MachineNotFoundError('Machine not found'));
    const response = await call('other-factory-machine');
    expect(response.status).toBe(404);
    expect(assertMachineInFactory).toHaveBeenCalledWith('other-factory-machine', 'factory-1');
    expect(applyMachineUpdate).not.toHaveBeenCalled();
  });

  it('a machine that disappears between the check and the lock is still 404, not 500', async () => {
    applyMachineUpdate.mockRejectedValueOnce(new MachineNotFoundError('MACHINE_NOT_FOUND'));
    expect((await call()).status).toBe(404);
  });
});
