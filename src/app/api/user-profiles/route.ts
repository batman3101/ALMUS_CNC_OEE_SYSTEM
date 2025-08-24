import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/user-profiles - 모든 사용자 프로필 조회
export async function GET(request: NextRequest) {
  try {
    console.log('GET /api/user-profiles called');

    const { data: profiles, error } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, name, role, email, is_active')
      .eq('is_active', true)
      .order('name', { ascending: true });

    if (error) {
      console.error('Supabase error:', error);
      throw error;
    }

    console.log(`Successfully fetched ${profiles?.length || 0} user profiles`);

    return NextResponse.json({
      success: true,
      profiles: profiles || [],
      count: profiles?.length || 0
    });

  } catch (error: any) {
    console.error('Error in GET /api/user-profiles:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch user profiles',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}