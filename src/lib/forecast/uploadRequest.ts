import type { NextRequest } from 'next/server';
import { ForecastInputError, MAX_FORECAST_BYTES } from '@/lib/forecast/xlsxArchive';

/** Raw file body keeps the upload limit enforceable before buffering multipart data. */
export async function readBoundedFile(request: NextRequest): Promise<Buffer> {
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

export function readFileName(request: NextRequest): string {
  let fileName: string;
  try { fileName = decodeURIComponent(request.headers.get('x-forecast-file-name') || ''); }
  catch { throw new ForecastInputError('invalid_filename', 400); }
  if (!fileName || fileName.length > 240 || /[\/\x00-\x1f]/.test(fileName) || !/\.xlsx$/i.test(fileName)) throw new ForecastInputError('invalid_filename', 400);
  return fileName;
}
