import { NextRequest, NextResponse } from 'next/server';
import { apiAuthErrorResponse } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { parseForecastFile } from '@/lib/forecast/parseForecast';
import { ForecastInputError } from '@/lib/forecast/xlsxArchive';
import { readBoundedFile, readFileName } from '@/lib/forecast/uploadRequest';
import { loadForecastCapacityPolicy } from '@/lib/forecast/capacityPolicy';
import { loadForecastCapacitySnapshot } from '@/lib/forecast/capacitySnapshot';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    // This is only an expectation check; authenticated factory membership is authority.
    if (request.headers.get('x-forecast-factory-id') !== user.factoryId) return NextResponse.json({ success: false, code: 'factory_changed' }, { status: 409 });
    const fileName = readFileName(request);
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
