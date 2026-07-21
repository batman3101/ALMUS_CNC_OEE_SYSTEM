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

    // 교대 유효성 + 통합 비가동(machine_logs 열린 비정상 + downtime_entries 열린 항목) +
    // 단조증가 + INSERT 를 하나의 트랜잭션(advisory lock)으로 원자화한다. 앱 레벨의
    // read-then-insert 갭(검사 직후 비가동/경쟁)과 비가동 소스 누락을 함께 없앤다.
    // 비가동 정의는 실시간 가동률(GET) 계산과 동일한 두 소스를 쓴다.
    const { data, error } = await supabaseAdmin.rpc('report_shift_progress', {
      p_machine_id: machineId,
      p_date: date,
      p_shift: shift,
      p_qty: qty,
      p_operator_id: user.userId,
    });

    if (error) {
      console.error('진행 보고 저장 오류:', error);
      return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
    }

    const result = data as {
      ok: boolean;
      reason?: string;
      state?: string;
      last_reported_qty?: number;
    };

    if (!result.ok) {
      if (result.reason === 'machine_in_downtime') {
        return NextResponse.json(
          { error: 'machine_in_downtime', state: result.state },
          { status: 409 }
        );
      }
      if (result.reason === 'decreased') {
        // last_reported_qty 를 함께 실어, 모달이 일반 실패가 아닌 감소 안내를 띄우게 한다.
        return NextResponse.json(
          { error: 'shift_output_qty decreased', last_reported_qty: result.last_reported_qty },
          { status: 409 }
        );
      }
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
    // 프런트가 교대 길이를 endTime−startTime 으로 따로 계산하지 않게, 서버의 교대 창을 그대로
    // 실어 보낸다. 이 창은 확정 OEE(daily)와 같은 buildShiftWindows 산출이라, 프런트·서버·확정이
    // 모두 같은 창을 쓴다 (종료시각 간격/중첩이 있어도 어긋나지 않음).
    let shiftStartIso!: string;
    let operatingMinutes!: number;
    try {
      const window = await getShiftWindow(date, shift);
      if (!window) {
        return NextResponse.json({ error: 'Shift time configuration is invalid' }, { status: 500 });
      }
      shiftStartIso = new Date(window.start).toISOString();
      operatingMinutes = Math.round((window.end - window.start) / 60_000);
      const rows = await loadDowntimeSourceRows(
        machineId,
        shiftStartIso,
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
      // 서버 교대 창(확정 OEE 와 동일). 프런트는 이 값으로 경과·CAPA 를 계산해 창 불일치를 없앤다.
      shift_start: shiftStartIso,
      operating_minutes: operatingMinutes,
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
