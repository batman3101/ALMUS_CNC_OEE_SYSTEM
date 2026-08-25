import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse } from '@/lib/apiAuth';
import { requireFactoryUser } from '@/lib/factoryAuth';

// GET /api/admin/machines - 모든 설비 목록 조회 (활성/비활성 모두)
export async function GET(request: NextRequest) {
  try {
    const authenticatedUser = await requireFactoryUser(request, ['admin', 'engineer']);

    // JOIN 쿼리를 사용한 단일 쿼리로 최적화 (N+1 쿼리 문제 해결)
    const { data: machines, error } = await supabaseAdmin
      .from('machines')
      .select(`
        *,
        product_models:product_models!machines_factory_production_model_fkey (
          model_name,
          description
        ),
        model_processes:model_processes!machines_factory_current_process_fkey (
          process_name,
          tact_time_seconds
        )
      `)
      .eq('factory_id', authenticatedUser.factoryId)
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
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

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
    const authenticatedUser = await requireFactoryUser(request, ['admin', 'engineer']);

    const body = await request.json();
    const { name, location, equipment_type, production_model_id, current_process_id, is_active } = body;

    const { data: machine, error } = await supabaseAdmin
      .from('machines')
      .insert([{
        // 공장은 요청이 아니라 세션에서 온다. body 에 factory_id 가 있어도 무시한다 —
        // 요청이 전달한 공장을 믿는 순간 인가는 사라진다.
        factory_id: authenticatedUser.factoryId,
        name,
        location,
        equipment_type,
        production_model_id,
        current_process_id,
        is_active: is_active !== undefined ? is_active : true,
        current_state: 'NORMAL_OPERATION'
      }])
      // production_model_id / current_process_id 는 body 에서 온다. 다른 공장의 모델을
      // 가리키면 복합 FK `(factory_id, production_model_id)` 가 DB 에서 거부한다
      // (20260821110000). 여기서 다시 확인하지 않는 이유는, 검사와 쓰기 사이가 비어 있는
      // 애플리케이션 검사보다 제약이 더 강하기 때문이다.
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
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error creating machine:', error);
    return NextResponse.json(
      { error: 'Failed to create machine' },
      { status: 500 }
    );
  }
}
