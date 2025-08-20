import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/system-settings - 모든 시스템 설정 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const category = searchParams.get('category');

    // 실제 구현에서는 system_settings 테이블에서 데이터를 가져와야 함
    // 현재는 목업 데이터 반환
    const mockSettings = {
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
        ],
        shift_config: {
          A: { start: '08:00', end: '20:00', name: 'A교대' },
          B: { start: '20:00', end: '08:00', name: 'B교대' }
        }
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

    // 카테고리별 필터링
    if (category && mockSettings[category as keyof typeof mockSettings]) {
      return NextResponse.json({
        settings: { [category]: mockSettings[category as keyof typeof mockSettings] }
      });
    }

    return NextResponse.json({ settings: mockSettings });
  } catch (error) {
    console.error('Error fetching system settings:', error);
    return NextResponse.json(
      { error: 'Failed to fetch system settings' },
      { status: 500 }
    );
  }
}

// PUT /api/system-settings - 시스템 설정 업데이트
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { category, settings } = body;

    if (!category || !settings) {
      return NextResponse.json(
        { error: 'Category and settings are required' },
        { status: 400 }
      );
    }

    // 실제 구현에서는 system_settings 테이블 업데이트
    // 현재는 목업 응답 반환
    const updatedSettings = {
      category,
      settings,
      updated_at: new Date().toISOString(),
      updated_by: 'current_user' // 실제로는 인증된 사용자 ID
    };

    return NextResponse.json({
      success: true,
      message: 'Settings updated successfully',
      updated_settings: updatedSettings
    });
  } catch (error) {
    console.error('Error updating system settings:', error);
    return NextResponse.json(
      { error: 'Failed to update system settings' },
      { status: 500 }
    );
  }
}