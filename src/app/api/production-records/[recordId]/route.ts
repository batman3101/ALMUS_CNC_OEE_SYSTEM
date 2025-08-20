import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/production-records/[recordId] - 특정 생산 기록 조회
export async function GET(
  request: NextRequest,
  { params }: { params: { recordId: string } }
) {
  try {
    const { recordId } = params;

    // 실제 구현에서는 production_records 테이블에서 데이터를 가져와야 함
    // 현재는 목업 데이터 반환
    const mockRecord = {
      id: recordId,
      machine_id: 'machine_1',
      date: new Date().toISOString().split('T')[0],
      shift: 'A' as const,
      output_qty: 120,
      defect_qty: 3,
      actual_runtime: 480,
      planned_runtime: 500,
      tact_time: 65,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    return NextResponse.json({ record: mockRecord });
  } catch (error) {
    console.error('Error fetching production record:', error);
    return NextResponse.json(
      { error: 'Failed to fetch production record' },
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
    const { recordId } = params;
    const body = await request.json();

    // 실제 구현에서는 production_records 테이블 업데이트
    // 현재는 목업 응답 반환
    const updatedRecord = {
      id: recordId,
      ...body,
      updated_at: new Date().toISOString()
    };

    return NextResponse.json({
      success: true,
      record: updatedRecord
    });
  } catch (error) {
    console.error('Error updating production record:', error);
    return NextResponse.json(
      { error: 'Failed to update production record' },
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
    const { recordId } = params;

    // 실제 구현에서는 production_records 테이블에서 삭제
    // 현재는 목업 응답 반환
    return NextResponse.json({
      success: true,
      message: 'Production record deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting production record:', error);
    return NextResponse.json(
      { error: 'Failed to delete production record' },
      { status: 500 }
    );
  }
}