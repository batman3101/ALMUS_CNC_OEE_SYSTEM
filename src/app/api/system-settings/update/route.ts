import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

/**
 * Service Role을 사용하여 시스템 설정 업데이트 (RLS 우회)
 * POST /api/system-settings/update
 *
 * ⚠️ 이 라우트는 Service Role 키로 전역 system_settings 를 쓴다. 즉 RLS 를 우회한다.
 *    예전에는 인증/인가 검사가 전혀 없어서, 로그인하지 않은 사람도 POST 한 번으로
 *    교대 시간·OEE 임계값·회사명 등 모든 전역 설정을 덮어쓸 수 있었다.
 *    DB 의 update_system_setting 을 관리자 전용으로 막아도 이 경로가 열려 있으면 의미가 없으므로,
 *    여기서도 반드시 "관리자 세션"임을 확인한 뒤에만 Service Role 을 사용한다.
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

    // ── 인가: 호출자가 실제로 관리자인지 확인한다 ──────────────────────────────
    const authHeader = request.headers.get('authorization');
    const accessToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!accessToken) {
      return NextResponse.json(
        { success: false, error: '인증이 필요합니다.' },
        { status: 401 }
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

    // 토큰이 유효한 사용자인지, 그리고 그 사용자가 관리자인지 확인한다.
    const { data: authData, error: authError } = await serviceClient.auth.getUser(accessToken);
    if (authError || !authData?.user) {
      return NextResponse.json(
        { success: false, error: '유효하지 않은 세션입니다.' },
        { status: 401 }
      );
    }

    const { data: profile, error: profileError } = await serviceClient
      .from('user_profiles')
      .select('role, is_active')
      .eq('user_id', authData.user.id)
      .single();

    if (profileError || profile?.role !== 'admin' || profile.is_active !== true) {
      return NextResponse.json(
        { success: false, error: '시스템 설정은 관리자만 변경할 수 있습니다.' },
        { status: 403 }
      );
    }
    // ──────────────────────────────────────────────────────────────────────────

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
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
