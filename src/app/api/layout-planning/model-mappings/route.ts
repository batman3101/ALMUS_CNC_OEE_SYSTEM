import { NextRequest, NextResponse } from 'next/server';
import { requireFactoryUser } from '@/lib/factoryAuth';
import { loadMappings, routeErrorResponse, saveMappings } from '@/lib/layout-planning/server';
import { array, jsonBody, text, uuidOrNull } from '@/lib/layout-planning/requestBody';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    return NextResponse.json({ success: true, mappings: await loadMappings(user.factoryId) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}

/**
 * Save the user's forecast-name → app-model pairings (reused for later forecasts of this factory).
 * `productModelId: null` removes a pairing. The model must belong to this factory (composite FK → 400).
 */
export async function PUT(request: NextRequest) {
  try {
    const user = await requireFactoryUser(request, ['admin', 'engineer']);
    const body = await jsonBody(request);
    const items = array(body.items, 'invalid_items', 500, item => {
      const i = (item ?? {}) as Record<string, unknown>;
      return {
        forecastModel: text(i.forecastModel, 'invalid_forecast_model', 120),
        productModelId: uuidOrNull(i.productModelId ?? null, 'invalid_product_model'),
      };
    });
    return NextResponse.json({ success: true, mappings: await saveMappings(user.factoryId, user.userId, items) });
  } catch (error) {
    return routeErrorResponse(error);
  }
}
