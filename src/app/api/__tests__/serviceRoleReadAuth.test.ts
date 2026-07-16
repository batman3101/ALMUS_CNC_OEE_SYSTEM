const mockRequireUser = jest.fn();
const mockAssertMachineAccess = jest.fn();

class MockApiAuthError extends Error {
  constructor(message: string, readonly status: 401 | 403) {
    super(message);
  }
}

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
  assertMachineAccess: (...args: unknown[]) => mockAssertMachineAccess(...args),
  apiAuthErrorResponse: (error: unknown) => {
    const candidate = error as { message?: string; status?: number };
    return candidate?.status === 401 || candidate?.status === 403
      ? { body: { success: false, error: candidate.message }, status: candidate.status }
      : null;
  },
}));

const mockQuery = {
  select: jest.fn(),
  eq: jest.fn(),
  in: jest.fn(),
  gte: jest.fn(),
  lte: jest.fn(),
  lt: jest.fn(),
  or: jest.fn(),
  neq: jest.fn(),
  order: jest.fn(),
  range: jest.fn(),
};

Object.values(mockQuery).forEach(method => method.mockReturnValue(mockQuery));

const mockRpc = jest.fn();
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(() => mockQuery),
    rpc: (...args: unknown[]) => mockRpc(...args),
  },
}));

jest.mock('@/lib/systemSettings', () => ({
  systemSettingsService: {
    getStructuredSettings: jest.fn(),
    updateMultipleSettings: jest.fn(),
    updateSetting: jest.fn(),
    resetToDefaults: jest.fn(),
  },
}));

import * as downtimeAnalysis from '@/app/api/downtime-analysis/route';
import * as productivityAnalysis from '@/app/api/productivity-analysis/route';
import * as qualityAnalysis from '@/app/api/quality-analysis/route';
import * as oeeData from '@/app/api/oee-data/route';
import * as oeeByMachine from '@/app/api/oee-data/by-machine/route';
import * as profileAdmin from '@/app/api/auth/profile-admin/route';
import * as serviceRoleSettings from '@/app/api/system-settings/service-role/route';
import * as machineStatusDescriptions from '@/app/api/machine-status-descriptions/route';
import * as systemSettings from '@/app/api/system-settings/route';
import * as systemSettingCategory from '@/app/api/system-settings/[category]/route';

const request = (path: string): { headers: Headers; url: string } => ({
  headers: new Headers(),
  url: `http://localhost${path}`,
});

describe('service-role read route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(mockQuery).forEach(method => method.mockReturnValue(mockQuery));
    mockRequireUser.mockRejectedValue(new MockApiAuthError('인증이 필요합니다', 401));
  });

  it.each([
    ['downtime analysis', () => downtimeAnalysis.GET(request('/api/downtime-analysis') as never)],
    ['productivity analysis', () => productivityAnalysis.GET(request('/api/productivity-analysis') as never)],
    ['quality analysis', () => qualityAnalysis.GET(request('/api/quality-analysis') as never)],
    ['raw OEE data', () => oeeData.GET(request('/api/oee-data') as never)],
    ['OEE by machine', () => oeeByMachine.GET(request('/api/oee-data/by-machine') as never)],
    ['profile bootstrap', () => profileAdmin.GET(request('/api/auth/profile-admin?user_id=user-1') as never)],
    ['service-role settings', () => serviceRoleSettings.GET(request('/api/system-settings/service-role') as never)],
    ['machine status descriptions', () => machineStatusDescriptions.GET(request('/api/machine-status-descriptions') as never)],
    ['system settings', () => systemSettings.GET(request('/api/system-settings') as never)],
    ['system setting category', () => systemSettingCategory.GET(
      request('/api/system-settings/shift') as never,
      { params: Promise.resolve({ category: 'shift' }) }
    )],
  ])('returns 401 before querying %s', async (_name, invoke) => {
    const response = await invoke() as unknown as { status: number };

    expect(response.status).toBe(401);
  });

  it.each([
    ['downtime analysis', () => downtimeAnalysis.GET(request('/api/downtime-analysis') as never)],
    ['productivity analysis', () => productivityAnalysis.GET(request('/api/productivity-analysis') as never)],
    ['quality analysis', () => qualityAnalysis.GET(request('/api/quality-analysis') as never)],
    ['OEE by machine', () => oeeByMachine.GET(request('/api/oee-data/by-machine') as never)],
  ])('limits administrator analysis to admin and engineer: %s', async (_name, invoke) => {
    await invoke();

    expect(mockRequireUser).toHaveBeenCalledWith(expect.anything(), ['admin', 'engineer']);
  });

  it('allows raw OEE reads for authenticated roles but checks an operator machine assignment', async () => {
    const operator = {
      userId: 'operator-1',
      role: 'operator',
      assignedMachineIds: ['22222222-2222-4222-8222-222222222222'],
    };
    mockRequireUser.mockResolvedValue(operator);
    mockAssertMachineAccess.mockImplementation(() => {
      throw new MockApiAuthError('담당 설비에 대한 권한이 없습니다', 403);
    });

    const response = await oeeData.GET(request(
      '/api/oee-data?machine_id=11111111-1111-4111-8111-111111111111'
    ) as never) as unknown as { status: number };

    expect(response.status).toBe(403);
    expect(mockRequireUser).toHaveBeenCalledWith(
      expect.anything(),
      ['admin', 'engineer', 'operator']
    );
    expect(mockAssertMachineAccess).toHaveBeenCalledWith(
      operator,
      '11111111-1111-4111-8111-111111111111'
    );
  });

  it('allows profile bootstrap only for the authenticated user', async () => {
    mockRequireUser.mockResolvedValue({
      userId: 'user-1',
      role: 'operator',
      assignedMachineIds: [],
    });

    const response = await profileAdmin.GET(request(
      '/api/auth/profile-admin?user_id=user-2'
    ) as never) as unknown as { status: number };

    expect(response.status).toBe(403);
    expect(mockQuery.select).not.toHaveBeenCalled();
  });

  it.each([
    ['settings PUT', () => systemSettings.PUT(request('/api/system-settings') as never)],
    ['settings POST', () => systemSettings.POST(request('/api/system-settings') as never)],
    ['settings DELETE', () => systemSettings.DELETE(request('/api/system-settings') as never)],
    ['category PUT', () => systemSettingCategory.PUT(
      request('/api/system-settings/shift') as never,
      { params: Promise.resolve({ category: 'shift' }) }
    )],
    ['category DELETE', () => systemSettingCategory.DELETE(
      request('/api/system-settings/shift') as never,
      { params: Promise.resolve({ category: 'shift' }) }
    )],
  ])('protects %s before parsing or writing', async (_name, invoke) => {
    const response = await invoke() as unknown as { status: number };
    expect(response.status).toBe(401);
    expect(mockRequireUser).toHaveBeenCalledWith(expect.anything(), ['admin']);
  });
});
