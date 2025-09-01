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

// POST /api/machines - 새 설비 추가
export async function POST(request: NextRequest) {
  try {
    console.log('POST /api/machines called');
    
    const body = await request.json();
    const {
      name,
      location,
      equipment_type,
      is_active = true,
      current_state = 'NORMAL_OPERATION',
      production_model_id,
      current_process_id
    } = body;

    // 필수 필드 검증
    if (!name || !location) {
      return NextResponse.json(
        { 
          success: false, 
          error: '설비명과 위치는 필수 입력 항목입니다.' 
        },
        { status: 400 }
      );
    }

    // 설비명 중복 확인
    const { data: existingMachine, error: checkError } = await supabaseAdmin
      .from('machines')
      .select('id, name')
      .eq('name', name)
      .single();

    if (existingMachine) {
      return NextResponse.json(
        { 
          success: false, 
          error: `이미 존재하는 설비명입니다: ${name}` 
        },
        { status: 409 }
      );
    }

    // 새 설비 추가
    const { data: newMachine, error: insertError } = await supabaseAdmin
      .from('machines')
      .insert({
        name,
        location,
        equipment_type: equipment_type || null,
        is_active,
        current_state,
        production_model_id: production_model_id || null,
        current_process_id: current_process_id || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
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
        updated_at
      `)
      .single();

    if (insertError) {
      console.error('Insert error:', insertError);
      
      // 중복 에러 처리
      if (insertError.code === '23505') {
        return NextResponse.json(
          { 
            success: false, 
            error: '설비명이 이미 존재합니다.' 
          },
          { status: 409 }
        );
      }
      
      throw insertError;
    }

    console.log('Successfully created new machine:', newMachine?.name);

    return NextResponse.json({
      success: true,
      message: '설비가 성공적으로 추가되었습니다.',
      machine: newMachine
    }, { status: 201 });

  } catch (error: any) {
    console.error('Error in POST /api/machines:', error);
    return NextResponse.json(
      { 
        success: false,
        error: '설비 추가 중 오류가 발생했습니다.',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}

// DELETE /api/machines - 설비 삭제 (여러 개 동시 삭제 가능)
export async function DELETE(request: NextRequest) {
  try {
    console.log('DELETE /api/machines called');
    
    const body = await request.json();
    const { machineIds } = body;

    // 필수 필드 검증
    if (!machineIds || !Array.isArray(machineIds) || machineIds.length === 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: '삭제할 설비 ID가 필요합니다.' 
        },
        { status: 400 }
      );
    }

    // 삭제 전 관련 데이터 확인 (생산 기록, 로그 등)
    const { data: relatedRecords, error: checkError } = await supabaseAdmin
      .from('production_records')
      .select('machine_id')
      .in('machine_id', machineIds)
      .limit(1);

    if (relatedRecords && relatedRecords.length > 0) {
      return NextResponse.json(
        { 
          success: false, 
          error: '생산 기록이 있는 설비는 삭제할 수 없습니다. 먼저 관련 데이터를 정리해주세요.' 
        },
        { status: 409 }
      );
    }

    // 설비 삭제 (소프트 삭제: is_active를 false로 변경)
    const { data: deletedMachines, error: deleteError } = await supabaseAdmin
      .from('machines')
      .update({ 
        is_active: false,
        updated_at: new Date().toISOString()
      })
      .in('id', machineIds)
      .select('id, name');

    if (deleteError) {
      console.error('Delete error:', deleteError);
      throw deleteError;
    }

    console.log(`Successfully deactivated ${deletedMachines?.length || 0} machines`);

    return NextResponse.json({
      success: true,
      message: `${deletedMachines?.length || 0}개의 설비가 비활성화되었습니다.`,
      machines: deletedMachines
    });

  } catch (error: any) {
    console.error('Error in DELETE /api/machines:', error);
    return NextResponse.json(
      { 
        success: false,
        error: '설비 삭제 중 오류가 발생했습니다.',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}