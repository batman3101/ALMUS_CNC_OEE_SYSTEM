import { NextRequest, NextResponse } from 'next/server';
import { systemSettingsService } from '@/lib/systemSettings';
import type { SettingCategory } from '@/types/systemSettings';
import { apiAuthErrorResponse, requireUser } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

const VALID_CATEGORIES: SettingCategory[] = [
  'general',
  'oee',
  'notification',
  'display',
  'shift',
];

const parseCategory = (value: string): SettingCategory | null =>
  VALID_CATEGORIES.includes(value as SettingCategory)
    ? value as SettingCategory
    : null;

const errorResponse = (error: unknown) => {
  const authResponse = apiAuthErrorResponse(error);
  if (authResponse) return authResponse;
  console.error('System setting category route failed:', error);
  return NextResponse.json({ success: false, error: 'System setting request failed' }, { status: 500 });
};

export async function GET(
  request: NextRequest,
  { params }: { params: { category: string } }
) {
  try {
    await requireUser(request, ['admin', 'engineer', 'operator']);
    const category = parseCategory(params.category);
    if (!category) {
      return NextResponse.json({ success: false, error: 'Invalid category' }, { status: 400 });
    }

    const settings = await systemSettingsService.getStructuredSettings();
    return NextResponse.json({
      success: true,
      category,
      settings: settings[category] ?? {},
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: { category: string } }
) {
  try {
    await requireUser(request, ['admin']);
    const category = parseCategory(params.category);
    const body: unknown = await request.json();
    if (!category || !body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'Invalid settings data' }, { status: 400 });
    }

    const updates = Object.entries(body).map(([settingKey, settingValue]) => ({
      category,
      setting_key: settingKey,
      setting_value: settingValue,
      change_reason: `Category API update - ${category}.${settingKey}`,
    }));
    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: 'No settings supplied' }, { status: 400 });
    }

    const result = await systemSettingsService.updateMultipleSettings(updates);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error || 'Update failed' }, { status: 500 });
    }
    return NextResponse.json({ success: true, category, updated_count: updates.length });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { category: string } }
) {
  try {
    await requireUser(request, ['admin']);
    const category = parseCategory(params.category);
    if (!category) {
      return NextResponse.json({ success: false, error: 'Invalid category' }, { status: 400 });
    }

    const result = await systemSettingsService.resetToDefaults(category);
    if (!result.success) {
      return NextResponse.json({ success: false, error: result.error || 'Reset failed' }, { status: 500 });
    }
    return NextResponse.json({ success: true, category });
  } catch (error) {
    return errorResponse(error);
  }
}
