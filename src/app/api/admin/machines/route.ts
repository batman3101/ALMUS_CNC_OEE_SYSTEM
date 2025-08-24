import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/admin/machines - 모든 설비 목록 조회
export async function GET() {
  try {
    const { data: machines, error } = await supabaseAdmin
      .from('machines_with_production_info')
      .select('*')
      .order('created_at', { ascending: false });

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

// POST /api/admin/machines - 새 설비 생성
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, location, equipment_type, production_model_id, current_process_id, is_active } = body;

    const { data: machine, error } = await supabaseAdmin
      .from('machines')
      .insert([{
        name,
        location,
        equipment_type,
        production_model_id,
        current_process_id,
        is_active: is_active !== undefined ? is_active : true,
        current_state: 'NORMAL_OPERATION'
      }])
      .select()
      .single();

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      machine
    });
  } catch (error) {
    console.error('Error creating machine:', error);
    return NextResponse.json(
      { error: 'Failed to create machine' },
      { status: 500 }
    );
  }
}