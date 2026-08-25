import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse } from '@/lib/apiAuth';
import { assertFactoryMachineAccess, requireFactoryUser } from '@/lib/factoryAuth';

// GET /api/machines/[machineId]/production - 특정 설비의 생산 데이터 조회
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  try {
    const { machineId } = await params;
    const authenticatedUser = await requireFactoryUser(request, ['admin', 'engineer', 'operator']);
    assertFactoryMachineAccess(authenticatedUser, machineId);
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const shift = searchParams.get('shift');

    // 설비 존재 확인
    const { data: machine, error: machineError } = await supabaseAdmin
      .from('machines')
      .select('id')
      // 이 공장의 설비가 아니면 **없는 것**이다 (403 은 남의 공장 id 의 존재를 알려 준다).
      .eq('factory_id', authenticatedUser.factoryId)
      .eq('id', machineId)
      .single();

    if (machineError || !machine) {
      return NextResponse.json(
        { error: 'Machine not found' },
        { status: 404 }
      );
    }

    // production_records 테이블에서 실제 데이터 조회
    let query = supabaseAdmin
      .from('production_records')
      .select('*')
      // 설비를 확인했더라도 자식 조회에 공장을 다시 건다 — machine_id 는 요청이 준 값이고,
      // 위 확인과 이 조회는 서로 다른 문장이다.
      .eq('factory_id', authenticatedUser.factoryId)
      .eq('machine_id', machineId);

    // 날짜 필터 적용
    if (startDate && endDate) {
      query = query.gte('date', startDate).lte('date', endDate);
    }

    // 교대 필터 적용
    if (shift) {
      query = query.eq('shift', shift);
    }

    // 최신 순으로 정렬
    query = query.order('date', { ascending: false });

    const { data: productionRecords, error: productionError } = await query;

    if (productionError) {
      console.error('Error fetching production records:', productionError);
      return NextResponse.json(
        { error: 'Failed to fetch production records' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      production_records: productionRecords || [],
      machine_id: machineId
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error fetching production data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch production data' },
      { status: 500 }
    );
  }
}
