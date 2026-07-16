import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { DowntimeEntry } from '@/types/dataInput';
import { buildShiftWindows } from '@/utils/downtimeIntervals';
import {
  apiAuthErrorResponse,
  assertMachineAccess,
  requireUser,
} from '@/lib/apiAuth';

const DEFAULT_TIME_CONFIG = {
  timezone: 'Asia/Ho_Chi_Minh',
  shiftAStart: '08:00',
  shiftBStart: '20:00',
};

const isBusinessDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value);

async function getBusinessTimeConfig() {
  const { data, error } = await supabaseAdmin
    .from('system_settings')
    .select('category, setting_key, setting_value')
    .in('category', ['general', 'shift'])
    .eq('is_active', true);

  if (error || !data) return DEFAULT_TIME_CONFIG;
  const readValue = (category: string, key: string): string | undefined => {
    const row = data.find(item => item.category === category && item.setting_key === key);
    const setting = row?.setting_value as { value?: unknown } | null | undefined;
    return typeof setting?.value === 'string' ? setting.value : undefined;
  };

  return {
    timezone: readValue('general', 'timezone') || DEFAULT_TIME_CONFIG.timezone,
    shiftAStart: readValue('shift', 'shift_a_start') || DEFAULT_TIME_CONFIG.shiftAStart,
    shiftBStart: readValue('shift', 'shift_b_start') || DEFAULT_TIME_CONFIG.shiftBStart,
  };
}

function rpcErrorResponse(error: { code?: string; message?: string }) {
  if (error.code === '55000' && error.message?.includes('MACHINE_INACTIVE')) {
    return NextResponse.json(
      { success: false, error: 'Inactive machines cannot receive new downtime events' },
      { status: 409 }
    );
  }
  if (error.code === '23P01') {
    return NextResponse.json(
      { success: false, error: '같은 설비에 겹치는 비가동 시간이 있습니다' },
      { status: 409 }
    );
  }
  if (error.code === '40001') {
    return NextResponse.json(
      { success: false, error: '다른 사용자가 먼저 수정했습니다. 목록을 새로고침해 주세요' },
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

// POST /api/downtime-entries - 생산실적과 독립적으로 비가동 사건을 즉시 생성한다.
export async function POST(request: NextRequest) {
  try {
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
    const body: Partial<DowntimeEntry> & { version?: number } = await request.json();
    const { machine_id, date, shift, start_time, reason, description, operator_id } = body;

    if (!machine_id || !date || !shift || !start_time || !reason) {
      return NextResponse.json(
        { success: false, error: 'Machine ID, date, shift, start_time, and reason are required' },
        { status: 400 }
      );
    }
    if (!isBusinessDate(date) || (shift !== 'A' && shift !== 'B')) {
      return NextResponse.json(
        { success: false, error: 'date must be YYYY-MM-DD and shift must be A or B' },
        { status: 400 }
      );
    }

    assertMachineAccess(authenticatedUser, machine_id);
    const startTime = new Date(start_time);
    const endTime = body.end_time == null ? null : new Date(body.end_time);
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

    const { data: machine, error: machineError } = await supabaseAdmin
      .from('machines')
      .select('id, name, is_active')
      .eq('id', machine_id)
      .single();
    if (machineError || !machine) {
      return NextResponse.json({ success: false, error: 'Machine not found' }, { status: 404 });
    }
    if (!machine.is_active) {
      return NextResponse.json(
        { success: false, error: 'Inactive machines cannot receive new downtime events' },
        { status: 409 }
      );
    }

    const { data: savedEntry, error: saveError } = await supabaseAdmin.rpc(
      'upsert_downtime_entry',
      {
        p_id: body.id || null,
        p_machine_id: machine_id,
        p_date: date,
        p_shift: shift,
        p_start_time: startTime.toISOString(),
        p_end_time: endTime?.toISOString() || null,
        p_reason: reason,
        p_description: description || null,
        p_operator_id: authenticatedUser.role === 'operator'
          ? authenticatedUser.userId
          : operator_id || authenticatedUser.userId,
        p_expected_version: null,
      }
    );

    if (saveError) {
      const response = rpcErrorResponse(saveError);
      if (response) return response;
      throw new Error(`비가동 시간 저장 실패: ${saveError.message}`);
    }

    return NextResponse.json({
      success: true,
      message: '비가동 시간이 성공적으로 저장되었습니다',
      data: savedEntry,
    });
  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Error in POST /api/downtime-entries:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to save downtime entry' },
      { status: 500 }
    );
  }
}

// GET /api/downtime-entries - 입력 날짜 라벨이 아니라 실제 교대 시간과 겹치는 사건을 조회한다.
export async function GET(request: NextRequest) {
  try {
    const authenticatedUser = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const date = searchParams.get('date');
    const shift = searchParams.get('shift');

    if (!machineId || !date) {
      return NextResponse.json(
        { success: false, error: 'Machine ID and date are required' },
        { status: 400 }
      );
    }
    if (!isBusinessDate(date) || (shift && shift !== 'A' && shift !== 'B')) {
      return NextResponse.json(
        { success: false, error: 'date must be YYYY-MM-DD and shift must be A or B' },
        { status: 400 }
      );
    }
    assertMachineAccess(authenticatedUser, machineId);

    const timeConfig = await getBusinessTimeConfig();
    const windows = buildShiftWindows({
      startDate: date,
      endDate: date,
      ...timeConfig,
      requestedShifts: shift ? [shift] : ['A', 'B'],
    });
    const windowStart = new Date(Math.min(...windows.map(window => window.start))).toISOString();
    const windowEnd = new Date(Math.max(...windows.map(window => window.end))).toISOString();

    const { data: entries, error: fetchError } = await supabaseAdmin
      .from('downtime_entries')
      .select('*')
      .eq('machine_id', machineId)
      .lt('start_time', windowEnd)
      .or(`end_time.is.null,end_time.gt.${windowStart}`)
      .order('start_time', { ascending: true });

    if (fetchError) throw new Error(`비가동 시간 조회 실패: ${fetchError.message}`);
    return NextResponse.json({
      success: true,
      data: entries || [],
      count: entries?.length || 0,
    });
  } catch (error: unknown) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Error in GET /api/downtime-entries:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch downtime entries' },
      { status: 500 }
    );
  }
}
