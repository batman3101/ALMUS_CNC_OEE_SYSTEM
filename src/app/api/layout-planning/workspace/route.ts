import { NextRequest, NextResponse } from 'next/server';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { loadMappings, loadWorkspace, routeErrorResponse } from '@/lib/layout-planning/server';

export const runtime = 'nodejs';

/**
 * Drawing, current machine state, models/T/T, OEE capacity policy, saved mappings and recent plans.
 * `geometry: null` = this factory has no drawing yet (ALV until its layout is added).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    const [workspace, mappings] = await Promise.all([loadWorkspace(user.factoryId), loadMappings(user.factoryId)]);
    return NextResponse.json(
      { success: true, factory: { id: user.factoryId, code: user.factoryCode }, ...workspace, mappings },
      { headers: { 'Cache-Control': 'private, no-store' } },
    );
  } catch (error) {
    return routeErrorResponse(error);
  }
}
