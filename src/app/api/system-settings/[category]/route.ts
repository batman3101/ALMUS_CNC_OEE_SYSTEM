import { NextRequest, NextResponse } from 'next/server';
import type { SettingCategory } from '@/types/systemSettings';
import { apiAuthErrorResponse } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';
import {
  readFactorySettings,
  structureSettings,
  writeFactorySettings,
} from '@/lib/factorySettings';

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
  { params }: { params: Promise<{ category: string }> }
) {
  try {
    const { category: categoryParam } = await params;
    const authenticatedUser = await requireFactoryUser(request, ['admin', 'engineer', 'operator']);
    const category = parseCategory(categoryParam);
    if (!category) {
      return NextResponse.json({ success: false, error: 'Invalid category' }, { status: 400 });
    }

    // `systemSettingsService` 의 서버 분기는 구조적으로 공장 경계를 넘는다
    // (근거는 `@/lib/factorySettings` 상단). 서버에서는 공장을 명시적으로 넘긴다.
    const settings = structureSettings(await readFactorySettings(authenticatedUser.factoryId));
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
  { params }: { params: Promise<{ category: string }> }
) {
  try {
    const { category: categoryParam } = await params;
    const authenticatedUser = await requireFactoryUser(request, ['admin']);
    const category = parseCategory(categoryParam);
    const body: unknown = await request.json();
    if (!category || !body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'Invalid settings data' }, { status: 400 });
    }

    const updates = Object.entries(body).map(([settingKey, settingValue]) => ({
      category,
      setting_key: settingKey,
      setting_value: settingValue,
    }));
    if (updates.length === 0) {
      return NextResponse.json({ success: false, error: 'No settings supplied' }, { status: 400 });
    }

    const result = await writeFactorySettings(
      authenticatedUser.factoryId,
      authenticatedUser.userId,
      updates,
      `Category API update - ${category}`
    );
    if (!result.ok) {
      return NextResponse.json({ success: false, error: result.error || 'Update failed' }, { status: 500 });
    }
    return NextResponse.json({ success: true, category, updated_count: updates.length });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ category: string }> }
) {
  try {
    const { category: categoryParam } = await params;
    await requireFactoryUser(request, ['admin']);
    const category = parseCategory(categoryParam);
    if (!category) {
      return NextResponse.json({ success: false, error: 'Invalid category' }, { status: 400 });
    }

    // ⚠️ 기본값 복원은 아직 공장 범위가 아니다.
    //
    // `resetToDefaults` 는 `systemSettingsService` 안에 있고 그 모듈의 서버 분기는 공장을
    // 모른다. 읽기·저장과 달리 이 동작은 "원장의 기본값 전체를 다시 기록"하는 것이라
    // 단순히 factory_id 를 끼워 넣는 것으로 끝나지 않는다(어느 공장의 기본값인가, 공장별로
    // 다른 기본값이 있는가 — 운영 결정이 먼저 필요하다).
    //
    // 그래서 잘못된 공장에 쓰는 대신 **거부한다.** 501 은 "아직 구현되지 않았다"이고, 이
    // 엔드포인트를 부르는 화면은 현재 없다(설정 화면은 /api/system-settings/update 를 쓴다).
    return NextResponse.json(
      {
        success: false,
        error: 'Category reset is not available while settings are factory-scoped',
      },
      { status: 501 }
    );
  } catch (error) {
    return errorResponse(error);
  }
}
