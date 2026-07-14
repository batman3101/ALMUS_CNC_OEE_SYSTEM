import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { ApiAuthError, requireUser } from '@/lib/apiAuth';

// GET /api/admin/machines - 모든 설비 목록 조회 (활성/비활성 모두)
export async function GET() {
  try {
    // JOIN 쿼리를 사용한 단일 쿼리로 최적화 (N+1 쿼리 문제 해결)
    const { data: machines, error } = await supabaseAdmin
      .from('machines')
      .select(`
        *,
        product_models:production_model_id (
          model_name,
          description
        ),
        model_processes:current_process_id (
          process_name,
          tact_time_seconds
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    // 데이터를 기존 구조로 변환 (복잡한 Map 로직 제거)
    const transformedMachines = machines?.map(machine => {
      const model = machine.product_models;
      const process = machine.model_processes;
      
      return {
        ...machine,
        // 관계 데이터 제거 (중복 방지)
        product_models: undefined,
        model_processes: undefined,
        // 플랫 구조로 변환
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

// POST /api/admin/machines - 새 설비 생성 (관리자 전용)
export async function POST(request: NextRequest) {
  try {
    // 이 라우트는 서비스 롤(RLS 우회)로 동작하고 middleware 는 /api 를 건너뛰므로,
    // 세션·역할 검사를 하지 않으면 누구나 설비를 생성할 수 있다.
    await requireUser(request, ['admin']);

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
    if (error instanceof ApiAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error creating machine:', error);
    return NextResponse.json(
      { error: 'Failed to create machine' },
      { status: 500 }
    );
  }
}