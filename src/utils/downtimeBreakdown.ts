import {
  mergeIntervals,
  subtractIntervals,
  type Interval,
} from '@/utils/downtimeIntervals';

export type DowntimeSource = 'downtime_entry' | 'machine_log';

/** 비가동 원천 행. downtime_entries 와 machine_logs 를 같은 모양으로 정규화한 것. */
export interface DowntimeSourceRow {
  id: string;
  source: DowntimeSource;
  /** 원본 코드 그대로(camelCase 또는 UPPER_SNAKE). 이 모듈은 번역하지 않는다. */
  reason: string;
  start_time: string;
  /** null = 진행 중 */
  end_time: string | null;
}

/** 화면에 그릴 한 줄. */
export interface DowntimeBreakdownRow {
  id: string;
  source: DowntimeSource;
  reason: string;
  /** 교대 창에 클립된 시작(ISO) */
  start: string;
  /** null = 이 교대 안에서 아직 진행 중. 그 외에는 클립된 종료(ISO) */
  end: string | null;
  /** 겹침 배분 후 소유 시간(정수 분) */
  minutes: number;
  /** 이전 교대에서 이어져 시작이 잘렸는가 */
  clipped_start: boolean;
}

/** 창에 클립된 한 행. allocateDowntimeOwnership 의 반환 타입에 나타나므로 export 한다. */
export interface PreparedDowntimeSpan {
  row: DowntimeSourceRow;
  /** 교대 창에 클립된 표시용 구간 */
  span: Interval;
  clippedStart: boolean;
  ongoing: boolean;
}

const prepare = (
  row: DowntimeSourceRow,
  window: Interval,
  nowMs: number
): PreparedDowntimeSpan | null => {
  const rawStart = Date.parse(row.start_time);
  const rawEnd = row.end_time === null ? nowMs : Date.parse(row.end_time);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;

  const start = Math.max(rawStart, window.start);
  const end = Math.min(rawEnd, window.end);
  // 길이 0 이하는 구간이 아니다. andon 이중 로그 사고의 end_time = start_time 유령 행이
  // 여기서 걸러진다.
  if (end <= start) return null;

  return {
    row,
    span: { start, end },
    clippedStart: rawStart < window.start,
    ongoing: row.end_time === null && nowMs < window.end,
  };
};

/**
 * 각 행이 **배타적으로 소유하는** 구간을 계산한다.
 *
 * 비가동은 두 테이블에 기록되고 andon 은 **양쪽에 같은 시간대를** 쓴다. 그대로 나열하면
 * 모든 andon 비가동이 두 줄이 된다. 그래서 소유 규칙을 둔다:
 *
 *   1. `downtime_entries` 가 우선한다 — 작업자가 고른 사유를 담고 있다.
 *   2. 같은 소스 안에서는 **먼저 시작한 쪽이 겹침을 소유**한다(안정적인 귀속 규칙).
 *   3. `machine_logs` 는 `downtime_entries` 가 덮지 않은 **잔여만** 소유한다.
 *      andon 쌍둥이는 잔여가 0 이 되어 사라지고, 설비 상태 입력 화면으로만 내려간
 *      정지는 그대로 살아남는다.
 *
 * 결과의 소유 구간들은 서로 겹치지 않고, 그 합은 전체 합집합과 정확히 같다.
 * 이 불변조건이 "건별 시간의 합이 누적과 다르다"를 구조적으로 불가능하게 만든다.
 */
export function allocateDowntimeOwnership(
  rows: DowntimeSourceRow[],
  window: Interval,
  nowMs: number
): Array<{ prepared: PreparedDowntimeSpan; owned: Interval[] }> {
  const prepared = rows
    .map(row => prepare(row, window, nowMs))
    .filter((item): item is PreparedDowntimeSpan => item !== null);

  const byStart = (left: PreparedDowntimeSpan, right: PreparedDowntimeSpan) =>
    left.span.start - right.span.start;
  const ordered = [
    ...prepared.filter(item => item.row.source === 'downtime_entry').sort(byStart),
    ...prepared.filter(item => item.row.source === 'machine_log').sort(byStart),
  ];

  let claimed: Interval[] = [];
  return ordered.map(item => {
    const owned = subtractIntervals([item.span], claimed);
    claimed = mergeIntervals([...claimed, item.span]);
    return { prepared: item, owned };
  });
}

/**
 * 화면용 건별 목록. 소유 시간이 전혀 없는 행(다른 행에 완전히 가려진 andon 쌍둥이)은
 * 버린다 — 그 행은 총합에 0 을 기여하므로 숨겨지는 시간은 없다. 표시 노이즈 제거이지
 * 데이터 절삭이 아니다.
 */
export function buildDowntimeBreakdown(
  rows: DowntimeSourceRow[],
  window: Interval,
  nowMs: number
): DowntimeBreakdownRow[] {
  return allocateDowntimeOwnership(rows, window, nowMs)
    .filter(({ owned }) => owned.length > 0)
    .map(({ prepared, owned }) => ({
      id: prepared.row.id,
      source: prepared.row.source,
      reason: prepared.row.reason,
      start: new Date(prepared.span.start).toISOString(),
      end: prepared.ongoing ? null : new Date(prepared.span.end).toISOString(),
      minutes: Math.round(
        owned.reduce((sum, interval) => sum + (interval.end - interval.start), 0) / 60000
      ),
      clipped_start: prepared.clippedStart,
    }))
    .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
}

/** 시간대별 소계. start/end 를 함께 실어 화면이 교대 시각을 하드코딩하지 않게 한다. */
export interface DowntimeShiftTotal {
  minutes: number | null;
  start: string;
  end: string;
}

/**
 * GET /api/machines/[machineId]/downtime 의 응답 계약.
 *
 * **한 곳에만 적는다.** 예전에는 라우트와 훅이 각자 모양을 적어 두고 훅이 `as` 로 단언했다.
 * 그래서 서버가 교대 단위에서 업무일 단위로 바뀌고 shift_start 가 사라졌는데도 tsc 가
 * 아무 오류도 내지 않았다 — 클라이언트는 조용히 다른 뜻의 숫자를 그리고 있었다.
 * 양쪽이 이 타입을 공유하면 다음 계약 변경은 컴파일이 막는다.
 */
export interface DowntimeBreakdownResponse {
  business_date: string;
  window_start: string;
  window_end: string;
  /** 업무일 전체 누적. null = 계산 보류(계획정지·휴식 겹침). 0 과 구분한다. */
  total_minutes: number | null;
  shift_totals: { day: DowntimeShiftTotal; night: DowntimeShiftTotal };
  /** 진행 중 비가동의 클립되지 않은 시작. null = 진행 중 없음. */
  ongoing_since: string | null;
  intervals: DowntimeBreakdownRow[];
}
