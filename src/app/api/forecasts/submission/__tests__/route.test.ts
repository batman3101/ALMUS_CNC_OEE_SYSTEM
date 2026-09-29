import type { NextRequest } from 'next/server';
import { ReadableStream } from 'node:stream/web';

// Codex 감사 V-01 (2026-09-29): 접수 라우트를 직접 실행해 인가·공장·해시·파일 검증·DB 실패를 확인한다.
jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: { status?: number; headers?: unknown }) => ({ status: init?.status ?? 200, headers: init?.headers, json: async () => body }) } }));
const mockAuth = jest.fn();
const mockParse = jest.fn();
const mockLoad = jest.fn();
const mockSave = jest.fn();
jest.mock('@/lib/factoryAuth', () => ({ requireFactoryUser: (...args: unknown[]) => mockAuth(...args) }));
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: {} }));
jest.mock('@/lib/forecast/parseForecast', () => ({ parseForecastFile: (...args: unknown[]) => mockParse(...args) }));
jest.mock('@/lib/forecast/submission', () => ({
  loadForecastSubmission: (...args: unknown[]) => mockLoad(...args),
  saveForecastSubmission: (...args: unknown[]) => mockSave(...args),
}));
import { ApiAuthError } from '@/lib/apiAuth';
import { ForecastInputError, MAX_FORECAST_BYTES } from '@/lib/forecast/xlsxArchive';
import { GET, POST } from '../route';

const factory = { id: 'factory-1', code: 'ALT' };
function request(headers: Record<string, string> = {}, chunks: Uint8Array[] = [Buffer.from('file')]): NextRequest {
  const map = new Map(Object.entries({
    'x-forecast-file-name': 'W40.xlsx', 'x-forecast-factory-id': 'factory-1', 'x-forecast-source-hash': 'hash-1', ...headers,
  }).filter(([, v]) => v !== undefined));
  return { headers: { get: (key: string) => map.get(key) ?? null }, body: new ReadableStream({ start(c) { for (const chunk of chunks) c.enqueue(chunk); c.close(); } }) } as unknown as NextRequest;
}
const withoutHeader = (name: string) => {
  const req = request();
  const get = req.headers.get.bind(req.headers);
  return { ...req, headers: { get: (key: string) => (key === name ? null : get(key)) } } as unknown as NextRequest;
};

beforeEach(() => {
  jest.clearAllMocks();
  mockAuth.mockResolvedValue({ factoryId: 'factory-1', factoryCode: 'ALT', userId: 'user-1', role: 'engineer' });
  mockParse.mockReturnValue({ parserVersion: 'almus-v1', sourceHash: 'hash-1', rows: [], dates: [] });
  mockLoad.mockResolvedValue(null);
  mockSave.mockResolvedValue({ fileName: 'W40.xlsx', submission: { submittedAt: '2026-09-29T02:00:00Z' } });
});

describe('GET accepted Forecast', () => {
  it('reads only the authenticated factory, and says "none" as preview: null', async () => {
    const req = request();
    const response = await GET(req);
    expect(response.status).toBe(200);
    expect(mockAuth).toHaveBeenCalledWith(req, ['admin', 'engineer']);
    expect(mockLoad).toHaveBeenCalledWith(factory);
    expect(await response.json()).toEqual({ success: true, preview: null });
  });
  it.each([401, 403] as const)('rejects authorization failure %s without reading', async status => {
    mockAuth.mockRejectedValue(new ApiAuthError('Denied', status));
    expect((await GET(request())).status).toBe(status);
    expect(mockLoad).not.toHaveBeenCalled();
  });
  it('turns a database failure into 500 submission_load_failed, not an empty answer', async () => {
    mockLoad.mockRejectedValue(new Error('db down'));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, code: 'submission_load_failed' });
  });
});

describe('POST 접수 확정', () => {
  it('stores the server\'s own reading under the authenticated factory and user', async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mockParse).toHaveBeenCalledWith(Buffer.from('file'));
    expect(mockSave).toHaveBeenCalledWith(factory, 'user-1', 'W40.xlsx', expect.objectContaining({ sourceHash: 'hash-1' }));
  });
  it.each([401, 403] as const)('rejects authorization failure %s before reading the file or saving', async status => {
    mockAuth.mockRejectedValue(new ApiAuthError('Denied', status));
    expect((await POST(request())).status).toBe(status);
    expect(mockParse).not.toHaveBeenCalled(); expect(mockSave).not.toHaveBeenCalled();
  });
  it('rejects a stale or forged factory selection with 409 before reading', async () => {
    expect((await POST(request({ 'x-forecast-factory-id': 'factory-2' }))).status).toBe(409);
    expect(mockParse).not.toHaveBeenCalled(); expect(mockSave).not.toHaveBeenCalled();
  });
  it('refuses to store without the hash the user saw', async () => {
    const response = await POST(withoutHeader('x-forecast-source-hash'));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'source_changed' });
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('refuses a file whose content differs from the one inspected', async () => {
    mockParse.mockReturnValue({ parserVersion: 'almus-v1', sourceHash: 'hash-other', rows: [], dates: [] });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ success: false, code: 'source_changed' });
    expect(mockSave).not.toHaveBeenCalled();
  });
  it.each(['W40.xlsm', '../W40.xlsx', '%XX', ''])('rejects file name %s with 400', async name => {
    expect((await POST(request({ 'x-forecast-file-name': name }))).status).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('enforces the upload size and rejects an empty body', async () => {
    expect((await POST(request({ 'content-length': String(MAX_FORECAST_BYTES + 1) }))).status).toBe(413);
    expect((await POST(request({}, [Buffer.alloc(MAX_FORECAST_BYTES), Buffer.from('x')]))).status).toBe(413);
    expect((await POST(request({}, []))).status).toBe(400);
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('passes parser rejection through as 422 and stores nothing', async () => {
    mockParse.mockImplementation(() => { throw new ForecastInputError('unsupported_template'); });
    const response = await POST(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ success: false, code: 'unsupported_template' });
    expect(mockSave).not.toHaveBeenCalled();
  });
  it('turns a database failure into 500 submission_failed', async () => {
    mockSave.mockRejectedValue(new Error('db down'));
    const response = await POST(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ success: false, code: 'submission_failed' });
  });
});
