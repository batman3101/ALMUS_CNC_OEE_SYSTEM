import { NextRequest, NextResponse } from 'next/server';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { routeErrorResponse, transitionSetupTask } from '@/lib/layout-planning/server';
import { BadRequest, jsonBody, positiveInt, uuid } from '@/lib/layout-planning/requestBody';

export const runtime = 'nodejs';

const TARGETS = new Set(['in_progress', 'completed', 'cancelled']);

/** Setup waiting → in progress → completed, or cancelled with a reason. The order itself is enforced in the RPC. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ taskId: string }> }) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    const taskId = uuid((await params).taskId, 'invalid_task');
    const body = await jsonBody(request);
    if (typeof body.toStatus !== 'string' || !TARGETS.has(body.toStatus)) throw new BadRequest('invalid_status');
    const reason = typeof body.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 500) : null;
    const result = await transitionSetupTask(user.factoryId, user.userId, taskId, positiveInt(body.expectedRevision, 'invalid_revision'), body.toStatus, reason);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
