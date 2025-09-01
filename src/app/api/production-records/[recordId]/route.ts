import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/production-records/[recordId] - 특정 생산 기록 조회
export async function GET(
  request: NextRequest,
  { params }: { params: { recordId: string } }
) {
  try {
    console.log('GET /api/production-records/[recordId] called with id:', params.recordId);

    const { data: record, error } = await supabaseAdmin
      .from('production_records')
      .select(`
        record_id,
        machine_id,
        date,
        shift,
        planned_runtime,
        actual_runtime,
        ideal_runtime,
        output_qty,
        defect_qty,
        availability,
        performance,
        quality,
        oee,
        created_at,
        machines:machine_id (
          id,
          name,
          location,
          equipment_type
        )
      `)
      .eq('record_id', params.recordId)
      .single();

    if (error) {
      console.error('Supabase error:', error);
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { success: false, error: 'Production record not found' },
          { status: 404 }
        );
      }
      throw error;
    }

    console.log('Successfully fetched production record:', record?.record_id);

    return NextResponse.json({
      success: true,
      record: record
    });

  } catch (error: any) {
    console.error('Error in GET /api/production-records/[recordId]:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch production record',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}

// PUT /api/production-records/[recordId] - 생산 기록 수정
export async function PUT(
  request: NextRequest,
  { params }: { params: { recordId: string } }
) {
  try {
    console.log('PUT /api/production-records/[recordId] called with id:', params.recordId);

    const body = await request.json();
    console.log('PUT request body:', JSON.stringify(body, null, 2));

    const {
      output_qty,
      defect_qty,
      actual_runtime,
      planned_runtime,
      availability,
      performance,
      quality,
      oee
    } = body;

    // 생산 기록 존재 확인
    const { data: existingRecord, error: checkError } = await supabaseAdmin
      .from('production_records')
      .select('record_id, machine_id, date, shift')
      .eq('record_id', params.recordId)
      .single();

    if (checkError || !existingRecord) {
      return NextResponse.json(
        { success: false, error: 'Production record not found' },
        { status: 404 }
      );
    }

    // 업데이트할 데이터 구성
    const updateData: any = {};
    if (output_qty !== undefined) updateData.output_qty = output_qty;
    if (defect_qty !== undefined) updateData.defect_qty = defect_qty;
    if (actual_runtime !== undefined) updateData.actual_runtime = actual_runtime;
    if (planned_runtime !== undefined) updateData.planned_runtime = planned_runtime;
    if (availability !== undefined) updateData.availability = availability;
    if (performance !== undefined) updateData.performance = performance;
    if (quality !== undefined) updateData.quality = quality;
    if (oee !== undefined) updateData.oee = oee;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    // 생산 기록 업데이트
    const { data: updatedRecord, error: updateError } = await supabaseAdmin
      .from('production_records')
      .update(updateData)
      .eq('record_id', params.recordId)
      .select()
      .single();

    if (updateError) {
      console.error('Update error:', updateError);
      throw updateError;
    }

    console.log('Successfully updated production record:', updatedRecord?.record_id);

    return NextResponse.json({
      success: true,
      message: '생산 기록이 성공적으로 수정되었습니다',
      record: updatedRecord
    });

  } catch (error: any) {
    console.error('Error in PUT /api/production-records/[recordId]:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update production record',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}

// DELETE /api/production-records/[recordId] - 생산 기록 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: { recordId: string } }
) {
  try {
    console.log('DELETE /api/production-records/[recordId] called with id:', params.recordId);

    // 생산 기록 존재 확인
    const { data: existingRecord, error: checkError } = await supabaseAdmin
      .from('production_records')
      .select('record_id, machine_id, date, shift, output_qty')
      .eq('record_id', params.recordId)
      .single();

    if (checkError || !existingRecord) {
      console.error('Production record not found:', checkError);
      return NextResponse.json(
        { success: false, error: 'Production record not found' },
        { status: 404 }
      );
    }

    // 생산 기록 삭제 (하드 삭제)
    const { error: deleteError } = await supabaseAdmin
      .from('production_records')
      .delete()
      .eq('record_id', params.recordId);

    if (deleteError) {
      console.error('Delete error:', deleteError);
      throw deleteError;
    }

    console.log('Successfully deleted production record:', params.recordId);

    return NextResponse.json({
      success: true,
      message: '생산 기록이 성공적으로 삭제되었습니다',
      deleted_record: {
        record_id: existingRecord.record_id,
        machine_id: existingRecord.machine_id,
        date: existingRecord.date,
        shift: existingRecord.shift,
        output_qty: existingRecord.output_qty
      }
    });

  } catch (error: any) {
    console.error('Error in DELETE /api/production-records/[recordId]:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete production record',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}

// PATCH /api/production-records/[recordId] - 생산 기록 부분 수정
export async function PATCH(
  request: NextRequest,
  { params }: { params: { recordId: string } }
) {
  try {
    console.log('PATCH /api/production-records/[recordId] called with id:', params.recordId);

    const body = await request.json();
    console.log('PATCH request body:', JSON.stringify(body, null, 2));

    // 생산 기록 존재 확인
    const { data: existingRecord, error: checkError } = await supabaseAdmin
      .from('production_records')
      .select('record_id, machine_id, date, shift')
      .eq('record_id', params.recordId)
      .single();

    if (checkError || !existingRecord) {
      return NextResponse.json(
        { success: false, error: 'Production record not found' },
        { status: 404 }
      );
    }

    // 업데이트할 데이터 구성 (모든 필드 허용)
    const updateData: any = {};
    const allowedFields = [
      'output_qty', 'defect_qty', 'actual_runtime', 'planned_runtime',
      'availability', 'performance', 'quality', 'oee'
    ];

    allowedFields.forEach(field => {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    });

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { success: false, error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    // 생산 기록 부분 업데이트
    const { data: updatedRecord, error: updateError } = await supabaseAdmin
      .from('production_records')
      .update(updateData)
      .eq('record_id', params.recordId)
      .select()
      .single();

    if (updateError) {
      console.error('PATCH update error:', updateError);
      throw updateError;
    }

    console.log('Successfully patched production record:', updatedRecord?.record_id);

    return NextResponse.json({
      success: true,
      message: '생산 기록이 성공적으로 부분 수정되었습니다',
      record: updatedRecord,
      updated_fields: Object.keys(updateData)
    });

  } catch (error: any) {
    console.error('Error in PATCH /api/production-records/[recordId]:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to patch production record',
        message: error.message,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}