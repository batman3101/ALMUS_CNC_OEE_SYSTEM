import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// GET /api/machines/[machineId] - 특정 설비 상세 정보 조회
export async function GET(
  request: NextRequest,
  { params }: { params: { machineId: string } }
) {
  try {
    const { machineId } = params;

    const { data: machine, error } = await supabaseAdmin
      .from('machines')
      .select('*')
      .eq('id', machineId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { error: 'Machine not found' },
          { status: 404 }
        );
      }
      throw error;
    }

    return NextResponse.json({ machine });
  } catch (error) {
    console.error('Error fetching machine:', error);
    return NextResponse.json(
      { error: 'Failed to fetch machine' },
      { status: 500 }
    );
  }
}

// PATCH /api/machines/[machineId] - 설비 상태 업데이트 (운영자용)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { machineId: string } }
) {
  try {
    const { machineId } = params;
    const body = await request.json();

    // 운영자가 업데이트할 수 있는 필드만 허용
    const allowedFields = ['current_state'];
    const updateData: any = {};

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: 'No valid fields to update' },
        { status: 400 }
      );
    }

    updateData.updated_at = new Date().toISOString();

    const { error } = await supabaseAdmin
      .from('machines')
      .update(updateData)
      .eq('id', machineId);

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      message: 'Machine updated successfully'
    });
  } catch (error) {
    console.error('Error updating machine:', error);
    return NextResponse.json(
      { error: 'Failed to update machine' },
      { status: 500 }
    );
  }
}