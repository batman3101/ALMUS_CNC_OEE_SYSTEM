import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import {
  ApiAuthError,
  apiAuthErrorResponse,
  assertMachineAccess,
  requireUser,
  type AuthenticatedUser,
} from '@/lib/apiAuth';

interface ExistingDowntimeEntry {
  id: string;
  machine_id: string;
  date: string;
  shift: 'A' | 'B';
  start_time: string;
  end_time: string | null;
  reason: string;
  description: string | null;
  operator_id: string | null;
  version: number;
}

function assertEntryAccess(
  user: AuthenticatedUser,
  entry: ExistingDowntimeEntry,
  options: { allowAssignedOperatorClose?: boolean } = {}
) {
  assertMachineAccess(user, entry.machine_id);
  if (
    user.role === 'operator' &&
    entry.operator_id !== user.userId &&
    !options.allowAssignedOperatorClose
  ) {
    throw new ApiAuthError('다른 작업자가 등록한 비가동 기록은 수정하거나 삭제할 수 없습니다', 403);
  }
}

function rpcErrorResponse(error: { code?: string; message?: string }) {
  if (error.code === '40001') {
    return NextResponse.json(
      { success: false, error: '다른 사용자가 먼저 수정했습니다. 목록을 새로고침해 주세요' },
      { status: 409 }
    );
  }
  if (error.code === '23P01') {
    return NextResponse.json(
      { success: false, error: '같은 설비에 겹치는 비가동 시간이 있습니다' },
      { status: 409 }
    );
  }
  if (error.code === '22007' || error.code === '22023' || error.code === '23502') {
    return NextResponse.json(
      { success: false, error: error.message || 'Invalid downtime entry' },
      { status: 400 }
    );
  }
  return null;
}

async function findEntry(id: string): Promise<ExistingDowntimeEntry | null> {
  const { data, error } = await supabaseAdmin
    .from('downtime_entries')
    .select('id, machine_id, date, shift, start_time, end_time, reason, description, operator_id, version')
    .eq('id', id)
    .single();
  if (error || !data) return null;
  return data as ExistingDowntimeEntry;
}

// DELETE /api/downtime-entries/[id] - 담당 설비의 본인 사건 또는 관리자/엔지니어 사건 삭제
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Downtime entry ID is required' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({})) as { expected_version?: unknown };
    if (!Number.isInteger(body.expected_version) || Number(body.expected_version) <= 0) {
      return NextResponse.json(
        { success: false, error: 'expected_version is required' },
        { status: 400 }
      );
    }

    const existingEntry = await findEntry(id);
    if (!existingEntry) {
      return NextResponse.json({ success: false, error: 'Downtime entry not found' }, { status: 404 });
    }
    assertEntryAccess(authenticatedUser, existingEntry);

    const { error } = await supabaseAdmin.rpc('delete_downtime_entry', {
      p_id: id,
      p_expected_version: Number(body.expected_version),
    });
    if (error) {
      const response = rpcErrorResponse(error);
      if (response) return response;
      throw new Error(`비가동 시간 삭제 실패: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      message: '비가동 시간이 성공적으로 삭제되었습니다',
      deleted_id: id,
    });
  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Error in DELETE /api/downtime-entries/[id]:', error);
    return NextResponse.json({ success: false, error: 'Failed to delete downtime entry' }, { status: 500 });
  }
}

// PATCH /api/downtime-entries/[id] - 동일 사건 ID를 version 조건으로 수정/종료한다.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ success: false, error: 'Downtime entry ID is required' }, { status: 400 });
    }

    const body = await request.json() as {
      start_time?: unknown;
      end_time?: unknown;
      reason?: unknown;
      description?: unknown;
      expected_version?: unknown;
    };
    if (!Number.isInteger(body.expected_version) || Number(body.expected_version) <= 0) {
      return NextResponse.json(
        { success: false, error: 'expected_version is required' },
        { status: 400 }
      );
    }

    const existingEntry = await findEntry(id);
    if (!existingEntry) {
      return NextResponse.json({ success: false, error: 'Downtime entry not found' }, { status: 404 });
    }
    const isAssignedOperatorClosingOngoingEntry =
      authenticatedUser.role === 'operator' &&
      existingEntry.operator_id !== authenticatedUser.userId &&
      existingEntry.end_time === null &&
      typeof body.end_time === 'string' &&
      body.start_time === undefined &&
      body.reason === undefined &&
      body.description === undefined;
    assertEntryAccess(authenticatedUser, existingEntry, {
      allowAssignedOperatorClose: isAssignedOperatorClosingOngoingEntry,
    });

    const startValue = typeof body.start_time === 'string' ? body.start_time : existingEntry.start_time;
    const endValue = body.end_time === undefined
      ? existingEntry.end_time
      : body.end_time === null
        ? null
        : typeof body.end_time === 'string'
          ? body.end_time
          : undefined;
    const reason = typeof body.reason === 'string' ? body.reason : existingEntry.reason;
    if (endValue === undefined || !reason.trim()) {
      return NextResponse.json({ success: false, error: 'Invalid downtime update' }, { status: 400 });
    }

    const startTime = new Date(startValue);
    const endTime = endValue === null ? null : new Date(endValue);
    if (Number.isNaN(startTime.getTime()) || (endTime && Number.isNaN(endTime.getTime()))) {
      return NextResponse.json(
        { success: false, error: 'start_time and end_time must be valid date-times' },
        { status: 400 }
      );
    }
    if (endTime && endTime.getTime() <= startTime.getTime()) {
      return NextResponse.json(
        { success: false, error: '종료 시간은 시작 시간보다 늦어야 합니다' },
        { status: 400 }
      );
    }

    const description = body.description === undefined
      ? existingEntry.description
      : typeof body.description === 'string'
        ? body.description
        : null;
    const { data: updatedEntry, error } = await supabaseAdmin.rpc('upsert_downtime_entry', {
      p_id: id,
      p_machine_id: existingEntry.machine_id,
      p_date: existingEntry.date,
      p_shift: existingEntry.shift,
      p_start_time: startTime.toISOString(),
      p_end_time: endTime?.toISOString() || null,
      p_reason: reason,
      p_description: description,
      p_operator_id: existingEntry.operator_id,
      p_expected_version: Number(body.expected_version),
    });

    if (error) {
      const response = rpcErrorResponse(error);
      if (response) return response;
      throw new Error(`비가동 시간 수정 실패: ${error.message}`);
    }

    return NextResponse.json({
      success: true,
      message: '비가동 시간이 성공적으로 수정되었습니다',
      data: updatedEntry,
    });
  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Error in PATCH /api/downtime-entries/[id]:', error);
    return NextResponse.json({ success: false, error: 'Failed to update downtime entry' }, { status: 500 });
  }
}
