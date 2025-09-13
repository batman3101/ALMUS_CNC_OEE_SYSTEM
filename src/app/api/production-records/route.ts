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
    const limit = parseInt(searchParams.get('limit') || '100');

    // 기본 쿼리 생성
    let query = supabaseAdmin
      .from('production_records')
      .select(`
        *,
        machines!inner(
          id,
          name,
          location
        )
      `, { count: 'exact' })
      .order('date', { ascending: false });

    // 필터 적용
    if (machineId) {
      query = query.eq('machine_id', machineId);
    }

    if (startDate) {
      query = query.gte('date', startDate);
    }

    if (endDate) {
      query = query.lte('date', endDate);
    }

    if (shift) {
      query = query.eq('shift', shift);
    }

    // 페이지네이션 적용
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data: records, error, count } = await query;

    if (error) {
      console.error('Error fetching production records:', error);
      
      // 테이블이 없는 경우 빈 배열 반환
      if (error.code === '42P01') {
        return NextResponse.json({
          records: [],
          pagination: {
            page,
            limit,
            total: 0,
            pages: 0
          }
        });
      }
      
      throw error;
    }

    // 데이터가 없으면 빈 배열 반환 (Mock 데이터 생성 금지)
    if (!records || records.length === 0) {
      return NextResponse.json({
        records: [],
        pagination: {
          page,
          limit,
          total: 0,
          pages: 0
        }
      });
    }

    // 실제 데이터 형식 맞추기
    const formattedRecords = records.map(record => ({
      record_id: record.id,
      machine_id: record.machine_id,
      date: record.date,
      shift: record.shift,
      output_qty: record.output_qty || 0,
      defect_qty: record.defect_qty || 0,
      created_at: record.created_at,
      machine: record.machines
    }));

    return NextResponse.json({
      records: formattedRecords,
      pagination: {
        page,
        limit,
        total: count || 0,
        pages: Math.ceil((count || 0) / limit)
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

    // OEE 계산
    const plannedRuntimeValue = planned_runtime || 480; // 기본 8시간
    const actualRuntimeValue = actual_runtime || 0;
    const outputQtyValue = output_qty || 0;
    const defectQtyValue = defect_qty || 0;
    const tactTimeValue = tact_time || 120; // 기본 2분

    // Availability = (Actual Runtime / Planned Runtime)
    const availability = plannedRuntimeValue > 0 ? actualRuntimeValue / plannedRuntimeValue : 0;
    
    // Performance = (Output Qty * Tact Time) / Actual Runtime
    const idealRuntime = outputQtyValue * tactTimeValue / 60; // 분 단위 변환
    const performance = actualRuntimeValue > 0 ? idealRuntime / actualRuntimeValue : 0;
    
    // Quality = (Output Qty - Defect Qty) / Output Qty
    const quality = outputQtyValue > 0 ? (outputQtyValue - defectQtyValue) / outputQtyValue : 0;
    
    // OEE = Availability × Performance × Quality
    const oee = availability * performance * quality;

    // production_records 테이블에 실제 데이터 삽입
    const { data: newRecord, error: insertError } = await supabaseAdmin
      .from('production_records')
      .insert({
        machine_id,
        date,
        shift,
        planned_runtime: plannedRuntimeValue,
        actual_runtime: actualRuntimeValue,
        ideal_runtime: Math.round(idealRuntime),
        output_qty: outputQtyValue,
        defect_qty: defectQtyValue,
        availability: Math.round(availability * 10000) / 10000, // 소수점 4자리
        performance: Math.round(performance * 10000) / 10000,
        quality: Math.round(quality * 10000) / 10000,
        oee: Math.round(oee * 10000) / 10000
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting production record:', insertError);
      throw insertError;
    }

    return NextResponse.json({
      success: true,
      record: newRecord
    });
  } catch (error) {
    console.error('Error creating production record:', error);
    return NextResponse.json(
      { error: 'Failed to create production record' },
      { status: 500 }
    );
  }
}