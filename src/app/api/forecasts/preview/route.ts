import { NextRequest, NextResponse } from 'next/server';
import { apiAuthErrorResponse } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { parseForecastFile } from '@/lib/forecast/parseForecast';
import { ForecastInputError, MAX_FORECAST_BYTES } from '@/lib/forecast/xlsxArchive';
import { loadForecastCapacityPolicy } from '@/lib/forecast/capacityPolicy';
import { loadForecastCapacitySnapshot } from '@/lib/forecast/capacitySnapshot';

export const runtime = 'nodejs';

/** Raw file body keeps the upload limit enforceable before buffering multipart data. */
async function readBoundedFile(request: NextRequest): Promise<Buffer> {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_FORECAST_BYTES)) throw new ForecastInputError('file_too_large', 413);
  if (!request.body) throw new ForecastInputError('file_required', 400);
  const reader = request.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_FORECAST_BYTES) { await reader.cancel(); throw new ForecastInputError('file_too_large', 413); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new ForecastInputError('file_required', 400);
  return Buffer.concat(chunks, size);
}

export async function POST(request: NextRequest) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    // This is only an expectation check; authenticated factory membership is authority.
    if (request.headers.get('x-forecast-factory-id') !== user.factoryId) return NextResponse.json({ success: false, code: 'factory_changed' }, { status: 409 });
    let fileName: string;
    try { fileName = decodeURIComponent(request.headers.get('x-forecast-file-name') || ''); }
    catch { throw new ForecastInputError('invalid_filename', 400); }
    if (!fileName || fileName.length > 240 || /[\\/\x00-\x1f]/.test(fileName) || !/\.xlsx$/i.test(fileName)) throw new ForecastInputError('invalid_filename', 400);
    const preview = parseForecastFile(await readBoundedFile(request));
    const [capacityPolicy, capacitySnapshot] = await Promise.all([loadForecastCapacityPolicy(user.factoryId), loadForecastCapacitySnapshot(user.factoryId)]);
    return NextResponse.json({ success: true, preview: { ...preview, factory: { id: user.factoryId, code: user.factoryCode }, fileName, capacityPolicy, capacitySnapshot } }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const authError = apiAuthErrorResponse(error);
    if (authError) return authError;
    if (error instanceof ForecastInputError) return NextResponse.json({ success: false, code: error.code }, { status: error.status });
    return NextResponse.json({ success: false, code: 'preview_failed' }, { status: 500 });
  }
}
