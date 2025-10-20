import { NextRequest, NextResponse } from 'next/server';

// GET /api/system-settings/[category] - 특정 카테고리 설정 조회
export async function GET(
  request: NextRequest,
  { params }: { params: { category: string } }
) {
  try {
    const { category } = params;

    // 유효한 카테고리 검증
    const validCategories = ['general', 'oee', 'notifications', 'display', 'shifts'];
    
    if (!validCategories.includes(category)) {
      return NextResponse.json(
        { error: 'Invalid category' },
        { status: 400 }
      );
    }

    // 실제 구현에서는 system_settings 테이블에서 데이터를 가져와야 함
    // 현재는 목업 데이터 반환
    const mockSettingsByCategory = {
      general: {
        app_name: 'CNC OEE Monitoring System',
        default_language: 'ko',
        timezone: 'Asia/Seoul',
        date_format: 'YYYY-MM-DD',
        time_format: '24',
        downtime_reasons: [
          '설비 고장',
          '금형 교체',
          '자재 부족',
          '품질 불량',
          '계획 정지',
          '청소/정리',
          '기타'
        ]
      },
      oee: {
        target_oee: 0.85,
        target_availability: 0.90,
        target_performance: 0.95,
        target_quality: 0.98,
        alert_threshold_low: 0.70,
        alert_threshold_critical: 0.60,
        calculation_method: 'standard',
        aggregate_interval: 'hourly',
        data_retention_days: 365
      },
      notifications: {
        email_enabled: true,
        sms_enabled: false,
        push_enabled: true,
        alert_recipients: ['admin@company.com', 'engineer@company.com'],
        alert_conditions: {
          oee_below_threshold: true,
          machine_downtime: true,
          quality_issues: true,
          production_delays: true
        },
        notification_frequency: 'immediate'
      },
      display: {
        theme: 'light',
        dashboard_refresh_interval: 30,
        chart_colors: {
          oee: '#1890ff',
          availability: '#52c41a',
          performance: '#faad14',
          quality: '#f5222d'
        },
        default_date_range: '7d',
        items_per_page: 20
      },
      shifts: {
        enabled: true,
        shifts: [
          {
            id: 'A',
            name: 'A교대',
            start_time: '08:00',
            end_time: '20:00',
            is_active: true
          },
          {
            id: 'B',
            name: 'B교대', 
            start_time: '20:00',
            end_time: '08:00',
            is_active: true
          }
        ],
        overlap_minutes: 30,
        break_times: [
          { start: '12:00', end: '13:00', name: '점심시간' },
          { start: '18:00', end: '18:30', name: '저녁시간' }
        ]
      }
    };

    const categorySettings = mockSettingsByCategory[category as keyof typeof mockSettingsByCategory];

    if (!categorySettings) {
      return NextResponse.json(
        { error: 'Category not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      category,
      settings: categorySettings,
      last_updated: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching category settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch category settings' },
      { status: 500 }
    );
  }
}

// PUT /api/system-settings/[category] - 특정 카테고리 설정 업데이트
export async function PUT(
  request: NextRequest,
  { params }: { params: { category: string } }
) {
  try {
    const { category } = params;
    const body = await request.json();

    // 유효한 카테고리 검증
    const validCategories = ['general', 'oee', 'notifications', 'display', 'shifts'];
    
    if (!validCategories.includes(category)) {
      return NextResponse.json(
        { error: 'Invalid category' },
        { status: 400 }
      );
    }

    // 설정 값 검증
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid settings data' },
        { status: 400 }
      );
    }

    // 카테고리별 검증 로직
    switch (category) {
      case 'oee':
        if (body.target_oee && (body.target_oee < 0 || body.target_oee > 1)) {
          return NextResponse.json(
            { error: 'OEE target must be between 0 and 1' },
            { status: 400 }
          );
        }
        break;
        
      case 'display':
        if (body.dashboard_refresh_interval && body.dashboard_refresh_interval < 5) {
          return NextResponse.json(
            { error: 'Refresh interval must be at least 5 seconds' },
            { status: 400 }
          );
        }
        break;
    }

    // 실제 구현에서는 system_settings 테이블 업데이트
    // 현재는 목업 응답 반환
    const updatedSettings = {
      category,
      settings: body,
      updated_at: new Date().toISOString(),
      updated_by: 'current_user' // 실제로는 인증된 사용자 ID
    };

    return NextResponse.json({
      success: true,
      message: `${category} settings updated successfully`,
      updated_settings: updatedSettings
    });
  } catch (error) {
    console.error('Error updating category settings:', error);
    return NextResponse.json(
      { error: 'Failed to update category settings' },
      { status: 500 }
    );
  }
}

// DELETE /api/system-settings/[category] - 특정 카테고리 설정 초기화
export async function DELETE(
  request: NextRequest,
  { params }: { params: { category: string } }
) {
  try {
    const { category } = params;

    // 유효한 카테고리 검증
    const validCategories = ['general', 'oee', 'notifications', 'display', 'shifts'];
    
    if (!validCategories.includes(category)) {
      return NextResponse.json(
        { error: 'Invalid category' },
        { status: 400 }
      );
    }

    // 실제 구현에서는 해당 카테고리 설정을 기본값으로 초기화
    // 현재는 목업 응답 반환
    return NextResponse.json({
      success: true,
      message: `${category} settings reset to default`,
      reset_at: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error resetting category settings:', error);
    return NextResponse.json(
      { error: 'Failed to reset category settings' },
      { status: 500 }
    );
  }
}