import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';

dayjs.extend(utc);
dayjs.extend(timezone);

import { unwrapJoin } from '@/types';

export const dynamic = 'force-dynamic';

// 영업시간 기준 기본값 (system_settings 조회 실패 시 사용, src/utils/shiftUtils.ts 정의와 동일)
const DEFAULT_BUSINESS_TIMEZONE = 'Asia/Ho_Chi_Minh';
const DEFAULT_SHIFT_A_START = '08:00';
const DEFAULT_SHIFT_B_START = '20:00';

interface BusinessTimeConfig {
  timezone: string;
  shiftAStart: string;
  shiftBStart: string;
}

// system_settings에서 시간대 및 교대 시작 시각 조회 (실패 시 기본값 사용)
async function getBusinessTimeConfig(): Promise<BusinessTimeConfig> {
  const defaults: BusinessTimeConfig = {
    timezone: DEFAULT_BUSINESS_TIMEZONE,
    shiftAStart: DEFAULT_SHIFT_A_START,
    shiftBStart: DEFAULT_SHIFT_B_START
  };

  try {
    const { data, error } = await supabaseAdmin
      .from('system_settings')
      .select('category, setting_key, setting_value')
      .in('category', ['general', 'shift'])
      .eq('is_active', true);

    if (error || !data) {
      return defaults;
    }

    const readValue = (category: string, key: string): string | undefined => {
      const row = data.find(d => d.category === category && d.setting_key === key);
      const value = row?.setting_value as { value?: unknown } | null | undefined;
      return typeof value?.value === 'string' ? value.value : undefined;
    };

    return {
      timezone: readValue('general', 'timezone') || defaults.timezone,
      shiftAStart: readValue('shift', 'shift_a_start') || defaults.shiftAStart,
      shiftBStart: readValue('shift', 'shift_b_start') || defaults.shiftBStart
    };
  } catch {
    return defaults;
  }
}

// 교대 판별은 더 이상 "로그의 시작 시각이 속한 교대" 하나로 하지 않는다.
// 교대를 시간 구간으로 만들어 로그와 교집합을 내므로(buildShiftWindows), 교대를 넘긴 장애도
// 각 교대에 실제로 걸친 만큼만 집계된다.

