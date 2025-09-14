import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/machines/[machineId]/production - 특정 설비의 생산 데이터 조회
export async function GET(
  request: NextRequest,
  { params }: { params: { machineId: string } }
) {
  try {
    const { machineId } = params;
    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const shift = searchParams.get('shift');

    // 설비 존재 확인
    const { data: machine, error: machineError } = await supabaseAdmin
      .from('machines')
      .select('id')
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
    console.error('Error fetching production data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch production data' },
      { status: 500 }
    );
  }
}