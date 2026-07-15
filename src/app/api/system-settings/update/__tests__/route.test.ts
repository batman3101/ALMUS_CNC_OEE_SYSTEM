jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockGetUser = jest.fn();
const mockSelect = jest.fn();
const mockSingle = jest.fn();
const mockRpc = jest.fn();

const profileQuery = {
  select: mockSelect,
  eq: jest.fn(),
  single: mockSingle,
};
mockSelect.mockReturnValue(profileQuery);
profileQuery.eq.mockReturnValue(profileQuery);

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(() => ({
    auth: { getUser: mockGetUser },
    from: jest.fn(() => profileQuery),
    rpc: mockRpc,
  })),
}));

import { POST } from '../route';

describe('POST /api/system-settings/update', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
    mockSelect.mockReturnValue(profileQuery);
    profileQuery.eq.mockReturnValue(profileQuery);
    mockGetUser.mockResolvedValue({ data: { user: { id: 'inactive-admin' } }, error: null });
    mockSingle.mockResolvedValue({
      data: { role: 'admin', is_active: false },
      error: null,
    });
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  it('rejects a deactivated administrator before the service-role RPC runs', async () => {
    const response = await POST({
      headers: new Headers({ Authorization: 'Bearer valid-token' }),
      json: async () => ({
        category: 'shift',
        setting_key: 'shift_a_start',
        setting_value: '08:00',
      }),
    } as never);

    expect(response.status).toBe(403);
    expect(mockSelect).toHaveBeenCalledWith('role, is_active');
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
