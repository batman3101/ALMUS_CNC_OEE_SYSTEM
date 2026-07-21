import { supabaseAdmin } from '@/lib/supabase-admin';
import { buildShiftWindows, type Interval } from '@/utils/downtimeIntervals';
import { getBusinessTimeConfig } from '@/lib/shiftConfig';
import type { DowntimeSourceInterval } from '@/app/api/production-records/daily/downtimeCalculation';

const PLANNED_REASONS = ['plannedStop', 'planned_stop', 'PLANNED_STOP', '계획 정지'];

/**
 * 한 설비의 비가동 원천 행을 [rangeStart, rangeEnd) 구간에 대해 로드한다.
 *
 * 비가동은 **두 곳**에서 온다: 작업자가 이벤트로 남긴 `downtime_entries`, 그리고 설비의
 * 비정상 상태 이력 `machine_logs`(NORMAL_OPERATION 이 아닌 구간). 둘을 하나로 합쳐 돌려주는
 * 이 함수가 확정 OEE(daily/route)와 실시간(production-progress)의 **단일 비가동 소스**다.
 * 예전엔 실시간 경로가 downtime_entries 만 봐서, machine_logs 로만 잡히는 정지가 실시간
 * 가동률에서 사라지고 확정 OEE 와 어긋났다(그리고 같은 화면의 입력 잠금은 machine_logs 를
 * 봤다 — 잠긴 설비가 가동률 100% 로 보이는 모순).
 */
export async function loadDowntimeSourceRows(
  machineId: string,
  rangeStartISO: string,
  rangeEndISO: string,
): Promise<DowntimeSourceInterval[]> {
  const pageSize = 1000;
  const rows: DowntimeSourceInterval[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('downtime_entries')
      .select('start_time, end_time, reason')
      .eq('machine_id', machineId)
      .lt('start_time', rangeEndISO)
      .or(`end_time.is.null,end_time.gt.${rangeStartISO}`)
      .order('start_time', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data || []).map(row => ({
      start_time: row.start_time,
      end_time: row.end_time,
      is_planned: PLANNED_REASONS.includes(String(row.reason)),
    })) as DowntimeSourceInterval[]));
    if (!data || data.length < pageSize) break;
  }

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('machine_logs')
      .select('start_time, end_time, state')
      .eq('machine_id', machineId)
      .neq('state', 'NORMAL_OPERATION')
      .lt('start_time', rangeEndISO)
      .or(`end_time.is.null,end_time.gt.${rangeStartISO}`)
      .order('start_time', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...((data || []).map(row => ({
      start_time: row.start_time,
      end_time: row.end_time,
      is_planned: row.state === 'PLANNED_STOP',
    })) as DowntimeSourceInterval[]));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

/**
 * (date, shift) 한 교대의 시간창. 확정 OEE 와 같은 buildShiftWindows 를 써서 경계 정의를
 * 공유한다(B교대는 자정을 넘어 시작일 20:00 ~ 다음날 08:00). 설정이 유효하지 않으면 null.
 */
export async function getShiftWindow(date: string, shift: 'A' | 'B'): Promise<Interval | null> {
  const cfg = await getBusinessTimeConfig();
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
