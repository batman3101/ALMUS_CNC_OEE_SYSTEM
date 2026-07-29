import { supabaseAdmin } from '@/lib/supabase-admin';
import { buildBusinessRange, buildShiftWindows, type Interval } from '@/utils/downtimeIntervals';
import { getBusinessTimeConfig } from '@/lib/shiftConfig';
import type { DowntimeSourceInterval } from '@/app/api/production-records/daily/downtimeCalculation';

const PLANNED_REASONS = ['plannedStop', 'planned_stop', 'PLANNED_STOP', '계획 정지'];

/** 원천 행에 신원(id·source·reason)을 붙인 모양. 건별 목록 화면이 이걸 쓴다. */
export interface DowntimeDetailRow {
  id: string;
  source: 'downtime_entry' | 'machine_log';
  reason: string;
  start_time: string;
  end_time: string | null;
  is_planned: boolean;
}

/**
 * 한 설비의 비가동 원천 행을 [rangeStart, rangeEnd) 구간에 대해 **신원과 함께** 로드한다.
 *
 * 비가동은 **두 곳**에서 온다: 작업자가 이벤트로 남긴 `downtime_entries`, 그리고 설비의
 * 비정상 상태 이력 `machine_logs`(NORMAL_OPERATION 이 아닌 구간). 둘을 하나로 합쳐 돌려주는
 * 이 함수가 확정 OEE(daily/route)와 실시간(production-progress)의 **단일 비가동 소스**다.
 * 예전엔 실시간 경로가 downtime_entries 만 봐서, machine_logs 로만 잡히는 정지가 실시간
 * 가동률에서 사라지고 확정 OEE 와 어긋났다(그리고 같은 화면의 입력 잠금은 machine_logs 를
 * 봤다 — 잠긴 설비가 가동률 100% 로 보이는 모순).
 */
export async function loadDowntimeDetailRows(
  machineId: string,
  rangeStartISO: string,
  rangeEndISO: string,
): Promise<DowntimeDetailRow[]> {
  const pageSize = 1000;
  const rows: DowntimeDetailRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('downtime_entries')
      .select('id, start_time, end_time, reason')
      .eq('machine_id', machineId)
      .lt('start_time', rangeEndISO)
      .or(`end_time.is.null,end_time.gt.${rangeStartISO}`)
      .order('start_time', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []).map(row => ({
      id: String(row.id),
      source: 'downtime_entry' as const,
      reason: String(row.reason),
      start_time: row.start_time,
      end_time: row.end_time,
      is_planned: PLANNED_REASONS.includes(String(row.reason)),
    })));
    if (!data || data.length < pageSize) break;
  }

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('machine_logs')
      .select('log_id, start_time, end_time, state')
      .eq('machine_id', machineId)
      .neq('state', 'NORMAL_OPERATION')
      .lt('start_time', rangeEndISO)
      .or(`end_time.is.null,end_time.gt.${rangeStartISO}`)
      .order('start_time', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []).map(row => ({
      id: String(row.log_id),
      source: 'machine_log' as const,
      reason: String(row.state),
      start_time: row.start_time,
      end_time: row.end_time,
      is_planned: row.state === 'PLANNED_STOP',
    })));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

/**
 * 합계 계산용 축약 모양. 확정 OEE·실시간 경로가 쓰는 기존 계약을 그대로 유지한다.
 * loadDowntimeDetailRows 위에 재구현해 **쿼리가 한 벌만 존재하게** 한다 — 두 로더가
 * 따로 있으면 한쪽만 고쳐져 합계와 목록이 다른 말을 하게 된다.
 */
export async function loadDowntimeSourceRows(
  machineId: string,
  rangeStartISO: string,
  rangeEndISO: string,
): Promise<DowntimeSourceInterval[]> {
  const rows = await loadDowntimeDetailRows(machineId, rangeStartISO, rangeEndISO);
  return rows.map(({ start_time, end_time, is_planned }) => ({
    start_time,
    end_time,
    is_planned,
  }));
}

/**
 * (date, shift) 한 교대의 시간창. 확정 OEE 와 같은 buildShiftWindows 를 써서 경계 정의를
 * 공유한다(B교대는 자정을 넘어 시작일 20:00 ~ 다음날 08:00). 설정이 유효하지 않으면 null.
 */
function windowFromConfig(
  cfg: { timezone: string; shiftAStart: string; shiftBStart: string },
  date: string,
  shift: 'A' | 'B',
): Interval | null {
  const [window] = buildShiftWindows({
    startDate: date,
    endDate: date,
    timezone: cfg.timezone,
    shiftAStart: cfg.shiftAStart,
    shiftBStart: cfg.shiftBStart,
    requestedShifts: [shift],
  });
  return window ?? null;
}

export async function getShiftWindow(date: string, shift: 'A' | 'B'): Promise<Interval | null> {
  const cfg = await getBusinessTimeConfig();
  return windowFromConfig(cfg, date, shift);
}

/**
 * 진행 보고를 받아도 되는 시간창. 교대 창에 관리자가 설정한 전환 유예를 더한 것이다.
 *
 * 설정을 **한 번만** 읽어 창과 유예를 함께 돌려준다. 둘을 따로 읽으면 그 사이 설정이
 * 바뀔 때 서로 다른 세대의 값으로 판단하게 된다 — 드물지만 굳이 만들 이유가 없는 창이다.
 */
export async function getShiftReportingWindow(
  date: string,
  shift: 'A' | 'B',
): Promise<{ window: Interval; bufferMinutes: number } | null> {
  const cfg = await getBusinessTimeConfig();
  const window = windowFromConfig(cfg, date, shift);
  return window ? { window, bufferMinutes: cfg.shiftChangeBufferMinutes } : null;
}

/**
 * 업무일 한 덩어리의 시간창. A교대 시작부터 다음날 A교대 시작 직전까지이며 A·B 교대를 모두
 * 포함한다. 교대 창 두 개를 만들어 병합할 필요가 없다 — buildBusinessRange 가 곧 그 구간이다.
 * 교대 창과 같은 설정(timezone·shiftAStart)에서 나오므로 경계가 어긋나지 않는다.
 */
export async function getBusinessDayWindow(date: string): Promise<Interval | null> {
  const cfg = await getBusinessTimeConfig();
  try {
    return buildBusinessRange(date, date, cfg.timezone, cfg.shiftAStart);
  } catch {
    return null;
  }
}
