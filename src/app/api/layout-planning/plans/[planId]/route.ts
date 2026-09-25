import { NextRequest, NextResponse } from 'next/server';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { loadPlan, routeErrorResponse, savePlanDraft } from '@/lib/layout-planning/server';
import { array, jsonBody, positiveInt, uuid, uuidOrNull } from '@/lib/layout-planning/requestBody';

export const runtime = 'nodejs';
type Params = { params: Promise<{ planId: string }> };

/** Plan + per-machine assignments + capacity alerts recomputed from the final (fine-tuned) layout. */
export async function GET(request: NextRequest, { params }: Params) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    const planId = uuid((await params).planId, 'invalid_plan');
    return NextResponse.json({ success: true, ...(await loadPlan(user.factoryId, planId)) }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/** Fine-tune: change final model/process or lock per machine. 409 when someone else saved first. */
export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    const planId = uuid((await params).planId, 'invalid_plan');
    const body = await jsonBody(request);
    const changes = array(body.changes, 'invalid_changes', 2000, item => {
      const c = (item ?? {}) as Record<string, unknown>;
      return {
        machineId: uuid(c.machineId, 'invalid_changes'),
        finalModelId: uuidOrNull(c.finalModelId ?? null, 'invalid_changes'),
        finalProcessId: uuidOrNull(c.finalProcessId ?? null, 'invalid_changes'),
        isLocked: typeof c.isLocked === 'boolean' ? c.isLocked : undefined,
      };
    });
    const saved = await savePlanDraft(user.factoryId, user.userId, planId, positiveInt(body.expectedRevision, 'invalid_revision'), changes);
    return NextResponse.json({ success: true, revision: saved.revision, ...(await loadPlan(user.factoryId, planId)) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
