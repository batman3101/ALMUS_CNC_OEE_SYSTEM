import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';
import { getBreakTimeMinutes } from '@/lib/plannedRuntime';
import { TOTAL_BREAK_MINUTES } from '@/utils/shiftBreaks';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ProgressBody {
  machine_id?: unknown;
  date?: unknown;
  shift?: unknown;
  shift_output_qty?: unknown;
}

/**
 * POST /api/production-progress — 교대 중 진행 보고 저장 (append-only).
 *
 * shift_output_qty 의 의미는 "이 교대에서 지금까지 만든 총 개수"다. 누적이므로 줄어들 수
 * 없고, 줄어든 값이 오면 오타이거나 예기치 못한 상황이다. 조용히 받으면 그 차이만큼
 * 생산량이 증발하므로 409 로 되묻는다.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const body = (await request.json()) as ProgressBody;

    const machineId = typeof body.machine_id === 'string' ? body.machine_id : '';
    const date = typeof body.date === 'string' ? body.date : '';
    const shift = body.shift === 'A' || body.shift === 'B' ? body.shift : null;
    const qty = typeof body.shift_output_qty === 'number' ? body.shift_output_qty : Number.NaN;

    if (!UUID.test(machineId)) {
      return NextResponse.json({ error: 'machine_id must be a UUID' }, { status: 400 });
    }
    if (!DATE.test(date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (shift === null) {
      return NextResponse.json({ error: "shift must be 'A' or 'B'" }, { status: 400 });
    }
    if (!Number.isInteger(qty) || qty < 0) {
      return NextResponse.json({ error: 'shift_output_qty must be a non-negative integer' }, { status: 400 });
    }

    assertMachineAccess(user, machineId);

    const { data: last, error: lastError } = await supabaseAdmin
      .from('production_progress_reports')
      .select('shift_output_qty')
      .eq('machine_id', machineId)
      .eq('date', date)
      .eq('shift', shift)
      .order('reported_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastError) {
      console.error('진행 보고 조회 오류:', lastError);
      return NextResponse.json({ error: 'Failed to read last report' }, { status: 500 });
    }

    if (last && qty < last.shift_output_qty) {
      return NextResponse.json(
        {
          error: 'shift_output_qty decreased',
          last_reported_qty: last.shift_output_qty,
          submitted_qty: qty,
        },
        { status: 409 }
      );
    }

    const { error: insertError } = await supabaseAdmin
      .from('production_progress_reports')
      .insert({
        machine_id: machineId,
        date,
        shift,
        shift_output_qty: qty,
        operator_id: user.userId,
      });

    if (insertError) {
      console.error('진행 보고 저장 오류:', insertError);
      return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}

interface DowntimeRow {
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
}

/**
 * 비가동 한 건의 길이(분).
 *
 * end_time 과 duration_minutes 는 서로 독립적으로 nullable 이므로 세 경우가 있다.
 *
 * 1. 둘 다 있다 → 기록된 duration_minutes 를 쓴다.
 * 2. end_time 이 없다 → 지금 이 순간에도 멈춰 있다. now 까지 센다.
 * 3. end_time 은 있는데 duration_minutes 만 없다 → 길이가 기록되지 않았을 뿐이다.
 *    0 으로 세면 그 비가동이 통째로 사라져 가동률이 실제보다 높아 보인다
 *    (CLAUDE.md: "A NULL metric is not 0%"). 두 타임스탬프가 다 있으므로 추측할
 *    필요 없이 계산된다.
 *
 * 시작 전(시계 오차 등)으로 음수가 나오면 0 으로 본다.
 */
function downtimeRowMinutes(row: DowntimeRow, now: number): number {
  if (row.end_time !== null && row.duration_minutes !== null) {
    return row.duration_minutes;
  }

  const endedAt = row.end_time !== null ? new Date(row.end_time).getTime() : now;
  return Math.max(0, (endedAt - new Date(row.start_time).getTime()) / 60_000);
}

