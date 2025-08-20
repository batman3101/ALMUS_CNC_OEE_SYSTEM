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

    // production_records 테이블이 없으므로 목업 데이터 반환
    // 실제 구현에서는 production_records 테이블에서 데이터를 가져와야 함
    const mockProductionData = [
      {
        id: `prod_${Date.now()}_1`,
        machine_id: machineId,
        date: new Date().toISOString().split('T')[0],
        shift: 'A',
        output_qty: 120,
        defect_qty: 3,
        actual_runtime: 480,
        planned_runtime: 500,
        created_at: new Date().toISOString()
      },
      {
        id: `prod_${Date.now()}_2`,
        machine_id: machineId,
        date: new Date(Date.now() - 86400000).toISOString().split('T')[0],
        shift: 'B',
        output_qty: 115,
        defect_qty: 2,
        actual_runtime: 470,
        planned_runtime: 500,
        created_at: new Date(Date.now() - 86400000).toISOString()
      }
    ];

    // 필터 적용
    let filteredData = mockProductionData;

    if (startDate && endDate) {
      filteredData = filteredData.filter(record => 
        record.date >= startDate && record.date <= endDate
      );
    }

    if (shift) {
      filteredData = filteredData.filter(record => record.shift === shift);
    }

    return NextResponse.json({ 
      production_records: filteredData,
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