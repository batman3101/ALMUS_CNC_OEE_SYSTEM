import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, json: async () => body }) } }));
const mockAuth = jest.fn();
const mockCreatePlan = jest.fn();
jest.mock('@/lib/factoryAuth', () => ({ requireFactoryUser: (...args: unknown[]) => mockAuth(...args) }));
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: {} }));
jest.mock('@/lib/layout-planning/server', () => ({
  createPlan: (...args: unknown[]) => mockCreatePlan(...args),
  routeErrorResponse: (error: unknown) => ({ status: 500, json: async () => ({ success: false, error: String(error) }) }),
}));
import { POST } from '../route';

const request = (body: unknown): NextRequest => ({ headers: { get: () => null }, json: async () => body }) as unknown as NextRequest;
const demand = (warnings: unknown) => ({ model: 'ON 1', week: 'W41', peakQuantity: 2600, peakDate: '2026-10-05', warnings });
const body = (warnings: unknown) => ({
  title: 'W41 계획', forecastFileName: 'W40.xlsx', forecastFileHash: 'hash',
  week: { key: 'W41', start: '2026-10-05', end: '2026-10-11' }, demands: [demand(warnings)],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ factoryId: 'factory-1', userId: 'user-1', role: 'engineer' });
  mockCreatePlan.mockResolvedValue({ planId: 'plan-1' });
});

describe('POST /api/layout-planning/plans - 수요 경고', () => {
  // 실제 PO 수정값(2026-09-29): 시뮬레이션이 PO 를 읽었다는 표시가 계획 기록에 남아야 한다.
  it('po_override 경고는 계획 입력에 그대로 넘기고, 목록에 없는 경고는 버린다', async () => {
    const response = await POST(request(body(['po_override', 'partial_week', 'not-a-warning', 42])));
    expect(response.status).toBe(201);
    const [factoryId, userId, input] = mockCreatePlan.mock.calls[0];
    expect([factoryId, userId]).toEqual(['factory-1', 'user-1']);
    expect(input.demands[0].warnings).toEqual(['po_override', 'partial_week']);
  });

  it('경고가 배열이 아니면 경고 없음으로 본다', async () => {
    await POST(request(body('po_override')));
    expect(mockCreatePlan.mock.calls[0][2].demands[0].warnings).toEqual([]);
  });
});