// GET /api/downtime-analysis - 다운타임 분석 데이터 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const analysisType = searchParams.get('analysis_type') || 'summary'; // summary, detail, trends
    const shift = searchParams.get('shift'); // 'A', 'B' (콤마로 구분된 다중 값 지원)

    console.info('📊 다운타임 분석 API 요청:', { machineId, startDate, endDate, analysisType, shift });

    const businessConfig = await getBusinessTimeConfig();

    // 날짜 범위 설정 (영업시간 기준, 기본값: 최근 30일). 종료일 전체(자정까지)를 포함하도록 하루 전체 범위로 설정
    const fromDate = startDate
      ? dayjs.tz(startDate, businessConfig.timezone).startOf('day')
      : dayjs().tz(businessConfig.timezone).subtract(30, 'day').startOf('day');
    const toDate = endDate
      ? dayjs.tz(endDate, businessConfig.timezone).endOf('day')
      : dayjs().tz(businessConfig.timezone).endOf('day');

    // 조회 구간과 "겹치는" 로그를 모두 가져온다.
    //   - start_time 만으로 필터하면 구간 시작 전에 발생해 구간 안까지 이어진 장애가 통째로 누락된다.
    //   - 진행 중인 로그는 duration=null 로 저장되므로(machines/[machineId] PATCH),
    //     duration NOT NULL 조건을 걸면 장기 진행 중 장애가 영원히 집계되지 않는다.
    // 길이는 아래에서 조회 구간으로 잘라서(clip) 다시 계산하므로 여기서는 필터하지 않는다.
    let baseQuery = supabaseAdmin
      .from('machine_logs')
      .select(`
        log_id,
        machine_id,
        state,
        start_time,
        end_time,
        duration,
        operator_id,
        created_at,
        machines!inner(name, equipment_type, location)
      `)
      .lte('start_time', toDate.toISOString())
      .or(`end_time.is.null,end_time.gte.${fromDate.toISOString()}`)
      .neq('state', 'NORMAL_OPERATION')
      .order('start_time', { ascending: false });

    // 설비 필터링 (단일 ID 또는 콤마로 구분된 다중 ID 지원)
    if (machineId) {
      const machineIds = machineId.split(',').map(id => id.trim()).filter(Boolean);
      if (machineIds.length > 1) {
        baseQuery = baseQuery.in('machine_id', machineIds);
      } else if (machineIds.length === 1) {
        baseQuery = baseQuery.eq('machine_id', machineIds[0]);
      }
    }

    const { data: rawDowntimeLogs, error: logsError } = await baseQuery;

    if (logsError) {
      console.error('다운타임 로그 조회 오류:', logsError);
      return NextResponse.json(
        { error: 'Failed to fetch downtime logs' },
        { status: 500 }
      );
    }

    // machine_logs 에는 shift 컬럼이 없다.
    // 예전에는 start_time 이 속한 교대로 로그 **전체**를 분류해 걸러냈다. 그러면 교대를 넘긴
    // 장애가 시작 교대에 전량 귀속되고 다른 교대에서는 사라진다. 이제는 로그를 버리지 않고,
    // 아래에서 교대 시간 구간과 교집합을 내어 "실제로 그 교대에 걸친 만큼"만 집계한다.
    const downtimeLogs = rawDowntimeLogs || [];

    // 운영자가 교대 데이터 입력 화면에서 직접 기록한 비가동 시간(downtime_entries).
    // date/shift 컬럼을 직접 보유하고 있어 machine_logs보다 정확하게 필터링할 수 있음.
    let entriesQuery = supabaseAdmin
      .from('downtime_entries')
      .select(`
        id,
        machine_id,
        date,
        shift,
        start_time,
        end_time,
        duration_minutes,
        reason,
        description,
        operator_id,
        created_at,
        machines!inner(name, equipment_type, location)
      `)
      .gte('date', fromDate.format('YYYY-MM-DD'))
      .lte('date', toDate.format('YYYY-MM-DD'))
      .not('duration_minutes', 'is', null)
      .gt('duration_minutes', 0)
      .order('start_time', { ascending: false });

    // 설비 필터링 (machine_logs와 동일한 규칙 적용)
    if (machineId) {
      const machineIds = machineId.split(',').map(id => id.trim()).filter(Boolean);
      if (machineIds.length > 1) {
        entriesQuery = entriesQuery.in('machine_id', machineIds);
      } else if (machineIds.length === 1) {
        entriesQuery = entriesQuery.eq('machine_id', machineIds[0]);
      }
    }

    const { data: rawDowntimeEntries, error: entriesError } = await entriesQuery;

    if (entriesError) {
      console.error('비가동 시간(downtime_entries) 조회 오류:', entriesError);
      return NextResponse.json(
        { error: 'Failed to fetch downtime entries' },
        { status: 500 }
      );
    }

    // 교대 필터링 (downtime_entries는 shift 컬럼을 직접 보유하므로 정확히 일치시킴)
    let downtimeEntries = rawDowntimeEntries || [];
    if (shift) {
      const requestedShifts = shift.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (requestedShifts.length > 0) {
        downtimeEntries = downtimeEntries.filter(entry =>
          entry.shift ? requestedShifts.includes(entry.shift.toUpperCase()) : false
        );
      }
    }

    // downtime_entries.reason(i18n 키) -> machine_status enum 매핑.
    // dashboard:downtimeReasons 번역 네임스페이스에는 machine_status 값만 정의되어 있고
    // DowntimeChart.tsx/useEngineerData.ts는 READ-ONLY라 새 번역 키를 추가할 수 없으므로,
    // 기존 UI가 그대로 라벨을 표시할 수 있도록 가장 근접한 machine_status 버킷으로 매핑한다.
    const REASON_TO_STATE_MAP: Record<string, string> = {
      equipmentFailure: 'BREAKDOWN_REPAIR',
      endmillChange: 'TOOL_CHANGE',
      materialShortage: 'TEMPORARY_STOP',
      qualityDefect: 'INSPECTION',
      plannedStop: 'PLANNED_STOP',
      productionModelChange: 'MODEL_CHANGE',
      pm: 'PM_MAINTENANCE',
      programChange: 'PROGRAM_CHANGE',
      other: 'TEMPORARY_STOP'
    };
    const mapReasonToState = (reason: string | null | undefined): string =>
      (reason && REASON_TO_STATE_MAP[reason]) || 'TEMPORARY_STOP';

    // 중복 집계 방지: 같은 비가동을 운영자가 downtime_entries 로 세부 입력하고, machine_logs 에도
    // 상태 구간으로 남아 있는 경우가 많다. 두 번 합산하지 않으려면 machine_logs 구간에서 수동 기록
    // 구간을 빼야 한다.
    //
    // 겹치면 machine_logs 행을 통째로 버리던 이전 방식은, 8시간짜리 장애 로그에 10분짜리 수동 기록이
    // 하나만 걸쳐도 8시간 전체를 0으로 만들었다. 여기서는 겹치는 부분만 빼고 나머지를 남긴다.
    //
    // 윈도우는 반드시 "실제로 합산에 쓰이는" 교대 필터 적용 후 목록(downtimeEntries)으로 만든다.
    // 필터 전 원본으로 만들면, B교대 조회 시 A교대 수동 기록이 machine_logs 를 깎아내지만 그 수동
    // 기록 자체는 응답에 없어 해당 다운타임이 통째로 증발한다.
    const entryWindowsByMachine: Record<string, Array<{ start: number; end: number }>> = {};
    downtimeEntries.forEach(entry => {
      if (!entry.start_time) return;
      const start = new Date(entry.start_time).getTime();
      const end = entry.end_time ? new Date(entry.end_time).getTime() : start;
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
      if (!entryWindowsByMachine[entry.machine_id]) {
        entryWindowsByMachine[entry.machine_id] = [];
      }
      entryWindowsByMachine[entry.machine_id].push({ start, end });
    });

    type Interval = { start: number; end: number };

    // 겹치는 구간들을 병합 (이중 계산 방지)
    const mergeIntervals = (intervals: Interval[]): Interval[] => {
      const sorted = intervals.filter(i => i.end > i.start).sort((a, b) => a.start - b.start);
      if (sorted.length === 0) return [];

      const merged: Interval[] = [{ ...sorted[0] }];
      for (let i = 1; i < sorted.length; i++) {
        const last = merged[merged.length - 1];
        if (sorted[i].start > last.end) {
          merged.push({ ...sorted[i] });
        } else {
          last.end = Math.max(last.end, sorted[i].end);
        }
      }
      return merged;
    };

    // A 의 각 구간에서 B(병합된 구간들)를 뺀 나머지 구간들
    const subtractIntervals = (base: Interval[], cut: Interval[]): Interval[] => {
      const merged = mergeIntervals(cut);
      const result: Interval[] = [];

      for (const b of base) {
        let cursor = b.start;
        for (const c of merged) {
          if (c.end <= cursor) continue;
          if (c.start >= b.end) break;
          if (c.start > cursor) {
            result.push({ start: cursor, end: Math.min(c.start, b.end) });
          }
          cursor = Math.max(cursor, c.end);
          if (cursor >= b.end) break;
        }
        if (cursor < b.end) {
          result.push({ start: cursor, end: b.end });
        }
      }

      return result.filter(i => i.end > i.start);
    };

    // 두 구간 집합의 교집합
    const intersectIntervals = (a: Interval[], b: Interval[]): Interval[] => {
      const result: Interval[] = [];
      for (const x of a) {
        for (const y of b) {
          const start = Math.max(x.start, y.start);
          const end = Math.min(x.end, y.end);
          if (end > start) result.push({ start, end });
        }
      }
      return mergeIntervals(result);
    };

    const totalMinutes = (intervals: Interval[]): number =>
      Math.round((intervals.reduce((sum, i) => sum + (i.end - i.start), 0) / 60000) * 100) / 100;

    // 조회 구간 경계. 진행 중(end_time=null)인 로그는 "지금"까지 이어진 것으로 보되 구간 끝을 넘지 않는다.
    const rangeStartMs = fromDate.valueOf();
    const rangeEndMs = toDate.valueOf();
    const nowMs = Date.now();

    /**
     * 교대 필터를 "구간"으로 만든다.
     *
     * 기존에는 로그의 start_time 이 속한 교대로 로그 **전체**를 분류했다. 그래서
     *   - A교대(08:00)에 시작해 B교대까지 이어진 장애는 A 에 전량 귀속되고,
     *   - B교대 조회에서는 그 장애가 통째로 사라졌다.
     * (실측: 비가동 로그 461건 중 64건이 교대 경계를 넘는다)
     *
     * 교대를 시간 구간으로 만들어 로그와 교집합을 내면, 걸친 장애는 각 교대에
     * 실제로 걸친 만큼만 들어간다.
     */
    const buildShiftWindows = (requestedShifts: string[] | null): Interval[] => {
      if (!requestedShifts || requestedShifts.length === 0) {
        return [{ start: rangeStartMs, end: rangeEndMs }];
      }

      const [aHour, aMinute] = businessConfig.shiftAStart.split(':').map(Number);
      const [bHour, bMinute] = businessConfig.shiftBStart.split(':').map(Number);

      const windows: Interval[] = [];
      // 경계에 걸친 교대를 놓치지 않도록 조회 구간 앞뒤로 하루씩 더 훑는다
      let cursor = fromDate.subtract(1, 'day').startOf('day');
      const limit = toDate.add(1, 'day').startOf('day');

      while (cursor.valueOf() <= limit.valueOf()) {
        const aStart = cursor.hour(aHour || 0).minute(aMinute || 0).second(0).millisecond(0);
        const bStart = cursor.hour(bHour || 0).minute(bMinute || 0).second(0).millisecond(0);

        if (requestedShifts.includes('A')) {
          // A: shift_a_start ~ shift_b_start (같은 날)
          windows.push({ start: aStart.valueOf(), end: bStart.valueOf() });
        }
        if (requestedShifts.includes('B')) {
          // B: shift_b_start ~ 다음 날 shift_a_start (자정을 넘는다)
          windows.push({ start: bStart.valueOf(), end: aStart.add(1, 'day').valueOf() });
        }

        cursor = cursor.add(1, 'day');
      }

      return intersectIntervals(mergeIntervals(windows), [
        { start: rangeStartMs, end: rangeEndMs }
      ]);
    };

    const requestedShifts = shift
      ? shift.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : null;
    const allowedWindows = buildShiftWindows(requestedShifts);

    /**
     * machine_log 한 건이 조회 구간(+교대 필터) 안에서 실제로 차지하는 비가동 구간들.
     * 구간 밖은 잘라내고, 수동 기록(downtime_entries)과 겹치는 부분은 뺀다.
     */
    const effectiveLogIntervals = (
      machineIdValue: string,
      startTime: string,
      endTime: string | null
    ): Interval[] => {
      const logStart = new Date(startTime).getTime();
      if (!Number.isFinite(logStart)) return [];

      const logEnd = endTime ? new Date(endTime).getTime() : Math.min(nowMs, rangeEndMs);
      if (!Number.isFinite(logEnd) || logEnd <= logStart) return [];

      const clipped = intersectIntervals([{ start: logStart, end: logEnd }], allowedWindows);
      if (clipped.length === 0) return [];

      return subtractIntervals(clipped, entryWindowsByMachine[machineIdValue] || []);
    };

    // 수동 입력(downtime_entries)은 shift 컬럼으로 이미 필터링됐다. 조회 구간으로만 자른다.
    const manualEntryIntervals = (startTime: string, endTime: string | null): Interval[] => {
      const start = new Date(startTime).getTime();
      if (!Number.isFinite(start)) return [];
      const end = endTime ? new Date(endTime).getTime() : start;
      if (!Number.isFinite(end) || end <= start) return [];

      return intersectIntervals([{ start, end }], [{ start: rangeStartMs, end: rangeEndMs }]);
    };

    // machine_logs + downtime_entries를 하나의 형태로 정규화하여 이후 집계 로직을 공통화한다.
    interface UnifiedDowntimeRow {
      log_id: string;
      machine_id: string;
      machine_name: string;
      state: string;
      start_time: string;
      end_time: string | null;
      duration: number; // 분 단위 (조회 구간·교대로 잘라낸 실제 길이)
      // 그 길이가 "언제" 발생했는지. 일별/시간대별 추세는 이 구간들을 쪼개서 만든다.
      intervals: Interval[];
      operator_id: string | null;
      created_at: string | null;
      source: 'machine_log' | 'manual';
      reason?: string | null;
      description?: string | null;
    }

    let overlapExcludedCount = 0;
    let ongoingEventCount = 0;
    const machineLogRows: UnifiedDowntimeRow[] = downtimeLogs
      .map(log => ({
        log,
        intervals: effectiveLogIntervals(log.machine_id, log.start_time, log.end_time)
      }))
      .filter(({ log, intervals }) => {
        if (intervals.length > 0) return true;
        // 남은 구간이 없으면 수동 기록이 완전히 덮었거나, 요청한 교대에 전혀 걸치지 않은 로그다.
        if ((entryWindowsByMachine[log.machine_id] || []).length > 0) {
          overlapExcludedCount++;
        }
        return false;
      })
      .map(({ log, intervals }) => {
        if (!log.end_time) ongoingEventCount++;
        return {
          log_id: log.log_id,
          machine_id: log.machine_id,
          machine_name: unwrapJoin(log.machines)?.name || 'Unknown',
          state: log.state,
          start_time: log.start_time,
          end_time: log.end_time,
          duration: totalMinutes(intervals),
          intervals,
          operator_id: log.operator_id,
          created_at: log.created_at,
          source: 'machine_log' as const
        };
      });

    const manualEntryRows: UnifiedDowntimeRow[] = downtimeEntries.map(entry => {
      const intervals = manualEntryIntervals(entry.start_time, entry.end_time);
      return {
        log_id: entry.id,
        machine_id: entry.machine_id,
        machine_name: unwrapJoin(entry.machines)?.name || 'Unknown',
        state: mapReasonToState(entry.reason),
        start_time: entry.start_time,
        end_time: entry.end_time,
        // 작업자가 입력한 duration_minutes 를 그대로 신뢰한다 (합계의 단일 진실 공급원)
        duration: entry.duration_minutes || 0,
        intervals,
        operator_id: entry.operator_id,
        created_at: entry.created_at,
        source: 'manual' as const,
        reason: entry.reason,
        description: entry.description
      };
    });

    const unifiedRows: UnifiedDowntimeRow[] = [...machineLogRows, ...manualEntryRows];

    // 다운타임 요약 분석
    const downtimeByState: Record<string, {
      state: string;
      occurrence_count: number;
      total_duration: number;
      avg_duration: number;
      min_duration: number;
      max_duration: number;
      affected_machines: Set<string>;
      percentage: number;
    }> = {};

    let totalDowntime = 0;

    // 상태별 집계 (machine_logs + downtime_entries 통합 결과 기준)
    unifiedRows.forEach(row => {
      const state = row.state;
      const duration = row.duration || 0;
      totalDowntime += duration;

      if (!downtimeByState[state]) {
        downtimeByState[state] = {
          state,
          occurrence_count: 0,
          total_duration: 0,
          avg_duration: 0,
          min_duration: Infinity,
          max_duration: 0,
          affected_machines: new Set(),
          percentage: 0
        };
      }

      downtimeByState[state].occurrence_count++;
      downtimeByState[state].total_duration += duration;
      downtimeByState[state].min_duration = Math.min(downtimeByState[state].min_duration, duration);
      downtimeByState[state].max_duration = Math.max(downtimeByState[state].max_duration, duration);
      downtimeByState[state].affected_machines.add(row.machine_id);
    });

    // 평균 계산 및 백분율 계산
    const downtimeSummary = Object.values(downtimeByState).map(item => {
      item.avg_duration = item.total_duration / item.occurrence_count;
      item.percentage = totalDowntime > 0 ? (item.total_duration / totalDowntime) * 100 : 0;
      
      return {
        ...item,
        affected_machines_count: item.affected_machines.size,
        // Set을 배열로 변환하여 직렬화 가능하게 만듦
        affected_machines: Array.from(item.affected_machines)
      };
    }).sort((a, b) => b.total_duration - a.total_duration);

    // 설비별 다운타임 분석
    const machineDowntime: Record<string, {
      machine_id: string;
      machine_name: string;
      total_downtime: number;
      downtime_events: number;
      avg_downtime_per_event: number;
      most_frequent_cause: string;
      downtime_by_state: Record<string, number>;
    }> = {};

    unifiedRows.forEach(row => {
      const rowMachineId = row.machine_id;
      const machineName = row.machine_name;
      const duration = row.duration || 0;
      const state = row.state;

      if (!machineDowntime[rowMachineId]) {
        machineDowntime[rowMachineId] = {
          machine_id: rowMachineId,
          machine_name: machineName,
          total_downtime: 0,
          downtime_events: 0,
          avg_downtime_per_event: 0,
          most_frequent_cause: '',
          downtime_by_state: {}
        };
      }

      machineDowntime[rowMachineId].total_downtime += duration;
      machineDowntime[rowMachineId].downtime_events++;
      machineDowntime[rowMachineId].downtime_by_state[state] =
        (machineDowntime[rowMachineId].downtime_by_state[state] || 0) + duration;
    });

    // 설비별 통계 완성
    const machineAnalysis = Object.values(machineDowntime).map(machine => {
      machine.avg_downtime_per_event = machine.total_downtime / machine.downtime_events;
      
      // 가장 빈번한 다운타임 원인 찾기
      const mostFrequentCause = Object.entries(machine.downtime_by_state)
        .reduce((a, b) => a[1] > b[1] ? a : b, ['', 0]);
      machine.most_frequent_cause = mostFrequentCause[0];
      
      return machine;
    }).sort((a, b) => b.total_downtime - a.total_downtime);

    /**
     * 한 구간을 "시간(hour) 경계"로 쪼개어 (현지 날짜, 현지 시각, 분) 조각들을 만든다.
     *
     * 예전에는 로그의 duration 전체를 start_time 이 속한 날짜/시각 버킷 하나에 몰아넣었다.
     * 실측상 비가동 로그의 평균 길이는 268시간(11일), 최대 1,967시간(82일)이고 461건 중
     * 206건이 날짜를 넘는다. 즉 11일치 비가동이 시작한 날 하루에 통째로 쌓여 있었고,
     * 조회 범위보다 앞선 날짜까지 추세 응답에 나타났다.
     * 이제 실제로 걸친 시간대에만 그만큼씩 나눠 넣는다.
     */
    const splitIntoHourlySegments = (
      intervals: Interval[]
    ): Array<{ date: string; hour: number; minutes: number }> => {
      const segments: Array<{ date: string; hour: number; minutes: number }> = [];

      for (const interval of intervals) {
        let cursor = dayjs(interval.start).tz(businessConfig.timezone);
        const end = interval.end;

        while (cursor.valueOf() < end) {
          const nextHour = cursor.add(1, 'hour').startOf('hour');
          const segmentEnd = Math.min(nextHour.valueOf(), end);
          const minutes = (segmentEnd - cursor.valueOf()) / 60000;

          if (minutes > 0) {
            segments.push({
              date: cursor.format('YYYY-MM-DD'),
              hour: cursor.hour(),
              minutes
            });
          }

          cursor = dayjs(segmentEnd).tz(businessConfig.timezone);
        }
      }

      return segments;
    };

    const hourlyTrends: Record<string, number> = {};
    const dailyTrends: Record<string, {
      date: string;
      total_downtime: number;
      events_count: number;
      states: Record<string, number>;
    }> = {};

    unifiedRows.forEach(row => {
      const segments = splitIntoHourlySegments(row.intervals);

      // 수동 입력은 duration_minutes 를 합계의 기준으로 쓰므로, 구간 분해로 나온 총량과
      // 어긋날 수 있다(작업자가 시각과 별개로 분을 적을 수 있음). 그 경우 비율로 맞춰
      // 추세 합계가 총합과 일치하도록 보정한다.
      const segmentTotal = segments.reduce((sum, s) => sum + s.minutes, 0);
      const scale = segmentTotal > 0 && row.duration > 0 ? row.duration / segmentTotal : 1;

      // 이 행이 실제로 등장하는 날짜들 (이벤트 건수는 날짜마다 1회씩만 센다)
      const datesTouched = new Set<string>();

      segments.forEach(segment => {
        const minutes = segment.minutes * scale;

        hourlyTrends[segment.hour] = (hourlyTrends[segment.hour] || 0) + minutes;

        if (!dailyTrends[segment.date]) {
          dailyTrends[segment.date] = {
            date: segment.date,
            total_downtime: 0,
            events_count: 0,
            states: {}
          };
        }

        dailyTrends[segment.date].total_downtime += minutes;
        dailyTrends[segment.date].states[row.state] =
          (dailyTrends[segment.date].states[row.state] || 0) + minutes;

        if (!datesTouched.has(segment.date)) {
          datesTouched.add(segment.date);
          dailyTrends[segment.date].events_count++;
        }
      });
    });

    // 소수점 정리
    Object.keys(hourlyTrends).forEach(hour => {
      hourlyTrends[hour] = Math.round(hourlyTrends[hour] * 100) / 100;
    });
    Object.values(dailyTrends).forEach(day => {
      day.total_downtime = Math.round(day.total_downtime * 100) / 100;
      Object.keys(day.states).forEach(state => {
        day.states[state] = Math.round(day.states[state] * 100) / 100;
      });
    });

    const sortedDailyTrends = Object.values(dailyTrends).sort((a, b) =>
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );

    // 응답 구성
    const response = {
      summary: {
        total_downtime_minutes: totalDowntime,
        total_downtime_hours: Math.round((totalDowntime / 60) * 100) / 100,
        total_events: unifiedRows.length,
        avg_downtime_per_event: totalDowntime > 0 ? Math.round((totalDowntime / (unifiedRows.length || 1)) * 100) / 100 : 0,
        unique_machines_affected: new Set(unifiedRows.map(row => row.machine_id)).size,
        analysis_period: {
          start_date: fromDate.format('YYYY-MM-DD'),
          end_date: toDate.format('YYYY-MM-DD'),
          days: Math.ceil((toDate.valueOf() - fromDate.valueOf()) / (1000 * 60 * 60 * 24))
        }
      },
      downtime_by_cause: downtimeSummary,
      machine_analysis: machineAnalysis,
      trends: {
        hourly: Object.entries(hourlyTrends).map(([hour, duration]) => ({
          hour: parseInt(hour),
          total_downtime: duration
        })).sort((a, b) => a.hour - b.hour),
        daily: sortedDailyTrends
      },
      detailed_logs: analysisType === 'detail' ? unifiedRows.map(row => ({
        log_id: row.log_id,
        machine_id: row.machine_id,
        machine_name: row.machine_name,
        state: row.state,
        start_time: row.start_time,
        end_time: row.end_time,
        duration_minutes: row.duration,
        duration_hours: Math.round((row.duration / 60) * 100) / 100,
        operator_id: row.operator_id,
        created_at: row.created_at,
        source: row.source,
        reason: row.reason,
        description: row.description
      })) : undefined,
      metadata: {
        query_time: new Date().toISOString(),
        filters: {
          machine_id: machineId,
          start_date: startDate,
          end_date: endDate,
          shift: shift,
          analysis_type: analysisType
        },
        source_totals: {
          machine_log: {
            events: machineLogRows.length,
            total_duration_minutes: machineLogRows.reduce((sum, row) => sum + row.duration, 0),
            excluded_due_to_overlap: overlapExcludedCount,
            // 아직 종료되지 않은(end_time=null) 로그 건수. 조회 시점까지의 시간만 집계된다.
            // 이 값이 비정상적으로 크면 설비 상태 변경이 중간에 실패해 열린 채 방치된 로그가 있다는 뜻이다.
            ongoing_events: ongoingEventCount
          },
          manual: {
            events: manualEntryRows.length,
            total_duration_minutes: manualEntryRows.reduce((sum, row) => sum + row.duration, 0)
          }
        }
      }
    };

    console.info('✅ 다운타임 분석 완료:', {
      총다운타임: totalDowntime,
      이벤트수: unifiedRows.length,
      영향받은설비: response.summary.unique_machines_affected,
      machine_log건수: machineLogRows.length,
      수동입력건수: manualEntryRows.length,
      중복제외건수: overlapExcludedCount
    });

    return NextResponse.json(response);

  } catch (error) {
    console.error('❌ 다운타임 분석 API 오류:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}