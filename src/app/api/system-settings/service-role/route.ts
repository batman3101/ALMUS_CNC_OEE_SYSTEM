import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, requireUser } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    await requireUser(request, ['admin', 'engineer', 'operator']);

    // 모든 활성 설정 조회
    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .select('*')
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
