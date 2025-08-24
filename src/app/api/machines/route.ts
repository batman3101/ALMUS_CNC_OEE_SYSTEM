import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/machines - 모든 설비 목록 조회 (인증된 사용자용)
export async function GET(request: NextRequest) {
  try {
    console.log('GET /api/machines called');
    
    const { searchParams } = new URL(request.url);
    const isActive = searchParams.get('is_active');
    const location = searchParams.get('location');
    const currentState = searchParams.get('current_state');

    console.log('Query params:', { isActive, location, currentState });

    let query = supabaseAdmin
      .from('machines')
      .select(`
        id,
        name,
        location,
        equipment_type,
        is_active,
        current_state,
        production_model_id,
        current_process_id,
        created_at,
        updated_at,
        product_models:production_model_id (
          id,
          model_name,
          description
        ),
        model_processes:current_process_id (
          id,
          process_name,
          process_order,
          tact_time_seconds
        )
      `)
      .order('name', { ascending: true });

    // 기본적으로 활성화된 설비만 조회
    if (isActive !== 'false') {
      query = query.eq('is_active', true);
    }

    if (location) {
      query = query.eq('location', location);
    }

    if (currentState) {
      query = query.eq('current_state', currentState);
    }

    console.log('Executing query...');
    const { data: machines, error } = await query;

    if (error) {
      console.error('Supabase query error:', error);
      throw error;
    }

    console.log(`Successfully fetched ${machines?.length || 0} machines`);

    return NextResponse.json({ 
      success: true,
      machines: machines || [],
      count: machines?.length || 0
    });
  } catch (error: any) {
    console.error('Error in GET /api/machines:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to fetch machines',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}