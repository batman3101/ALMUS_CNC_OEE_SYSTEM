import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// PUT /api/admin/machines/[machineId] - 설비 정보 수정
export async function PUT(
  request: NextRequest,
  { params }: { params: { machineId: string } }
) {
  try {
    const { machineId } = params;
    const body = await request.json();

    const { error } = await supabaseAdmin
      .from('machines')
      .update({
        ...body,
        updated_at: new Date().toISOString()
      })
      .eq('id', machineId);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error updating machine:', error);
    return NextResponse.json(
      { error: 'Failed to update machine' },
      { status: 500 }
    );
  }
}

// DELETE /api/admin/machines/[machineId] - 설비 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: { machineId: string } }
) {
  try {
    const { machineId } = params;

    const { error } = await supabaseAdmin
      .from('machines')
      .delete()
      .eq('id', machineId);

    if (error) {
      throw error;
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting machine:', error);
    return NextResponse.json(
      { error: 'Failed to delete machine' },
      { status: 500 }
    );
  }
}