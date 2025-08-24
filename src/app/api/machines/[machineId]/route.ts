import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/machines/[machineId] - 특정 설비 상세 정보 조회
export async function GET(
  request: NextRequest,
  { params }: { params: { machineId: string } }
) {
  try {
    console.log('GET /api/machines/[machineId] called with id:', params.machineId);

    const { data: machine, error } = await supabaseAdmin
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
      .eq('id', params.machineId)
      .single();

    if (error) {
      console.error('Supabase error:', error);
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { success: false, error: 'Machine not found' },
          { status: 404 }
        );
      }
      throw error;
    }

    console.log('Successfully fetched machine:', machine?.name);

    return NextResponse.json({
      success: true,
      machine: machine
    });

  } catch (error: any) {
    console.error('Error in GET /api/machines/[machineId]:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch machine',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}

// PUT /api/machines/[machineId] - 설비 정보 수정
export async function PUT(
  request: NextRequest,
  { params }: { params: { machineId: string } }
) {
  try {
    console.log('PUT /api/machines/[machineId] called with id:', params.machineId);

    const body = await request.json();
    const {
      name,
      location,
      equipment_type,
      is_active,
      current_state,
      production_model_id,
      current_process_id
    } = body;

    // 필수 필드 검증
    if (!name || !location || !current_state) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Name, location, and current_state are required' 
        },
        { status: 400 }
      );
    }

    // 설비 존재 확인
    const { data: existingMachine, error: checkError } = await supabaseAdmin
      .from('machines')
      .select('id')
      .eq('id', params.machineId)
      .single();

    if (checkError || !existingMachine) {
      return NextResponse.json(
        { success: false, error: 'Machine not found' },
        { status: 404 }
      );
    }

    // 설비 정보 업데이트
    const { data: updatedMachine, error: updateError } = await supabaseAdmin
      .from('machines')
      .update({
        name,
        location,
        equipment_type,
        is_active,
        current_state,
        production_model_id: production_model_id || null,
        current_process_id: current_process_id || null,
        updated_at: new Date().toISOString()
      })
      .eq('id', params.machineId)
      .select()
      .single();

    if (updateError) {
      console.error('Update error:', updateError);
      throw updateError;
    }

    console.log('Successfully updated machine:', updatedMachine?.name);

    return NextResponse.json({
      success: true,
      message: '설비 정보가 성공적으로 수정되었습니다',
      machine: updatedMachine
    });

  } catch (error: any) {
    console.error('Error in PUT /api/machines/[machineId]:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update machine',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}

// PATCH /api/machines/[machineId] - 설비 운영 정보 업데이트
export async function PATCH(
  request: NextRequest,
  { params }: { params: { machineId: string } }
) {
  try {
    console.log('PATCH /api/machines/[machineId] called with id:', params.machineId);
    
    const body = await request.json();
    const { current_state, production_model_id, current_process_id } = body;

    // 운영 정보만 업데이트 허용
    const updateData: any = {};
    
    if (current_state !== undefined) {
      updateData.current_state = current_state;
    }
    if (production_model_id !== undefined) {
      updateData.production_model_id = production_model_id;
    }
    if (current_process_id !== undefined) {
      updateData.current_process_id = current_process_id;
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    updateData.updated_at = new Date().toISOString();

    // 설비 존재 확인
    const { data: existingMachine, error: checkError } = await supabaseAdmin
      .from('machines')
      .select('id')
      .eq('id', params.machineId)
      .single();

    if (checkError || !existingMachine) {
      return NextResponse.json(
        { success: false, error: 'Machine not found' },
        { status: 404 }
      );
    }

    // 업데이트 실행
    const { data: updatedMachine, error: updateError } = await supabaseAdmin
      .from('machines')
      .update(updateData)
      .eq('id', params.machineId)
      .select()
      .single();

    if (updateError) {
      console.error('Update error:', updateError);
      throw updateError;
    }

    console.log('Successfully updated machine operational info:', updatedMachine?.name);

    return NextResponse.json({
      success: true,
      message: '설비 운영 정보가 성공적으로 수정되었습니다',
      machine: updatedMachine
    });
    
  } catch (error: any) {
    console.error('Error updating machine:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update machine',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}