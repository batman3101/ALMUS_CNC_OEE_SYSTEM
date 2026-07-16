import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mockRequireUser = jest.fn();
const mockAssertMachineAccess = jest.fn();
const mockFrom = jest.fn();

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
    return candidate.status === 401 || candidate.status === 403
      ? { body: { success: false, error: candidate.message }, status: candidate.status }
      : null;
  },
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (...args: unknown[]) => mockFrom(...args),
    storage: { from: jest.fn() },
  },
}));

jest.mock('@/lib/supabase', () => ({
  createServerClient: () => ({
    from: (...args: unknown[]) => mockFrom(...args),
  }),
}));

jest.mock('@/lib/machineUpdate', () => ({
  applyMachineUpdate: jest.fn(),
  machineUpdateErrorResponse: jest.fn().mockReturnValue(null),
}));

jest.mock('@/lib/excel/machineTemplate', () => ({
  createMachineTemplate: jest.fn(),
}));

import * as adminMachines from '@/app/api/admin/machines/route';
import * as machineTemplate from '@/app/api/admin/machines/template/route';
import * as userProfiles from '@/app/api/user-profiles/route';
import * as imageUpload from '@/app/api/upload/image/route';
import * as machineItem from '@/app/api/machines/[machineId]/route';
import * as machineProduction from '@/app/api/machines/[machineId]/production/route';
import * as processItem from '@/app/api/model-processes/[id]/route';
import * as modelItem from '@/app/api/product-models/[id]/route';
import * as processCollection from '@/app/api/model-processes/route';
import * as modelCollection from '@/app/api/product-models/route';
import * as productionItem from '@/app/api/production-records/[recordId]/route';

type MockRequest = {
  headers: Headers;
  url: string;
  json: jest.Mock;
  formData: jest.Mock;
};

const makeRequest = (): MockRequest => ({
  headers: new Headers(),
  url: 'http://localhost/api/test',
  json: jest.fn().mockResolvedValue({}),
  formData: jest.fn().mockResolvedValue(new FormData()),
});

const invoke = (
  handler: unknown,
  request: MockRequest,
  context?: { params: Record<string, string> }
) => (handler as (req: MockRequest, ctx?: typeof context) => Promise<unknown>)(request, context);

