import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/production-records - 생산 기록 목록 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const shift = searchParams.get('shift');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '20');

    // 실제 구현에서는 production_records 테이블에서 데이터를 가져와야 함
    // 현재는 목업 데이터 반환
    const mockRecords = Array.from({ length: limit }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - index);
      
      return {
        id: `record_${Date.now()}_${index}`,
        machine_id: machineId || `machine_${index % 3 + 1}`,
        date: date.toISOString().split('T')[0],
        shift: ['A', 'B'][index % 2] as 'A' | 'B',
        output_qty: 100 + Math.floor(Math.random() * 50),
        defect_qty: Math.floor(Math.random() * 10),
        actual_runtime: 450 + Math.floor(Math.random() * 100),
        planned_runtime: 500,
        tact_time: 60 + Math.floor(Math.random() * 20),
        created_at: date.toISOString(),
        updated_at: date.toISOString()
      };
    });

    // 필터 적용
    let filteredRecords = mockRecords;

    if (machineId) {
      filteredRecords = filteredRecords.filter(record => record.machine_id === machineId);
    }

    if (startDate && endDate) {
      filteredRecords = filteredRecords.filter(record => 
        record.date >= startDate && record.date <= endDate
      );
    }

    if (shift) {
      filteredRecords = filteredRecords.filter(record => record.shift === shift);
    }

    // 페이지네이션
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedRecords = filteredRecords.slice(startIndex, endIndex);

    return NextResponse.json({
      records: paginatedRecords,
      pagination: {
        page,
        limit,
        total: filteredRecords.length,
        pages: Math.ceil(filteredRecords.length / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching production records:', error);
    return NextResponse.json(
      { error: 'Failed to fetch production records' },
      { status: 500 }
    );
  }
}

// POST /api/production-records - 새 생산 기록 생성
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      machine_id,
      date,
      shift,
      output_qty,
      defect_qty,
      actual_runtime,
      planned_runtime,
      tact_time
    } = body;

    // 필수 필드 검증
    if (!machine_id || !date || !shift) {
      return NextResponse.json(
        { error: 'Machine ID, date, and shift are required' },
        { status: 400 }
      );
    }

    // 설비 존재 확인
    const { data: machine, error: machineError } = await supabaseAdmin
      .from('machines')
      .select('id')
      .eq('id', machine_id)
      .single();

    if (machineError || !machine) {
      return NextResponse.json(
        { error: 'Machine not found' },
        { status: 404 }
      );
    }

    // 실제 구현에서는 production_records 테이블에 데이터 삽입
    // 현재는 목업 응답 반환
    const mockRecord = {
      id: `record_${Date.now()}`,
      machine_id,
      date,
      shift,
      output_qty: output_qty || 0,
      defect_qty: defect_qty || 0,
      actual_runtime: actual_runtime || 0,
      planned_runtime: planned_runtime || 500,
      tact_time: tact_time || 60,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    return NextResponse.json({
      success: true,
      record: mockRecord
    });
  } catch (error) {
    console.error('Error creating production record:', error);
    return NextResponse.json(
      { error: 'Failed to create production record' },
      { status: 500 }
    );
  }
}