/**
 * GET /api/production-progress?machine_id=&date=&shift=
 * 마지막 진행 보고 + 지금까지의 비가동 합계 + 개당 tact.
 *
 * tact 는 machines 테이블이 아니라 machines_with_production_info 뷰에 있다. 그 사실을
 * 서버가 흡수해 클라이언트는 출처를 몰라도 되게 한다 (기존 getMachineTactInfo 와 동일한 출처).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { searchParams } = new URL(request.url);

    const machineId = searchParams.get('machine_id') ?? '';
    const date = searchParams.get('date') ?? '';
    const shift = searchParams.get('shift');

    if (!UUID.test(machineId) || !DATE.test(date) || (shift !== 'A' && shift !== 'B')) {
      return NextResponse.json({ error: 'machine_id, date, shift are required' }, { status: 400 });
    }

    // 읽기에도 담당 설비 검사를 건다. 같은 파일의 POST 와 같은 기준이고, 다른 읽기 라우트
    // (machines/[machineId]/oee, machines/[machineId]/production) 의 선례와도 같다.
    assertMachineAccess(user, machineId);

    const { data: lastReport, error: reportError } = await supabaseAdmin
      .from('production_progress_reports')
      .select('shift_output_qty, reported_at')
      .eq('machine_id', machineId)
      .eq('date', date)
      .eq('shift', shift)
      .order('reported_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reportError) {
      console.error('진행 보고 조회 오류:', reportError);
      return NextResponse.json({ error: 'Failed to read progress' }, { status: 500 });
    }

    const { data: downtimes, error: downtimeError } = await supabaseAdmin
      .from('downtime_entries')
      .select('start_time, end_time, duration_minutes')
      .eq('machine_id', machineId)
      .eq('date', date)
      .eq('shift', shift);

    if (downtimeError) {
      console.error('비가동 조회 오류:', downtimeError);
      return NextResponse.json({ error: 'Failed to read downtime' }, { status: 500 });
    }

    const now = Date.now();
    const downtimeMinutes = ((downtimes ?? []) as DowntimeRow[]).reduce(
      (total, row) => total + downtimeRowMinutes(row, now),
      0
    );

    // tact 가 없으면 성능률을 계산할 수 없다. 0 이나 임의값으로 채우지 않고 null 로 알린다.
    const { data: tactRow } = await supabaseAdmin
      .from('machines_with_production_info')
      .select('current_tact_time')
      .eq('id', machineId)
      .maybeSingle();

    const tactTimeSeconds =
      tactRow?.current_tact_time && tactRow.current_tact_time > 0 ? tactRow.current_tact_time : null;

    // shiftBreaks 의 휴식 시간대 합계(TOTAL_BREAK_MINUTES)는 코드 상수이고,
    // break_time_minutes 는 관리자가 UI 에서 바꿀 수 있다(ShiftSettingsTab). 둘이 어긋나면
    // 실시간 화면과 확정 OEE 가 영구히 다른 말을 한다. 순수 모듈은 설정을 읽을 수 없으므로
    // 검출은 여기서만 가능하다. 어긋나면 그럴듯한 숫자를 만들지 말고 계산 불가로 알린다.
    const configuredBreakMinutes = await getBreakTimeMinutes();
    const breakConfigMatches = configuredBreakMinutes === TOTAL_BREAK_MINUTES;

    if (!breakConfigMatches) {
      console.error(
        `휴식 설정 불일치: system_settings=${configuredBreakMinutes}분, ` +
        `shiftBreaks.TOTAL_BREAK_MINUTES=${TOTAL_BREAK_MINUTES}분. ` +
        `실시간 계산을 중단한다 (틀린 숫자보다 없는 숫자가 낫다).`
      );
    }

    return NextResponse.json({
      last_report: lastReport ?? null,
      downtime_minutes: Math.round(downtimeMinutes),
      tact_time_seconds: tactTimeSeconds,
      // false 면 클라이언트는 실시간 지표를 계산하지 않고 "설정 확인 필요"를 보여준다.
      break_config_matches: breakConfigMatches,
      configured_break_minutes: configuredBreakMinutes,
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