describe('remaining service-role route guards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockRejectedValue({ message: '인증이 필요합니다', status: 401 });
  });

  it.each([
    ['admin machines', adminMachines.GET, undefined],
    ['machine template', machineTemplate.GET, undefined],
    ['user profiles', userProfiles.GET, undefined],
    ['image upload', imageUpload.POST, undefined],
  ])('%s requires an admin before privileged work', async (_name, handler, context) => {
    const request = makeRequest();

    await expect(invoke(handler, request, context)).resolves.toEqual({
      body: { success: false, error: '인증이 필요합니다' },
      status: 401,
    });
    expect(mockRequireUser).toHaveBeenCalledWith(request, ['admin']);
    expect(request.formData).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it.each([
    ['process collection', processCollection.GET, undefined],
    ['model collection', modelCollection.GET, undefined],
    ['machine detail', machineItem.GET, { params: { machineId: 'machine-1' } }],
    ['machine production', machineProduction.GET, { params: { machineId: 'machine-1' } }],
    ['process detail', processItem.GET, { params: { id: 'process-1' } }],
    ['model detail', modelItem.GET, { params: { id: 'model-1' } }],
    ['production record', productionItem.GET, { params: { recordId: 'record-1' } }],
  ])('%s requires an authenticated app role', async (_name, handler, context) => {
    const request = makeRequest();

    await expect(invoke(handler, request, context)).resolves.toEqual({
      body: { success: false, error: '인증이 필요합니다' },
      status: 401,
    });
    expect(mockRequireUser).toHaveBeenCalledWith(request, ['admin', 'engineer', 'operator']);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it.each([
    ['process creation', processCollection.POST],
    ['model creation', modelCollection.POST],
  ])('%s requires an admin before reading the request body', async (_name, handler) => {
    const request = makeRequest();

    await expect(invoke(handler, request)).resolves.toEqual({
      body: { success: false, error: '인증이 필요합니다' },
      status: 401,
    });
    expect(mockRequireUser).toHaveBeenCalledWith(request, ['admin']);
    expect(request.json).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it.each([
    ['machine detail', machineItem.GET],
    ['machine production', machineProduction.GET],
  ])('%s rejects an operator before querying an unassigned machine', async (_name, handler) => {
    const request = makeRequest();
    const user = { userId: 'operator-1', role: 'operator', assignedMachineIds: [] };
    mockRequireUser.mockResolvedValue(user);
    mockAssertMachineAccess.mockImplementation(() => {
      throw { message: '담당 설비에 대한 권한이 없습니다', status: 403 };
    });

    await expect(
      invoke(handler, request, { params: { machineId: 'machine-1' } })
    ).resolves.toEqual({
      body: { success: false, error: '담당 설비에 대한 권한이 없습니다' },
      status: 403,
    });
    expect(mockAssertMachineAccess).toHaveBeenCalledWith(user, 'machine-1');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('checks the production record machine before returning it to an operator', async () => {
    const request = makeRequest();
    const user = { userId: 'operator-1', role: 'operator', assignedMachineIds: [] };
    mockRequireUser.mockResolvedValue(user);
    mockAssertMachineAccess.mockImplementation(() => {
      throw { message: '담당 설비에 대한 권한이 없습니다', status: 403 };
    });
    mockFrom.mockReturnValue({
      select: jest.fn().mockReturnValue({
        eq: jest.fn().mockReturnValue({
          single: jest.fn().mockResolvedValue({
            data: { record_id: 'record-1', machine_id: 'machine-1' },
            error: null,
          }),
        }),
      }),
    });

    await expect(
      invoke(productionItem.GET, request, { params: { recordId: 'record-1' } })
    ).resolves.toEqual({
      body: { success: false, error: '담당 설비에 대한 권한이 없습니다' },
      status: 403,
    });
    expect(mockAssertMachineAccess).toHaveBeenCalledWith(user, 'machine-1');
  });
});

describe('protected service-role callers', () => {
  const read = (path: string): string => readFileSync(resolve(process.cwd(), path), 'utf8');

  it.each([
    ['src/hooks/useAdminOperations.ts', /authFetch\('\/api\/admin\/machines'\)/],
    ['src/hooks/useMachines.ts', /authFetch\('\/api\/machines'/],
    ['src/hooks/useUserProfiles.ts', /authFetch\('\/api\/user-profiles'/],
    ['src/components/settings/tabs/GeneralSettingsTab.tsx', /authFetch\('\/api\/upload\/image'/],
    ['src/components/machines/MachinesBulkUpload.tsx', /authFetch\('\/api\/admin\/machines\/template'\)/],
    ['src/components/data-input/ShiftDataInputForm.tsx', /authFetch\(`\/api\/product-models\//],
    ['src/components/data-input/ShiftDataInputForm.tsx', /authFetch\(`\/api\/model-processes\//],
    ['src/hooks/useProductModels.ts', /authFetch\('\/api\/product-models'\)/],
    ['src/hooks/useModelProcesses.ts', /authFetch\(`\/api\/model-processes\?model_id=/],
    ['src/components/machines/MachineEditModal.tsx', /authFetch\('\/api\/product-models'\)/],
    ['src/components/machines/MachineEditModal.tsx', /authFetch\(`\/api\/model-processes\?model_id=/],
    ['src/components/dashboard/AdminDashboard.tsx', /authFetch\('\/api\/product-models'/],
  ])('%s attaches the current session', (path, expected) => {
    expect(read(path)).toMatch(expected);
  });
});
