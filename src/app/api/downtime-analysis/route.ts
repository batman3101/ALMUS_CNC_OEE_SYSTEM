import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export const dynamic = 'force-dynamic';

// GET /api/downtime-analysis - 다운타임 분석 데이터 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const analysisType = searchParams.get('analysis_type') || 'summary'; // summary, detail, trends

    console.info('📊 다운타임 분석 API 요청:', { machineId, startDate, endDate, analysisType });

    // 날짜 범위 설정 (기본값: 최근 30일)
    const fromDate = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const toDate = endDate ? new Date(endDate) : new Date();

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

    // 설비 필터링
    if (machineId) {
      baseQuery = baseQuery.eq('machine_id', machineId);
    }

    const { data: downtimeLogs, error: logsError } = await baseQuery;

    if (logsError) {
      console.error('다운타임 로그 조회 오류:', logsError);
      return NextResponse.json(
        { error: 'Failed to fetch downtime logs' },
        { status: 500 }
      );
    }

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

    // 상태별 집계
    (downtimeLogs || []).forEach(log => {
      const state = log.state;
      const duration = log.duration || 0;
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
      downtimeByState[state].affected_machines.add(log.machine_id);
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

    (downtimeLogs || []).forEach(log => {
      const machineId = log.machine_id;
      const machineName = log.machines?.name || 'Unknown';
      const duration = log.duration || 0;
      const state = log.state;

      if (!machineDowntime[machineId]) {
        machineDowntime[machineId] = {
          machine_id: machineId,
          machine_name: machineName,
          total_downtime: 0,
          downtime_events: 0,
          avg_downtime_per_event: 0,
          most_frequent_cause: '',
          downtime_by_state: {}
        };
      }

      machineDowntime[machineId].total_downtime += duration;
      machineDowntime[machineId].downtime_events++;
      machineDowntime[machineId].downtime_by_state[state] = 
        (machineDowntime[machineId].downtime_by_state[state] || 0) + duration;
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

    // 시간대별 트렌드 분석 (시간당)
    const hourlyTrends: Record<string, number> = {};
    (downtimeLogs || []).forEach(log => {
      const hour = new Date(log.start_time).getHours();
      hourlyTrends[hour] = (hourlyTrends[hour] || 0) + (log.duration || 0);
    });

    // 일별 트렌드 분석
    const dailyTrends: Record<string, {
      date: string;
      total_downtime: number;
      events_count: number;
      states: Record<string, number>;
    }> = {};

    (downtimeLogs || []).forEach(log => {
      const date = log.start_time.split('T')[0];
      const duration = log.duration || 0;
      const state = log.state;

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
        total_events: downtimeLogs?.length || 0,
        avg_downtime_per_event: totalDowntime > 0 ? Math.round((totalDowntime / (downtimeLogs?.length || 1)) * 100) / 100 : 0,
        unique_machines_affected: new Set((downtimeLogs || []).map(log => log.machine_id)).size,
        analysis_period: {
          start_date: fromDate.toISOString().split('T')[0],
          end_date: toDate.toISOString().split('T')[0],
          days: Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24))
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
      detailed_logs: analysisType === 'detail' ? (downtimeLogs || []).map(log => ({
        log_id: log.log_id,
        machine_id: log.machine_id,
        machine_name: log.machines?.name || 'Unknown',
        state: log.state,
        start_time: log.start_time,
        end_time: log.end_time,
        duration_minutes: log.duration,
        duration_hours: Math.round((log.duration / 60) * 100) / 100,
        operator_id: log.operator_id,
        created_at: log.created_at
      })) : undefined,
      metadata: {
        query_time: new Date().toISOString(),
        filters: {
          machine_id: machineId,
          start_date: startDate,
          end_date: endDate,
          analysis_type: analysisType
        }
      }
    };

    console.info('✅ 다운타임 분석 완료:', {
      총다운타임: totalDowntime,
      이벤트수: downtimeLogs?.length || 0,
      영향받은설비: response.summary.unique_machines_affected
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