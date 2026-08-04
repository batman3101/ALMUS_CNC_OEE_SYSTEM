import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, requireUser } from '@/lib/apiAuth';

// GET /api/model-processes/[id] - 특정 공정 정보 조회
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireUser(request, ['admin', 'engineer', 'operator']);
    console.log('GET /api/model-processes/[id] called with id:', id);

    const { data: process, error } = await supabaseAdmin
      .from('model_processes')
      .select(`
        id,
        model_id,
        process_name,
        process_order,
        tact_time_seconds,
        created_at,
        updated_at,
        product_models:model_id (
          id,
          model_name,
          description
        )
      `)
      .eq('id', id)
      .single();

    if (error) {
      console.error('Supabase error:', error);
      if (error.code === 'PGRST116') {
        return NextResponse.json(
          { success: false, error: 'Process not found' },
          { status: 404 }
        );
      }
      throw error;
    }

    console.log('Successfully fetched process:', process?.process_name);

    return NextResponse.json({
      success: true,
      process: process
    });

  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Error in GET /api/model-processes/[id]:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch process',
        message: errorMessage,
        details: process.env.NODE_ENV === 'development' ? error : undefined
      },
      { status: 500 }
    );
  }
}

/**
 * 공정 마스터 쓰기는 **여기에만** 있다 (모델 쪽과 같은 이유).
 *
 * ⚠ `tact_time_seconds` 는 **개당(1 piece)** 가공시간이다. `cavity_count` 는 참조용이며
 * 어떤 산술에도 들어가지 않는다 — 여기서 둘을 곱하거나 나누면 그 값이 스냅샷으로 굳어
 * 이후 모든 성능·OEE 가 `1/cavity` 로 눌린다(2026-07-16 에 실제로 났던 사고).
 */

const parsePositiveNumber = (value: unknown): number | null => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

// PUT /api/model-processes/[id] - 공정 수정
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireUser(request, ['admin', 'engineer']);

    const body = await request.json();
    const processName =
      typeof body.process_name === 'string' ? body.process_name.trim() : '';
    const tactTimeSeconds = parsePositiveNumber(body.tact_time_seconds);
    const processOrder = parsePositiveNumber(body.process_order) ?? 1;
    const cavityCount = parsePositiveNumber(body.cavity_count) ?? 1;

    if (!processName) {
      return NextResponse.json({ error: 'Process name is required' }, { status: 400 });
    }
    // tact 는 0 이나 음수일 수 없다. 0 을 받아 두면 성능 계산이 조용히 0 이 된다.
    if (tactTimeSeconds === null) {
      return NextResponse.json(
        { error: 'tact_time_seconds must be a positive number (per piece)' },
        { status: 400 }
      );
    }

    const { data: updated, error } = await supabaseAdmin
      .from('model_processes')
      .update({
        process_name: processName,
        tact_time_seconds: tactTimeSeconds,
        process_order: Math.round(processOrder),
        cavity_count: Math.round(cavityCount)
      })
      .eq('id', id)
      .select()
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'duplicate_name' }, { status: 409 });
      }
      console.error('Error updating model process:', error);
      return NextResponse.json({ error: 'Failed to update process' }, { status: 500 });
    }

    if (!updated) {
      return NextResponse.json({ error: 'Process not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true, process: updated });
  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Unexpected error in PUT /api/model-processes/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/model-processes/[id] - 공정 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    await requireUser(request, ['admin', 'engineer']);

    const { data: deleted, error } = await supabaseAdmin
      .from('model_processes')
      .delete()
      .eq('id', id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('Error deleting model process:', error);
      return NextResponse.json({ error: 'Failed to delete process' }, { status: 500 });
    }

    if (!deleted) {
      return NextResponse.json({ error: 'Process not found' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('Unexpected error in DELETE /api/model-processes/[id]:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
