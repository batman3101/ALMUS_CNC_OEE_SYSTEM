import { NextRequest, NextResponse } from 'next/server';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { confirmPlan, routeErrorResponse } from '@/lib/layout-planning/server';
import { jsonBody, positiveInt, uuid } from '@/lib/layout-planning/requestBody';

export const runtime = 'nodejs';

/**
 * Confirm = the final model/process of every changed machine is written to `machines` at once (PRD D15) and a
 * setup task is opened per changed machine. Admin and engineer may both confirm (user decision 2026-09-25).
 * 409 `layout_base_stale` = a machine changed since the simulation; re-simulate instead of overwriting it.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    const planId = uuid((await params).planId, 'invalid_plan');
    const body = await jsonBody(request);
    const result = await confirmPlan(user.factoryId, user.userId, planId, positiveInt(body.expectedRevision, 'invalid_revision'));
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
