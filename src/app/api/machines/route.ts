import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// 입력값 검증 및 보안 함수들
const VALID_LOCATIONS = ['라인1', '라인2', '라인3', '라인4', 'A동', 'B동', 'C동', '조립라인', '검사라인', '포장라인'];
const VALID_STATES = ['NORMAL_OPERATION', 'MAINTENANCE', 'ERROR', 'IDLE', 'SETUP'];
const MAX_STRING_LENGTH = 100;

function validateStringInput(input: string | null, fieldName: string): string | null {
  if (!input) return null;
  
  // 길이 제한 검사
  if (input.length > MAX_STRING_LENGTH) {
    throw new Error(`${fieldName}는 ${MAX_STRING_LENGTH}자를 초과할 수 없습니다.`);
  }
  
  // 특수문자 필터링 (한글, 영문, 숫자, 일부 특수문자만 허용)
  const allowedPattern = /^[가-힣a-zA-Z0-9\s\-_]+$/;
  if (!allowedPattern.test(input.trim())) {
    throw new Error(`${fieldName}에 허용되지 않는 문자가 포함되어 있습니다.`);
  }
  
  return input.trim();
}

function validateLocation(location: string | null): string | null {
  if (!location) return null;
  
  const validatedLocation = validateStringInput(location, '위치');
  if (!validatedLocation) return null;
  
  // 화이트리스트 검증
  if (!VALID_LOCATIONS.includes(validatedLocation)) {
    throw new Error(`유효하지 않은 위치입니다. 허용된 위치: ${VALID_LOCATIONS.join(', ')}`);
  }
  
  return validatedLocation;
}

function validateCurrentState(state: string | null): string | null {
  if (!state) return null;
  
  if (!VALID_STATES.includes(state)) {
    throw new Error(`유효하지 않은 상태입니다. 허용된 상태: ${VALID_STATES.join(', ')}`);
  }
  
  return state;
}

// GET /api/machines - 모든 설비 목록 조회 (인증된 사용자용)
export async function GET(request: NextRequest) {
  try {
    console.log('GET /api/machines called');
    
    const { searchParams } = new URL(request.url);
    const isActive = searchParams.get('is_active');
    const locationParam = searchParams.get('location');
    const currentStateParam = searchParams.get('current_state');

    console.log('Raw query params:', { isActive, location: locationParam, currentState: currentStateParam });

    // 입력값 검증
    let validatedLocation: string | null = null;
    let validatedCurrentState: string | null = null;

    try {
      validatedLocation = validateLocation(locationParam);
      validatedCurrentState = validateCurrentState(currentStateParam);
    } catch (validationError) {
      console.error('Input validation error:', validationError);
      return NextResponse.json(
        { 
          success: false,
          error: '입력값 검증 실패',
          message: validationError instanceof Error ? validationError.message : 'Invalid input'
        },
        { status: 400 }
      );
    }

    console.log('Validated params:', { isActive, location: validatedLocation, currentState: validatedCurrentState });

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

    if (validatedLocation) {
      query = query.eq('location', validatedLocation);
    }

    if (validatedCurrentState) {
      query = query.eq('current_state', validatedCurrentState);
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
  } catch (error: unknown) {
    console.error('Error in GET /api/machines:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to fetch machines',
        message: error instanceof Error ? error.message : 'Unknown error',
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
      name: rawName,
      location: rawLocation,
      equipment_type: rawEquipmentType,
      is_active = true,
      current_state: rawCurrentState = 'NORMAL_OPERATION',
      production_model_id,
      current_process_id
    } = body;

    // 필수 필드 검증
    if (!rawName || !rawLocation) {
      return NextResponse.json(
        { 
          success: false, 
          error: '설비명과 위치는 필수 입력 항목입니다.' 
        },
        { status: 400 }
      );
    }

    // 입력값 검증 및 정제
    let name: string;
    let location: string;
    let equipment_type: string | null = null;
    let current_state: string;

    try {
      name = validateStringInput(rawName, '설비명') || '';
      location = validateLocation(rawLocation) || '';
      current_state = validateCurrentState(rawCurrentState) || 'NORMAL_OPERATION';
      
      if (rawEquipmentType) {
        equipment_type = validateStringInput(rawEquipmentType, '설비 유형');
      }

      if (!name || !location) {
        throw new Error('설비명과 위치는 필수 입력 항목입니다.');
      }
    } catch (validationError) {
      console.error('Input validation error:', validationError);
      return NextResponse.json(
        { 
          success: false,
          error: '입력값 검증 실패',
          message: validationError instanceof Error ? validationError.message : 'Invalid input'
        },
        { status: 400 }
      );
    }

    // 설비명 중복 확인
    const { data: existingMachine } = await supabaseAdmin
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
        equipment_type,
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

  } catch (error: unknown) {
    console.error('Error in POST /api/machines:', error);
    return NextResponse.json(
      { 
        success: false,
        error: '설비 추가 중 오류가 발생했습니다.',
        message: error instanceof Error ? error.message : 'Unknown error',
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
    const { data: relatedRecords } = await supabaseAdmin
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

  } catch (error: unknown) {
    console.error('Error in DELETE /api/machines:', error);
    return NextResponse.json(
      { 
        success: false,
        error: '설비 삭제 중 오류가 발생했습니다.',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}