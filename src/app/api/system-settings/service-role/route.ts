import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function GET() {
  try {
    // Service Role Key 확인
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    
    if (!serviceRoleKey) {
      console.error('❌ Missing SUPABASE_SERVICE_ROLE_KEY');
      return NextResponse.json(
        { error: 'Server configuration error' },
        { status: 500 }
      );
    }

    // Service Role Client 생성 (RLS 우회)
    const serviceClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      serviceRoleKey,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false
        }
      }
    );

    // 모든 활성 설정 조회
    const { data, error } = await serviceClient
      .from('system_settings')
      .select('*')
      .eq('is_active', true)
      .order('category, setting_key');

    if (error) {
      console.error('❌ Error fetching settings with service role:', error);
      return NextResponse.json(
        { error: 'Failed to fetch settings', details: error.message },
        { status: 500 }
      );
    }

    console.log('✅ Settings fetched with service role:', data?.length || 0);

    return NextResponse.json({
      success: true,
      data: data || []
    });

  } catch (error: unknown) {
    console.error('❌ Unexpected error in service-role route:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}