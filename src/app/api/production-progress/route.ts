import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';
import { getBreakTimeMinutes } from '@/lib/plannedRuntime';
import { TOTAL_BREAK_MINUTES } from '@/utils/shiftBreaks';
import { calculateVerifiedDowntimeMinutesForWindow } from '@/app/api/production-records/daily/downtimeCalculation';
import { getShiftWindow, loadDowntimeSourceRows } from '@/lib/shiftDowntime';

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

    // 비가동 중 입력 금지를 서버에서도 강제한다. 클라이언트 잠금(ProgressInputModal)만으로는
    // ① 모달을 연 뒤 비가동이 시작되는 경쟁, ② API 직접 호출을 막지 못한다. 잠금의 정의는
    // 대시보드·실시간 가동률과 동일하게 machine_logs 의 "열린 비정상 상태"를 쓴다.
    const { data: openLog, error: openLogError } = await supabaseAdmin
      .from('machine_logs')
      .select('state')
      .eq('machine_id', machineId)
      .is('end_time', null)
      .order('start_time', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (openLogError) {
      console.error('설비 상태 조회 오류:', openLogError);
      return NextResponse.json({ error: 'Failed to read machine state' }, { status: 500 });
    }

    if (openLog && openLog.state !== 'NORMAL_OPERATION') {
      return NextResponse.json(
        { error: 'machine_in_downtime', state: openLog.state },
        { status: 409 }
      );
    }

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
      // 감소 방지 트리거(enforce_progress_monotonic)가 동시 요청 경쟁을 DB 레벨에서 막는다.
      // 앱 레벨 사전검사는 last 조회와 insert 가 분리돼 두 요청이 같은 값을 읽으면 통과하므로,
      // 트리거가 올리는 check_violation(23514)을 감소 409 로 매핑한다.
      if (insertError.code === '23514') {
        return NextResponse.json({ error: 'shift_output_qty decreased' }, { status: 409 });
      }
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

/**
 * GET /api/production-progress?machine_id=&date=&shift=
 * 마지막 진행 보고 + 지금까지의 비가동 합계 + 개당 tact.
 *
 * 비가동은 확정 OEE(production-records/daily)와 **같은 소스·같은 함수**로 계산한다:
 * downtime_entries + machine_logs 를 병합해 교대 시간창에 클립·유니온한다. 손으로 행을
 * 합산하면 겹친 수동/자동 비가동을 이중 계산하고 machine_logs 비가동을 통째로 놓쳐,
 * 실시간 가동률이 확정 OEE 와 다른 말을 하게 된다.
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

    // 휴식 총량은 비가동 계산(계획정지·휴식 겹침 판정)과 아래 설정 일치 검사에 함께 쓰므로
    // 한 번만 읽는다.
    const configuredBreakMinutes = await getBreakTimeMinutes();

    // 비가동을 확정 OEE 와 동일 계약으로 계산한다. calculateVerifiedDowntimeMinutesForWindow 는
    // 계획정지가 휴식과 겹쳐 이중 차감이 우려되면 null(계산 보류)을 돌려준다 — 그 null 을
    // 0 으로 뭉개지 않고 그대로 전달한다.
    let downtimeMinutes: number | null;
    try {
      const window = await getShiftWindow(date, shift);
      if (!window) {
        return NextResponse.json({ error: 'Shift time configuration is invalid' }, { status: 500 });
      }
      const rows = await loadDowntimeSourceRows(
        machineId,
        new Date(window.start).toISOString(),
        new Date(window.end).toISOString(),
      );
      downtimeMinutes = calculateVerifiedDowntimeMinutesForWindow(
        rows,
        window,
        configuredBreakMinutes,
        Date.now(),
      );
    } catch (e) {
      console.error('비가동 계산 오류:', e);
      return NextResponse.json({ error: 'Failed to read downtime' }, { status: 500 });
    }

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
      // number | null. null = 계획정지·휴식 겹침으로 계산 보류. 0 과 구분해 전달한다.
      downtime_minutes: downtimeMinutes,
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
