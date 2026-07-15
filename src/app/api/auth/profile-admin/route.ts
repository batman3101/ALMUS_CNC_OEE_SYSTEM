import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, requireUser } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    console.log('🔧 [API] Profile Admin Route - GET request started');
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
    
    // Get user_id from query parameters
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('user_id');
    
    if (!userId) {
      console.error('❌ [API] Missing user_id parameter');
      return NextResponse.json(
        { error: 'Missing user_id parameter' },
        { status: 400 }
      );
    }

    // 프로필 bootstrap은 본인 조회만 허용한다. 관리자는 사용자 관리 화면에서만
    // 다른 사용자를 조회할 수 있으며, 그 경로는 별도의 admin API를 사용한다.
    if (authenticatedUser.userId !== userId) {
      return NextResponse.json(
        { error: '다른 사용자의 프로필을 조회할 수 없습니다' },
        { status: 403 }
      );
    }

    console.log('🔍 [API] Querying profile for user_id:', userId);

    // Query user profile using Service Role (bypasses RLS)
    const { data: profile, error } = await supabaseAdmin
      .from('user_profiles')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error) {
      console.error('❌ [API] Profile query error:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      
      // Handle "no rows found" error specifically
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Profile not found', profile: null },
          { status: 404 }
        );
      }
      
      return NextResponse.json(
        { error: 'Database query failed', details: error.message },
        { status: 500 }
      );
    }

    console.log('✅ [API] Profile retrieved successfully:', {
      userId: profile.user_id,
      email: profile.email,
      role: profile.role
    });

    return NextResponse.json({
      success: true,
      profile: profile
    });

  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('❌ [API] Unexpected error in profile admin route:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
