import { NextRequest, NextResponse } from 'next/server';
import type {
  SettingCategory
} from '@/types/systemSettings';
import { apiAuthErrorResponse } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';
import {
  readFactorySettings,
  structureSettings,
  writeFactorySettings,
} from '@/lib/factorySettings';

export const dynamic = 'force-dynamic';

// GET /api/system-settings - 모든 시스템 설정 조회
export async function GET(request: NextRequest) {
  try {
    const authenticatedUser = await requireFactoryUser(request, ['admin', 'engineer', 'operator']);
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') as SettingCategory | null;

    // `systemSettingsService` 를 쓰지 않는 이유는 `@/lib/factorySettings` 상단에 적어 두었다 —
    // 그 모듈의 서버 분기는 구조적으로 공장 경계를 넘는다.
    const structuredSettings = structureSettings(
      await readFactorySettings(authenticatedUser.factoryId)
    );

    // 카테고리별 필터링이 요청된 경우
    if (category) {
      return NextResponse.json({
        success: true,
        // 없는 카테고리는 빈 객체다 — 예전 계약을 그대로 유지한다.
        settings: { [category]: structuredSettings[category] ?? {} }
      });
    }

    return NextResponse.json({
      success: true,
      settings: structuredSettings
    });
    
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Error fetching system settings:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to fetch system settings'
      },
      { status: 500 }
    );
  }
}

// PUT /api/system-settings - 시스템 설정 업데이트
export async function PUT(request: NextRequest) {
  try {
    const authenticatedUser = await requireFactoryUser(request, ['admin']);
    const body = await request.json();
    const { category, settings, change_reason } = body;

    if (!category || !settings) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Category and settings are required' 
        },
        { status: 400 }
      );
    }

    // 설정값들을 개별 업데이트로 변환
    const updates = Object.entries(settings).map(([key, value]) => ({
      category: category as SettingCategory,
      setting_key: key,
      setting_value: value,
    }));

    // 여러 설정값 일괄 업데이트 — plpgsql 함수 하나 = 한 트랜잭션이므로 부분 반영이 없다.
    const response = await writeFactorySettings(
      authenticatedUser.factoryId,
      authenticatedUser.userId,
      updates,
      change_reason || `API update - ${category}`
    );

    if (!response.ok) {
      return NextResponse.json(
        { 
          success: false,
          error: response.error || 'Failed to update settings'
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Settings updated successfully',
      category,
      updated_count: updates.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Error updating system settings:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to update system settings'
      },
      { status: 500 }
    );
  }
}

// POST /api/system-settings - 새로운 설정 생성 (단일 설정)
export async function POST(request: NextRequest) {
  try {
    const authenticatedUser = await requireFactoryUser(request, ['admin']);
    const body = await request.json();
    const { category, setting_key, setting_value, change_reason } = body;

    if (!category || !setting_key || setting_value === undefined) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Category, setting_key, and setting_value are required' 
        },
        { status: 400 }
      );
    }

    // 단건도 배치와 같은 경로를 쓴다 — 인코딩 규칙이 갈라지면 같은 값이 경로에 따라 다르게
    // 저장된다.
    const response = await writeFactorySettings(
      authenticatedUser.factoryId,
      authenticatedUser.userId,
      [{ category: category as SettingCategory, setting_key, setting_value }],
      change_reason || `API create - ${category}.${setting_key}`
    );

    if (!response.ok) {
      return NextResponse.json(
        { 
          success: false,
          error: response.error || 'Failed to create setting'
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Setting created successfully',
      setting: {
        category,
        key: setting_key,
        value: setting_value
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Error creating system setting:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to create system setting'
      },
      { status: 500 }
    );
  }
}

// DELETE /api/system-settings - 설정 비활성화
export async function DELETE(request: NextRequest) {
  try {
    await requireFactoryUser(request, ['admin']);
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') as SettingCategory | null;
    const setting_key = searchParams.get('key');

    if (!category || !setting_key) {
      return NextResponse.json(
        { 
          success: false,
          error: 'Category and key parameters are required' 
        },
        { status: 400 }
      );
    }

    // 삭제 대신 비활성화 처리 (is_active = false로 업데이트)
    // 여기서는 실제 비활성화 로직이 필요하지만,
    // 현재 서비스에는 해당 메서드가 없으므로 에러 응답
    return NextResponse.json(
      { 
        success: false,
        error: 'Delete operation not implemented yet'
      },
      { status: 501 }
    );

  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Error deleting system setting:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to delete system setting'
      },
      { status: 500 }
    );
  }
}
