import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/admin/machines - 모든 설비 목록 조회 (활성/비활성 모두)
export async function GET() {
  try {
    // 기본 설비 정보 조회
    const { data: machines, error } = await supabaseAdmin
      .from('machines')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // 추가 정보 조회를 위한 별도 쿼리
    const machineIds = machines?.map(m => m.production_model_id).filter(Boolean) || [];
    const processIds = machines?.map(m => m.current_process_id).filter(Boolean) || [];

    const [modelsResult, processesResult] = await Promise.all([
      machineIds.length > 0 ? supabaseAdmin
        .from('product_models')
        .select('id, model_name, description')
        .in('id', machineIds) : Promise.resolve({ data: [] }),
      processIds.length > 0 ? supabaseAdmin
        .from('model_processes')
        .select('id, process_name, tact_time_seconds')
        .in('id', processIds) : Promise.resolve({ data: [] })
    ]);

    const modelsMap = new Map(modelsResult.data?.map(m => [m.id, m]) || []);
    const processesMap = new Map(processesResult.data?.map(p => [p.id, p]) || []);

    // 데이터를 기존 구조로 변환
    const transformedMachines = machines?.map(machine => {
      const model = modelsMap.get(machine.production_model_id);
      const process = processesMap.get(machine.current_process_id);
      
      return {
        ...machine,
        production_model_name: model?.model_name || null,
        production_model_description: model?.description || null,
        current_process_name: process?.process_name || null,
        current_tact_time: process?.tact_time_seconds || null
      };
    }) || [];

    return NextResponse.json({ machines: transformedMachines });
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