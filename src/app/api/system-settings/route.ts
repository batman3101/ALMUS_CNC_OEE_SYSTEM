import { NextRequest, NextResponse } from 'next/server';
import { systemSettingsService } from '@/lib/systemSettings';
import type { 
  SettingCategory, 
  SettingsResponse,
  SettingUpdateResponse 
} from '@/types/systemSettings';

export const dynamic = 'force-dynamic';

// GET /api/system-settings - 모든 시스템 설정 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category') as SettingCategory | null;

    // 카테고리별 필터링이 요청된 경우
    if (category) {
      // 먼저 전체 구조화된 설정을 가져와서 카테고리별로 필터링
      const structuredSettings = await systemSettingsService.getStructuredSettings();
      
      // 요청된 카테고리가 존재하는지 확인
      if (structuredSettings[category]) {
        return NextResponse.json({
          success: true,
          settings: { [category]: structuredSettings[category] }
        });
      } else {
        // 카테고리가 없으면 빈 객체 반환
        return NextResponse.json({
          success: true,
          settings: { [category]: {} }
        });
      }
    }

    // 모든 설정 조회
    const structuredSettings = await systemSettingsService.getStructuredSettings();
    
    return NextResponse.json({
      success: true,
      settings: structuredSettings
    });
    
  } catch (error) {
    console.error('Error fetching system settings:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to fetch system settings',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// PUT /api/system-settings - 시스템 설정 업데이트
export async function PUT(request: NextRequest) {
  try {
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
    const updates = [];
    for (const [key, value] of Object.entries(settings)) {
      updates.push({
        category: category as SettingCategory,
        setting_key: key,
        setting_value: value,
        change_reason: change_reason || `API update - ${category}.${key}`
      });
    }

    // 여러 설정값 일괄 업데이트
    const response = await systemSettingsService.updateMultipleSettings(updates);

    if (!response.success) {
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
    console.error('Error updating system settings:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to update system settings',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// POST /api/system-settings - 새로운 설정 생성 (단일 설정)
export async function POST(request: NextRequest) {
  try {
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

    const update = {
      category: category as SettingCategory,
      setting_key,
      setting_value,
      change_reason: change_reason || `API create - ${category}.${setting_key}`
    };

    const response = await systemSettingsService.updateSetting(update);

    if (!response.success) {
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
    console.error('Error creating system setting:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to create system setting',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// DELETE /api/system-settings - 설정 비활성화
export async function DELETE(request: NextRequest) {
  try {
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
    const update = {
      category,
      setting_key,
      setting_value: null, // 값은 유지하되 비활성화
      change_reason: `API delete - ${category}.${setting_key}`
    };

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
    console.error('Error deleting system setting:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to delete system setting',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}