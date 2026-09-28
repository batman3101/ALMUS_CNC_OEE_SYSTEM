import { NextRequest, NextResponse } from 'next/server';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { discardPlan, routeErrorResponse } from '@/lib/layout-planning/server';
import { uuid } from '@/lib/layout-planning/requestBody';

export const runtime = 'nodejs';

/** Drop a draft. Confirmed plans are history and cannot be discarded (409 plan_not_draft). */
export async function POST(request: NextRequest, { params }: { params: Promise<{ planId: string }> }) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    await discardPlan(user.factoryId, user.userId, uuid((await params).planId, 'invalid_plan'));
    return NextResponse.json({ success: true });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
