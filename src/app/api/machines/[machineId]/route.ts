import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  applyMachineUpdate,
  machineUpdateErrorResponse,
  type MachineUpdates
} from '@/lib/machineUpdate';

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

  } catch (error: unknown) {
    console.error('Error in GET /api/machines/[machineId]:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch machine',
        message: errorMessage,
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

    const updates: MachineUpdates = {
      name,
      location,
      current_state,
      // PUT 은 전체 수정이므로 기존 동작대로 미지정 값은 명시적으로 비운다
      production_model_id: production_model_id || null,
      current_process_id: current_process_id || null
    };

    if (equipment_type !== undefined) {
      updates.equipment_type = equipment_type;
    }
    if (is_active !== undefined) {
      updates.is_active = is_active;
    }

    // 상태 변경에 따른 로그/이력 기록까지 RPC 안에서 원자적으로 처리된다
    const result = await applyMachineUpdate(
      params.machineId,
      updates,
      body.change_reason || null
    );

    const updatedMachine = result.machine as { name?: string } | null;
    console.log('Successfully updated machine:', updatedMachine?.name);

    return NextResponse.json({
      success: true,
      message: '설비 정보가 성공적으로 수정되었습니다',
      machine: result.machine
    });

  } catch (error: unknown) {
    const mapped = machineUpdateErrorResponse(error);
    if (mapped) return mapped;

    console.error('Error in PUT /api/machines/[machineId]:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update machine',
        message: errorMessage,
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

    // 운영 정보만 업데이트 허용 (요청에 포함된 키만 반영 -> 나머지는 DB 함수가 기존 값을 유지)
    const updates: MachineUpdates = {};

    if (current_state !== undefined) {
      updates.current_state = current_state;
    }
    if (production_model_id !== undefined) {
      updates.production_model_id = production_model_id;
    }
    if (current_process_id !== undefined) {
      updates.current_process_id = current_process_id;
    }

    if (Object.keys(updates).length === 0) {
      console.log('PATCH error: No valid fields to update');
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    // 상태 변경에 따른 로그/이력 기록까지 RPC 안에서 원자적으로 처리된다
    const result = await applyMachineUpdate(
      params.machineId,
      updates,
      body.change_reason || null
    );

    const updatedMachine = result.machine as { name?: string } | null;
    console.log('Successfully updated machine operational info:', updatedMachine?.name);

    return NextResponse.json({
      success: true,
      message: '설비 운영 정보가 성공적으로 수정되었습니다',
      machine: result.machine
    });

  } catch (error: unknown) {
    const mapped = machineUpdateErrorResponse(error);
    if (mapped) return mapped;

    console.error('Error updating machine:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update machine',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}
