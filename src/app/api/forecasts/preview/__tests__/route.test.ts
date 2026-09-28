import type { NextRequest } from 'next/server';
import { ReadableStream } from 'node:stream/web';

jest.mock('next/server', () => ({ NextResponse: { json: (body: unknown, init?: { status?: number; headers?: unknown }) => ({ status: init?.status ?? 200, headers: init?.headers, json: async () => body }) } }));
const mockAuth = jest.fn();
const mockParse = jest.fn();
const mockPolicy = jest.fn();
jest.mock('@/lib/factoryAuth', () => ({ requireFactoryUser: (...args: unknown[]) => mockAuth(...args) }));
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: {} }));
jest.mock('@/lib/forecast/parseForecast', () => ({ parseForecastFile: (...args: unknown[]) => mockParse(...args) }));
jest.mock('@/lib/forecast/capacityPolicy', () => ({ loadForecastCapacityPolicy: (...args: unknown[]) => mockPolicy(...args) }));
const mockSnapshot = jest.fn();
jest.mock('@/lib/forecast/capacitySnapshot', () => ({ loadForecastCapacitySnapshot: (...args: unknown[]) => mockSnapshot(...args) }));
import { ApiAuthError } from '@/lib/apiAuth';
import { ForecastInputError, MAX_FORECAST_BYTES } from '@/lib/forecast/xlsxArchive';
import { POST } from '../route';

function request(headers: Record<string, string> = {}, chunks: Uint8Array[] = [Buffer.from('file')]): NextRequest {
  const map = new Map(Object.entries({ 'x-forecast-file-name': 'test.xlsx', 'x-forecast-factory-id': 'factory-1', ...headers }));
  // Minimal Request adapter: the route reads only headers and the Web byte stream.
  return { headers: { get: (key: string) => map.get(key) ?? null }, body: new ReadableStream({ start(controller) { for (const chunk of chunks) controller.enqueue(chunk); controller.close(); } }) } as unknown as NextRequest;
}

describe('POST Forecast preview', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuth.mockResolvedValue({ factoryId: 'factory-1', factoryCode: 'ALT', role: 'engineer' });
    mockParse.mockReturnValue({ parserVersion: 'almus-v1', capacityValidated: false, rows: [] });
    mockPolicy.mockResolvedValue({ status: 'unavailable' });
    mockSnapshot.mockResolvedValue({ status: 'unavailable' });
  });
  it('binds preview and OEE settings to the authenticated factory', async () => {
    const req = request(); const response = await POST(req); const body = await response.json();
    expect(response.status).toBe(200);
    expect(mockAuth).toHaveBeenCalledWith(req, ['admin', 'engineer']);
    expect(body.preview.factory).toEqual({ id: 'factory-1', code: 'ALT' });
    expect(body.preview.capacityValidated).toBe(false);
    expect(mockPolicy).toHaveBeenCalledWith('factory-1');
    expect(mockParse).toHaveBeenCalledWith(Buffer.from('file'));
    expect(mockSnapshot).toHaveBeenCalledWith('factory-1');
    expect(body.preview.capacitySnapshot).toEqual({ status: 'unavailable' });
  });
  it('returns the factory snapshot alongside the preview', async () => {
    mockSnapshot.mockResolvedValue({ status: 'available', takenAt: 't', models: [], machines: [] });
    const body = await (await POST(request())).json();
    expect(body.preview.capacitySnapshot).toMatchObject({ status: 'available', models: [], machines: [] });
  });
  it.each([401, 403] as const)('rejects authorization failure %s before reading a file', async status => {
    mockAuth.mockRejectedValue(new ApiAuthError('Denied', status));
    expect((await POST(request())).status).toBe(status);
    expect(mockParse).not.toHaveBeenCalled(); expect(mockPolicy).not.toHaveBeenCalled(); expect(mockSnapshot).not.toHaveBeenCalled();
  });
  it('rejects stale or forged factory selection instead of switching factories', async () => {
    expect((await POST(request({ 'x-forecast-factory-id': 'factory-2' }))).status).toBe(409);
    expect(mockParse).not.toHaveBeenCalled();
  });
  it.each(['test.xlsm', '../test.xlsx', '%XX', '', 'file.xlsx%00'])('rejects filename %s', async name => {
    expect((await POST(request({ 'x-forecast-file-name': name }))).status).toBe(400);
    expect(mockParse).not.toHaveBeenCalled();
  });
  it('enforces both advertised and actual upload size', async () => {
    expect((await POST(request({ 'content-length': String(MAX_FORECAST_BYTES + 1) }))).status).toBe(413);
    expect((await POST(request({}, [Buffer.alloc(MAX_FORECAST_BYTES), Buffer.from('x')]))).status).toBe(413);
    expect(mockParse).not.toHaveBeenCalled();
  });
  it('rejects an empty body', async () => expect((await POST(request({}, []))).status).toBe(400));
  it('preserves parser validation status without internal diagnostics', async () => {
    mockParse.mockImplementation(() => { throw new ForecastInputError('unsupported_template'); });
    const response = await POST(request()); expect(response.status).toBe(422); expect(await response.json()).toEqual({ success: false, code: 'unsupported_template' });
  });
  it('does not expose internal errors', async () => {
    mockParse.mockImplementation(() => { throw new Error('private internal detail'); });
    const response = await POST(request()); expect(response.status).toBe(500); expect(await response.json()).toEqual({ success: false, code: 'preview_failed' });
  });
});
