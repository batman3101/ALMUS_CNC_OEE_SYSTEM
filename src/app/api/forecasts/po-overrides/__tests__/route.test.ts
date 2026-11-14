import type { NextRequest } from 'next/server';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: { status?: number; headers?: unknown }) => ({ status: init?.status ?? 200, headers: init?.headers, json: async () => body }) } }));
const mockAuth = jest.fn();
const mockApply = jest.fn();
const mockRevert = jest.fn();
jest.mock('@/lib/factoryAuth', () => ({ requireFactoryUser: (...args: unknown[]) => mockAuth(...args) }));
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: {} }));
jest.mock('@/lib/forecast/poOverrideStore', () => {
  class PoOverrideError extends Error { constructor(readonly status: number, readonly code: string) { super(code); } }
  return { PoOverrideError, applyPoOverride: (...a: unknown[]) => mockApply(...a), revertPoOverride: (...a: unknown[]) => mockRevert(...a) };
});
import { ApiAuthError } from '@/lib/apiAuth';
import { PoOverrideError } from '@/lib/forecast/poOverrideStore';
import { DELETE, PUT } from '../route';

const SUBMISSION = '11111111-1111-4111-8111-111111111111';
const good = { submissionId: SUBMISSION, sourceRow: 15, date: '2026-10-05', quantity: 4200 };
const request = (body: unknown, raw = false): NextRequest =>
  ({ headers: { get: () => null }, json: async () => { if (raw) throw new SyntaxError('bad json'); return body; } }) as unknown as NextRequest;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ factoryId: 'factory-1', factoryCode: 'ALT', userId: 'user-1', role: 'engineer' });
  mockApply.mockResolvedValue({ quantity: 4200, updatedAt: '2026-09-29T03:00:00Z', unchanged: false });
  mockRevert.mockResolvedValue({ reverted: true });
});

describe('PUT /api/forecasts/po-overrides', () => {
  it('인증된 공장·사용자로 적용하고 화면이 상태를 갱신할 값을 돌려준다', async () => {
    const req = request(good);
    const response = await PUT(req);
    expect(response.status).toBe(200);
    expect(mockAuth).toHaveBeenCalledWith(req, ['admin', 'engineer']);
    expect(mockApply).toHaveBeenCalledWith({ id: 'factory-1' }, 'user-1', { submissionId: SUBMISSION, sourceRow: 15, date: '2026-10-05', quantity: 4200 });
    expect(await response.json()).toEqual({ success: true, po: { quantity: 4200, updatedAt: '2026-09-29T03:00:00Z' }, unchanged: false });
  });

  it('공장은 요청 본문이 아니라 인증에서만 온다', async () => {
    await PUT(request({ ...good, factoryId: 'other-factory', factory_id: 'other-factory' }));
    expect(mockApply.mock.calls[0][0]).toEqual({ id: 'factory-1' });
  });

  it.each([401, 403] as const)('인증·권한 실패 %s 는 본문을 읽거나 쓰기 전에 거부한다', async status => {
    mockAuth.mockRejectedValue(new ApiAuthError('Denied', status));
    expect((await PUT(request(good))).status).toBe(status);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('본문이 JSON 이 아니면 400 invalid_request', async () => {
    const response = await PUT(request(null, true));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, code: 'invalid_request' });
    expect(mockApply).not.toHaveBeenCalled();
  });

  it.each([
    ['본문이 객체가 아니다', 'abc'],
    ['접수 번호가 없다', { ...good, submissionId: undefined }],
    ['접수 번호가 uuid 가 아니다', { ...good, submissionId: 'not-a-uuid' }],
    ['행 번호가 0', { ...good, sourceRow: 0 }],
    ['행 번호가 소수', { ...good, sourceRow: 1.5 }],
    ['행 번호가 문자', { ...good, sourceRow: '15' }],
    ['날짜 형식이 아니다', { ...good, date: '2026/10/05' }],
    ['존재하지 않는 날짜', { ...good, date: '2026-02-30' }],
    ['수량이 음수', { ...good, quantity: -1 }],
    ['수량이 소수', { ...good, quantity: 1.5 }],
    ['수량이 문자', { ...good, quantity: 'abc' }],
    ['수량이 없다', { ...good, quantity: undefined }],
    ['수량이 상한 초과', { ...good, quantity: 100_000_001 }],
  ])('잘못된 요청은 고쳐 쓰지 않고 400 으로 거부한다: %s', async (_label, body) => {
    const response = await PUT(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, code: 'invalid_request' });
    expect(mockApply).not.toHaveBeenCalled();
  });

  it('수량 0 은 유효하다', async () => {
    expect((await PUT(request({ ...good, quantity: 0 }))).status).toBe(200);
    expect(mockApply.mock.calls[0][2]).toMatchObject({ quantity: 0 });
  });

  it.each([[409, 'submission_changed'], [404, 'po_target_not_found'], [404, 'no_submission'], [422, 'po_row_unsupported']])('저장소 거부 %s %s 는 그대로 전달한다', async (status, code) => {
    mockApply.mockRejectedValue(new PoOverrideError(status as 409, code));
    const response = await PUT(request(good));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ success: false, code });
  });

  it('예상하지 못한 오류는 내부 내용 없이 500 po_save_failed', async () => {
    mockApply.mockRejectedValue(new Error('connection string leaked?'));
    const response = await PUT(request(good));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, code: 'po_save_failed' });
  });
});

describe('DELETE /api/forecasts/po-overrides (원복)', () => {
  const { quantity: _quantity, ...target } = good;

  it('공장·사용자·칸을 넘겨 원복한다(수량은 필요 없다)', async () => {
    const response = await DELETE(request(target));
    expect(response.status).toBe(200);
    expect(mockRevert).toHaveBeenCalledWith({ id: 'factory-1' }, 'user-1', { submissionId: SUBMISSION, sourceRow: 15, date: '2026-10-05' });
    expect(await response.json()).toEqual({ success: true, reverted: true });
  });

  it.each([401, 403] as const)('인증·권한 실패 %s 는 거부한다', async status => {
    mockAuth.mockRejectedValue(new ApiAuthError('Denied', status));
    expect((await DELETE(request(target))).status).toBe(status);
    expect(mockRevert).not.toHaveBeenCalled();
  });

  it('잘못된 요청은 400', async () => {
    expect((await DELETE(request({ ...target, sourceRow: -3 }))).status).toBe(400);
    expect((await DELETE(request(null, true))).status).toBe(400);
    expect(mockRevert).not.toHaveBeenCalled();
  });

  it('접수가 바뀌었으면 409 submission_changed', async () => {
    mockRevert.mockRejectedValue(new PoOverrideError(409, 'submission_changed'));
    const response = await DELETE(request(target));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'submission_changed' });
  });

  it('예상하지 못한 오류는 500 po_save_failed', async () => {
    mockRevert.mockRejectedValue(new Error('boom'));
    expect((await DELETE(request(target))).status).toBe(500);
  });
});
