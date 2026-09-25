import { NextRequest, NextResponse } from 'next/server';
import { requireFactoryUser } from '@/lib/factoryAuth';
import type { WeeklyModelDemand } from '@/lib/forecast/weeklyDemand';
import { createPlan, routeErrorResponse } from '@/lib/layout-planning/server';
import { array, BadRequest, isDate, jsonBody, text, uuid } from '@/lib/layout-planning/requestBody';

export const runtime = 'nodejs';

const WARNINGS = new Set(['error_cells', 'fractional', 'partial_week', 'no_numeric', 'duplicate_rows']);

function demand(item: unknown): WeeklyModelDemand {
  const d = (item ?? {}) as Record<string, unknown>;
  const peak = d.peakQuantity;
  if (!Number.isInteger(peak) || (peak as number) < 0) throw new BadRequest('invalid_demand');
  if (d.peakDate !== null && d.peakDate !== undefined && !isDate(d.peakDate)) throw new BadRequest('invalid_demand');
  const warnings = Array.isArray(d.warnings)
    ? d.warnings.filter((w): w is WeeklyModelDemand['warnings'][number] => typeof w === 'string' && WARNINGS.has(w))
    : [];
  return {
    model: text(d.model, 'invalid_demand', 120), week: typeof d.week === 'string' ? d.week : '', peakQuantity: peak as number,
    peakDate: (d.peakDate as string | null | undefined) ?? null, numericDays: 0, blankCells: 0, errorCells: 0, fractional: false, warnings,
  };
}

/**
 * Simulate and store a recommended layout (draft) from one week of Forecast demand.
 * Demand arrives already parsed by /api/forecasts/preview on the Forecast screen; T/T, machines, drawing and the
 * capacity policy are read here from the database, never from the client.
 * 422 `unmapped_models` lists forecast models with demand but no app model — resend with `acknowledgeUnmapped`
 * only after the user has seen that list.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    const body = await jsonBody(request);
    const week = (body.week ?? {}) as Record<string, unknown>;
    if (!isDate(week.start) || !isDate(week.end) || (week.start as string) > (week.end as string)) throw new BadRequest('invalid_week');
    const result = await createPlan(user.factoryId, user.userId, {
      title: text(body.title, 'invalid_title', 120),
      forecastFileName: text(body.forecastFileName, 'invalid_file_name', 240),
      forecastFileHash: text(body.forecastFileHash, 'invalid_file_hash', 128),
      week: { key: text(week.key, 'invalid_week', 20), start: week.start as string, end: week.end as string },
      demands: array(body.demands, 'invalid_demands', 500, demand),
      nextWeekDemands: body.nextWeekDemands === undefined ? [] : array(body.nextWeekDemands, 'invalid_demands', 500, demand),
      lockedMachineIds: body.lockedMachineIds === undefined ? [] : array(body.lockedMachineIds, 'invalid_locks', 2000, v => uuid(v, 'invalid_locks')),
      acknowledgeUnmapped: body.acknowledgeUnmapped === true,
    });
    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
