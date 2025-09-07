import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Service Role을 사용하여 시스템 설정 업데이트 (RLS 우회)
 * POST /api/system-settings/update
 */
export async function POST(request: NextRequest) {
  try {
    const { category, setting_key, setting_value, change_reason } = await request.json();

    // 필수 매개변수 검증
    if (!category || !setting_key) {
      return NextResponse.json(
        { success: false, error: 'category와 setting_key는 필수입니다.' },
        { status: 400 }
      );
    }

    // Service Role Key 확인
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!serviceRoleKey) {
      console.error('❌ SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았습니다.');
      return NextResponse.json(
        { success: false, error: 'Service Role이 구성되지 않았습니다.' },
        { status: 500 }
      );
    }

    // Service Role 클라이언트 생성
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) {
      console.error('❌ NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다.');
      return NextResponse.json(
        { success: false, error: 'Supabase URL이 구성되지 않았습니다.' },
        { status: 500 }
      );
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    console.log('🔧 Service Role을 통한 설정 업데이트 시도:', {
      category,
      setting_key,
      setting_value,
      change_reason
    });

    // RPC 함수 호출
    const { data, error } = await serviceClient
      .rpc('update_system_setting', {
        p_category: category,
        p_key: setting_key,
        p_value: setting_value,
        p_reason: change_reason || '시스템 자동 업데이트'
      });

    if (error) {
      console.error('❌ Service Role RPC 호출 실패:', error);
      return NextResponse.json(
        { success: false, error: `설정 업데이트 실패: ${error.message}` },
        { status: 500 }
      );
    }

    console.log('✅ Service Role을 통한 설정 업데이트 성공');
    return NextResponse.json({ success: true, data });

  } catch (error) {
    console.error('❌ API 라우트에서 예외 발생:', error);
    return NextResponse.json(
      { 
        success: false, 
        error: '서버 내부 오류가 발생했습니다. 관리자에게 문의하세요.'
      },
      { status: 500 }
    );
  }
}

// OPTIONS 요청 처리 (CORS)
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}