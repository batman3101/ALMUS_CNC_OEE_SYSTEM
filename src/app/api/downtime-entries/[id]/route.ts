import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

// DELETE /api/downtime-entries/[id] - 비가동 시간 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    console.log('DELETE /api/downtime-entries/[id] called, id:', id);

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: 'Downtime entry ID is required'
        },
        { status: 400 }
      );
    }

    // 삭제 전 존재 확인
    const { data: existingEntry, error: fetchError } = await supabaseAdmin
      .from('downtime_entries')
      .select('id, machine_id')
      .eq('id', id)
      .single();

    if (fetchError || !existingEntry) {
      console.error('Downtime entry not found:', fetchError);
      return NextResponse.json(
        {
          success: false,
          error: 'Downtime entry not found'
        },
        { status: 404 }
      );
    }

    // 비가동 데이터 삭제
    const { error: deleteError } = await supabaseAdmin
      .from('downtime_entries')
      .delete()
      .eq('id', id);

    if (deleteError) {
      console.error('Error deleting downtime entry:', deleteError);
      throw new Error(`비가동 시간 삭제 실패: ${deleteError.message}`);
    }

    console.log('Downtime entry deleted successfully:', id);

    // 성공 응답
    return NextResponse.json({
      success: true,
      message: '비가동 시간이 성공적으로 삭제되었습니다',
      deleted_id: id
    });

  } catch (error: unknown) {
    console.error('Error in DELETE /api/downtime-entries/[id]:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to delete downtime entry',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}

// PATCH /api/downtime-entries/[id] - 비가동 시간 수정 (선택사항)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { id } = params;
    console.log('PATCH /api/downtime-entries/[id] called, id:', id);

    if (!id) {
      return NextResponse.json(
        {
          success: false,
          error: 'Downtime entry ID is required'
        },
        { status: 400 }
      );
    }

    const body = await request.json();
    console.log('Update data:', body);

    // 수정 가능한 필드만 추출
    const updateData: Record<string, unknown> = {};
    if (body.start_time) updateData.start_time = body.start_time;
    if (body.end_time) updateData.end_time = body.end_time;
    if (body.reason) updateData.reason = body.reason;
    if (body.description !== undefined) updateData.description = body.description;

    // duration_minutes 재계산 - 음수 방지
    if (body.start_time || body.end_time) {
      // 기존 데이터 조회
      const { data: existingEntry } = await supabaseAdmin
        .from('downtime_entries')
        .select('start_time, end_time')
        .eq('id', id)
        .single();

      if (existingEntry) {
        const startTimeValue = body.start_time || existingEntry.start_time;
        const endTimeValue = body.end_time || existingEntry.end_time;

        if (!endTimeValue) {
          return NextResponse.json(
            {
              success: false,
              error: 'end_time is required to recalculate duration'
            },
            { status: 400 }
          );
        }

        const startTime = new Date(startTimeValue);
        const endTime = new Date(endTimeValue);

        if (Number.isNaN(startTime.getTime()) || Number.isNaN(endTime.getTime())) {
          return NextResponse.json(
            {
              success: false,
              error: 'start_time and end_time must be valid date-times'
            },
            { status: 400 }
          );
        }

        if (endTime.getTime() < startTime.getTime()) {
          return NextResponse.json(
            {
              success: false,
              error: '종료 시간은 시작 시간보다 빠를 수 없습니다'
            },
            { status: 400 }
          );
        }

        updateData.duration_minutes = Math.round(
          (endTime.getTime() - startTime.getTime()) / (1000 * 60)
        );
      }
    }

    // 업데이트 실행
    const { data: updatedEntry, error: updateError } = await supabaseAdmin
      .from('downtime_entries')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (updateError) {
      console.error('Error updating downtime entry:', updateError);
      throw new Error(`비가동 시간 수정 실패: ${updateError.message}`);
    }

    console.log('Downtime entry updated successfully:', id);

    // 성공 응답
    return NextResponse.json({
      success: true,
      message: '비가동 시간이 성공적으로 수정되었습니다',
      data: updatedEntry
    });

  } catch (error: unknown) {
    console.error('Error in PATCH /api/downtime-entries/[id]:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to update downtime entry',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}
