import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const authenticatedUser = await requireFactoryUser(request, ['admin', 'engineer', 'operator']);

    // 모든 활성 설정 조회
    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .select('*')
      // 설정이 새는 것은 설비가 새는 것보다 조용하다 — 화면이 깨지지 않고, ALV 가 ALT 의
      // 교대시간·휴식·OEE 임계값으로 계산한 결과를 아무 경고 없이 보여줄 뿐이다.
      .eq('factory_id', authenticatedUser.factoryId)
      .eq('is_active', true)
      .order('category, setting_key');

    if (error) {
      console.error('❌ Error fetching settings with service role:', error);
      return NextResponse.json(
        { error: 'Failed to fetch settings' },
        { status: 500 }
      );
    }

    console.log('✅ Settings fetched with service role:', data?.length || 0);

    return NextResponse.json({
      success: true,
      data: data || []
    });

  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('❌ Unexpected error in service-role route:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
