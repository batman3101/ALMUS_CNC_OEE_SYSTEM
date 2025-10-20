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

    // 설비 존재 확인 및 현재 상태 조회
    const { data: existingMachine, error: checkError } = await supabaseAdmin
      .from('machines')
      .select('id, current_state, updated_at')
      .eq('id', params.machineId)
      .single();

    if (checkError || !existingMachine) {
      return NextResponse.json(
        { success: false, error: 'Machine not found' },
        { status: 404 }
      );
    }

    // 상태가 변경되는 경우 이력 저장
    if (existingMachine.current_state !== current_state) {
      // 이전 상태의 지속 시간 계산 (분 단위)
      const previousUpdatedAt = new Date(existingMachine.updated_at);
      const currentTime = new Date();
      const durationMinutes = Math.floor((currentTime.getTime() - previousUpdatedAt.getTime()) / (1000 * 60));

      // 상태 변경 이력 저장
      const { error: historyError } = await supabaseAdmin
        .from('machine_status_history')
        .insert({
          machine_id: params.machineId,
          previous_status: existingMachine.current_state,
          new_status: current_state,
          changed_by: null, // TODO: 실제 사용자 ID 추가 필요
          change_reason: body.change_reason || null,
          duration_minutes: durationMinutes,
          created_at: new Date().toISOString()
        });

      if (historyError) {
        console.error('Failed to save status history:', historyError);
        // 이력 저장 실패해도 업데이트는 계속 진행
      } else {
        console.log(`Status history saved: ${existingMachine.current_state} -> ${current_state}`);
      }
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
    console.log('PATCH request body:', JSON.stringify(body, null, 2));
    
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
      console.log('PATCH error: No valid fields to update');
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    updateData.updated_at = new Date().toISOString();
    console.log('PATCH updateData:', JSON.stringify(updateData, null, 2));

    // 설비 존재 확인 및 현재 상태 조회
    const { data: existingMachine, error: checkError } = await supabaseAdmin
      .from('machines')
      .select('id, current_state, updated_at')
      .eq('id', params.machineId)
      .single();

    if (checkError || !existingMachine) {
      return NextResponse.json(
        { success: false, error: 'Machine not found' },
        { status: 404 }
      );
    }

    // 상태가 변경되는 경우 이력 저장
    if (current_state && existingMachine.current_state !== current_state) {
      // 이전 상태의 지속 시간 계산 (분 단위)
      const previousUpdatedAt = new Date(existingMachine.updated_at);
      const currentTime = new Date();
      const durationMinutes = Math.floor((currentTime.getTime() - previousUpdatedAt.getTime()) / (1000 * 60));

      // 이전 상태 종료를 위한 machine_logs 업데이트
      const { error: logUpdateError } = await supabaseAdmin
        .from('machine_logs')
        .update({
          end_time: currentTime.toISOString(),
          duration: durationMinutes
        })
        .eq('machine_id', params.machineId)
        .eq('state', existingMachine.current_state)
        .is('end_time', null);

      if (logUpdateError) {
        console.error('Failed to update machine_logs:', logUpdateError);
      }

      // 새로운 상태 시작을 위한 machine_logs 삽입
      const { error: logInsertError } = await supabaseAdmin
        .from('machine_logs')
        .insert({
          machine_id: params.machineId,
          state: current_state,
          start_time: currentTime.toISOString(),
          end_time: null,
          duration: null,
          created_at: currentTime.toISOString()
        });

      if (logInsertError) {
        console.error('Failed to insert machine_logs:', logInsertError);
      } else {
        console.log(`Machine log inserted: ${current_state} started at ${currentTime.toISOString()}`);
      }

      // 상태 변경 이력 저장
      const { error: historyError } = await supabaseAdmin
        .from('machine_status_history')
        .insert({
          machine_id: params.machineId,
          previous_status: existingMachine.current_state,
          new_status: current_state,
          changed_by: null, // TODO: 실제 사용자 ID 추가 필요
          change_reason: body.change_reason || null,
          duration_minutes: durationMinutes,
          created_at: new Date().toISOString()
        });

      if (historyError) {
        console.error('Failed to save status history:', historyError);
        // 이력 저장 실패해도 업데이트는 계속 진행
      } else {
        console.log(`Status history saved: ${existingMachine.current_state} -> ${current_state}`);
      }
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