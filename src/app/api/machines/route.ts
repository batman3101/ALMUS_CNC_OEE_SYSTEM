import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/machines - 모든 설비 목록 조회 (인증된 사용자용)
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const isActive = searchParams.get('is_active');
    const location = searchParams.get('location');
    const currentState = searchParams.get('current_state');

    let query = supabaseAdmin
      .from('machines')
      .select('*')
      .order('created_at', { ascending: false });

    // 필터 적용
    if (isActive !== null) {
      query = query.eq('is_active', isActive === 'true');
    }

    if (location) {
      query = query.eq('location', location);
    }

    if (currentState) {
      query = query.eq('current_state', currentState);
    }

    const { data: machines, error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({ machines: machines || [] });
  } catch (error) {
    console.error('Error fetching machines:', error);
    return NextResponse.json(
      { error: 'Failed to fetch machines' },
      { status: 500 }
    );
  }
}