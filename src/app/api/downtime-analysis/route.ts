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

// start_time(UTC)을 영업 시간대로 환산하여 A/B 교대를 판별 (src/utils/shiftUtils.ts 로직과 동일)
function deriveShiftFromStartTime(startTime: string, tz: string, shiftAStart: string, shiftBStart: string): 'A' | 'B' {
  const local = dayjs(startTime).tz(tz);
  const minutesOfDay = local.hour() * 60 + local.minute();

  const [aHour, aMinute] = shiftAStart.split(':').map(Number);
  const [bHour, bMinute] = shiftBStart.split(':').map(Number);
  const aStartMinutes = (aHour || 0) * 60 + (aMinute || 0);
  const bStartMinutes = (bHour || 0) * 60 + (bMinute || 0);

  if (aStartMinutes <= bStartMinutes) {
    return minutesOfDay >= aStartMinutes && minutesOfDay < bStartMinutes ? 'A' : 'B';
  }
  return minutesOfDay >= aStartMinutes || minutesOfDay < bStartMinutes ? 'A' : 'B';
}

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
      .gte('start_time', fromDate.toISOString())
      .lte('start_time', toDate.toISOString())
      .neq('state', 'NORMAL_OPERATION')
      .not('duration', 'is', null)
      .gt('duration', 0)
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

    // 교대 필터링 (machine_logs에는 shift 컬럼이 없어 start_time을 영업 시간대로 환산하여 판별)
    let downtimeLogs = rawDowntimeLogs || [];
    if (shift) {
      const requestedShifts = shift.split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
      if (requestedShifts.length > 0) {
        downtimeLogs = downtimeLogs.filter(log =>
          requestedShifts.includes(
            deriveShiftFromStartTime(log.start_time, businessConfig.timezone, businessConfig.shiftAStart, businessConfig.shiftBStart)
          )
        );
      }
    }

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

    // 중복 집계 방지: machine_logs의 상태 구간(예: PM_MAINTENANCE로 장기간 표시된 구간)은
    // 같은 설비에 대해 downtime_entries가 더 세부적으로 이미 기록한 경우가 대부분임(시간 구간이 서로 겹침).
    // 같은 machine_id에서 시간 구간이 겹치는 downtime_entries가 하나라도 있으면 해당 machine_logs 행은
    // 제외하여, 운영자가 입력한 세부 기록을 우선하고 동일 비가동을 두 번 합산하지 않도록 한다.
    // (겹침 판정은 교대 필터 적용 전 전체 조회 범위의 downtime_entries를 기준으로 함)
    const entryWindowsByMachine: Record<string, Array<{ start: number; end: number }>> = {};
    (rawDowntimeEntries || []).forEach(entry => {
      if (!entry.start_time) return;
      const start = new Date(entry.start_time).getTime();
      const end = entry.end_time ? new Date(entry.end_time).getTime() : start;
      if (!entryWindowsByMachine[entry.machine_id]) {
        entryWindowsByMachine[entry.machine_id] = [];
      }
      entryWindowsByMachine[entry.machine_id].push({ start, end });
    });

    const isCoveredByManualEntry = (
      machineIdValue: string,
      startTime: string,
      endTime: string | null,
      durationMinutes: number
    ): boolean => {
      const windows = entryWindowsByMachine[machineIdValue];
      if (!windows || windows.length === 0) return false;
      const logStart = new Date(startTime).getTime();
      const logEnd = endTime ? new Date(endTime).getTime() : logStart + durationMinutes * 60 * 1000;
      return windows.some(w => w.start < logEnd && w.end > logStart);
    };

    // machine_logs + downtime_entries를 하나의 형태로 정규화하여 이후 집계 로직을 공통화한다.
    interface UnifiedDowntimeRow {
      log_id: string;
      machine_id: string;
      machine_name: string;
      state: string;
      start_time: string;
      end_time: string | null;
      duration: number; // 분 단위
      operator_id: string | null;
      created_at: string | null;
      source: 'machine_log' | 'manual';
      reason?: string | null;
      description?: string | null;
    }

    let overlapExcludedCount = 0;
    const machineLogRows: UnifiedDowntimeRow[] = downtimeLogs
      .filter(log => {
        const covered = isCoveredByManualEntry(log.machine_id, log.start_time, log.end_time, log.duration || 0);
        if (covered) overlapExcludedCount++;
        return !covered;
      })
      .map(log => ({
        log_id: log.log_id,
        machine_id: log.machine_id,
        machine_name: unwrapJoin(log.machines)?.name || 'Unknown',
        state: log.state,
        start_time: log.start_time,
        end_time: log.end_time,
        duration: log.duration || 0,
        operator_id: log.operator_id,
        created_at: log.created_at,
        source: 'machine_log' as const
      }));

    const manualEntryRows: UnifiedDowntimeRow[] = downtimeEntries.map(entry => ({
      log_id: entry.id,
      machine_id: entry.machine_id,
      machine_name: unwrapJoin(entry.machines)?.name || 'Unknown',
      state: mapReasonToState(entry.reason),
      start_time: entry.start_time,
      end_time: entry.end_time,
      duration: entry.duration_minutes || 0,
      operator_id: entry.operator_id,
      created_at: entry.created_at,
      source: 'manual' as const,
      reason: entry.reason,
      description: entry.description
    }));

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

    // 시간대별 트렌드 분석 (시간당, 영업 시간대 기준)
    const hourlyTrends: Record<string, number> = {};
    unifiedRows.forEach(row => {
      const hour = dayjs(row.start_time).tz(businessConfig.timezone).hour();
      hourlyTrends[hour] = (hourlyTrends[hour] || 0) + (row.duration || 0);
    });

    // 일별 트렌드 분석
    const dailyTrends: Record<string, {
      date: string;
      total_downtime: number;
      events_count: number;
      states: Record<string, number>;
    }> = {};

    unifiedRows.forEach(row => {
      const date = dayjs(row.start_time).tz(businessConfig.timezone).format('YYYY-MM-DD');
      const duration = row.duration || 0;
      const state = row.state;

      if (!dailyTrends[date]) {
        dailyTrends[date] = {
          date,
          total_downtime: 0,
          events_count: 0,
          states: {}
        };
      }

      dailyTrends[date].total_downtime += duration;
      dailyTrends[date].events_count++;
      dailyTrends[date].states[state] = (dailyTrends[date].states[state] || 0) + duration;
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
            excluded_due_to_overlap: overlapExcludedCount
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