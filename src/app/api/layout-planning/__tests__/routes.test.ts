import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }) } }));
const mockAuth = jest.fn();
jest.mock('@/lib/factoryAuth', () => ({ requireFactoryUser: (...args: unknown[]) => mockAuth(...args) }));
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: {} }));
const mockCreate = jest.fn();
const mockConfirm = jest.fn();
const mockSave = jest.fn();
const mockLoad = jest.fn();
jest.mock('@/lib/layout-planning/server', () => {
  const actual = jest.requireActual('@/lib/layout-planning/server');
  return { ...actual, createPlan: (...a: unknown[]) => mockCreate(...a), confirmPlan: (...a: unknown[]) => mockConfirm(...a), savePlanDraft: (...a: unknown[]) => mockSave(...a), loadPlan: (...a: unknown[]) => mockLoad(...a) };
});
import { ApiAuthError } from '@/lib/apiAuth';
import { LayoutPlanningError } from '@/lib/layout-planning/server';
import { POST as createPlanRoute } from '../plans/route';
import { POST as confirmRoute } from '../plans/[planId]/confirm/route';
import { PATCH as patchRoute } from '../plans/[planId]/route';

const PLAN = '11111111-1111-4111-8111-111111111111';
const MACHINE = '22222222-2222-4222-8222-222222222222';
const req = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const params = { params: Promise.resolve({ planId: PLAN }) };
const validPlan = {
  title: 'W39', forecastFileName: 'f.xlsx', forecastFileHash: 'abc', week: { key: '2026-W39', start: '2026-09-21', end: '2026-09-27' },
  demands: [{ model: 'ON 1', peakQuantity: 100, peakDate: '2026-09-22', warnings: ['partial_week', 'bogus'] }],
};

describe('layout-planning routes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ userId: 'u1', factoryId: 'f1', factoryCode: 'ALT', role: 'engineer' });
  });

  it('create: admin and engineer only, factory from the session, unknown warnings dropped', async () => {
    mockCreate.mockResolvedValue({ planId: PLAN, unresolved: [], unmapped: [] });
    const r = await createPlanRoute(req(validPlan));
    expect(r.status).toBe(201);
    expect(mockAuth).toHaveBeenCalledWith(expect.anything(), ['admin', 'engineer']);
    expect(mockCreate).toHaveBeenCalledWith('f1', 'u1', expect.objectContaining({
      demands: [expect.objectContaining({ model: 'ON 1', peakQuantity: 100, warnings: ['partial_week'] })], acknowledgeUnmapped: false, lockedMachineIds: [],
    }));
  });

  it.each([
    ['negative demand', { ...validPlan, demands: [{ model: 'A', peakQuantity: -1 }] }, 'invalid_demand'],
    ['fractional demand', { ...validPlan, demands: [{ model: 'A', peakQuantity: 1.5 }] }, 'invalid_demand'],
    ['reversed week', { ...validPlan, week: { key: 'w', start: '2026-09-27', end: '2026-09-21' } }, 'invalid_week'],
    ['bad lock id', { ...validPlan, lockedMachineIds: ['nope'] }, 'invalid_locks'],
  ])('create: rejects %s with 400 before touching the database', async (_label, body, code) => {
    const r = await createPlanRoute(req(body));
    expect(r.status).toBe(400);
    expect((await r.json()).code).toBe(code);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('create: unmapped models come back as 422 with the list, so the screen can ask the user', async () => {
    mockCreate.mockRejectedValue(new LayoutPlanningError(422, 'unmapped_models', { models: ['Hubble Y2'] }));
    const r = await createPlanRoute(req(validPlan));
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ code: 'unmapped_models', detail: { models: ['Hubble Y2'] } });
  });

  it('create: an operator is refused before any work', async () => {
    mockAuth.mockRejectedValue(new ApiAuthError('Forbidden', 403));
    expect((await createPlanRoute(req(validPlan))).status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('confirm: requires a revision and maps a stale base to 409 with the machine', async () => {
    expect((await confirmRoute(req({}), params)).status).toBe(400);
    mockConfirm.mockRejectedValue(new LayoutPlanningError(409, 'layout_base_stale', { machineId: MACHINE }));
    const r = await confirmRoute(req({ expectedRevision: 3 }), params);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ code: 'layout_base_stale', detail: { machineId: MACHINE } });
    expect(mockConfirm).toHaveBeenCalledWith('f1', 'u1', PLAN, 3);
  });

  it('fine-tune: validates ids, passes nulls through as "no model", and returns the recomputed plan', async () => {
    mockSave.mockResolvedValue({ plan_id: PLAN, revision: 5 });
    mockLoad.mockResolvedValue({ plan: { id: PLAN }, summary: { groups: [] } });
    const bad = await patchRoute(req({ expectedRevision: 4, changes: [{ machineId: 'x' }] }), params);
    expect(bad.status).toBe(400);
    const ok = await patchRoute(req({ expectedRevision: 4, changes: [{ machineId: MACHINE, finalModelId: null, finalProcessId: null, isLocked: true }] }), params);
    expect(ok.status).toBe(200);
    expect(mockSave).toHaveBeenCalledWith('f1', 'u1', PLAN, 4, [{ machineId: MACHINE, finalModelId: null, finalProcessId: null, isLocked: true }]);
    expect(await ok.json()).toMatchObject({ revision: 5, summary: { groups: [] } });
  });

  it('rejects a malformed plan id in the path', async () => {
    expect((await confirmRoute(req({ expectedRevision: 1 }), { params: Promise.resolve({ planId: 'not-a-uuid' }) })).status).toBe(400);
  });
});
