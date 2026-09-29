import { NextRequest, NextResponse } from 'next/server';
import { apiAuthErrorResponse } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { parseForecastFile } from '@/lib/forecast/parseForecast';
import { loadForecastSubmission, saveForecastSubmission } from '@/lib/forecast/submission';
import { readBoundedFile, readFileName } from '@/lib/forecast/uploadRequest';
import { ForecastInputError } from '@/lib/forecast/xlsxArchive';

export const runtime = 'nodejs';

function failure(error: unknown, code: string) {
  const authError = apiAuthErrorResponse(error);
  if (authError) return authError;
  if (error instanceof ForecastInputError) return NextResponse.json({ success: false, code: error.code }, { status: error.status });
  return NextResponse.json({ success: false, code }, { status: 500 });
}

/** The factory's accepted Forecast, re-joined with the machines as they are now. `preview: null` = nothing accepted yet. */
export async function GET(request: NextRequest) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    const preview = await loadForecastSubmission({ id: user.factoryId, code: user.factoryCode });
    return NextResponse.json({ success: true, preview }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return failure(error, 'submission_load_failed');
  }
}

/**
 * Accept ('접수 확정') the file the user just inspected. The file is sent again and parsed here, so what is stored is
 * the server's reading, not whatever the browser sends back. `x-forecast-source-hash` is the hash the user saw:
 * a different file under the same name is refused rather than stored unseen.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    if (request.headers.get('x-forecast-factory-id') !== user.factoryId) return NextResponse.json({ success: false, code: 'factory_changed' }, { status: 409 });
    const fileName = readFileName(request);
    const expectedHash = request.headers.get('x-forecast-source-hash');
    if (!expectedHash) throw new ForecastInputError('source_changed', 409);
    const parsed = parseForecastFile(await readBoundedFile(request));
    if (parsed.sourceHash !== expectedHash) throw new ForecastInputError('source_changed', 409);
    const preview = await saveForecastSubmission({ id: user.factoryId, code: user.factoryCode }, user.userId, fileName, parsed);
    return NextResponse.json({ success: true, preview }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return failure(error, 'submission_failed');
  }
}
