import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { unwrapJoin } from '@/types';
import { apiAuthErrorResponse, requireUser } from '@/lib/apiAuth';
import { getBusinessDateAt, getShiftAt } from '@/utils/downtimeIntervals';

const DEFAULT_BUSINESS_CLOCK = {
  timezone: 'Asia/Ho_Chi_Minh',
  shiftAStart: '08:00',
  shiftBStart: '20:00',
};

async function getBusinessClock() {
  const { data, error } = await supabaseAdmin
    .from('system_settings')
    .select('category, setting_key, setting_value')
    .in('category', ['general', 'shift'])
    .eq('is_active', true);
  if (error || !data) return DEFAULT_BUSINESS_CLOCK;
  const value = (category: string, key: string): string | undefined => {
    const setting = data.find(row => row.category === category && row.setting_key === key)
      ?.setting_value as { value?: unknown } | null | undefined;
    return typeof setting?.value === 'string' ? setting.value : undefined;
  };
  return {
    timezone: value('general', 'timezone') || DEFAULT_BUSINESS_CLOCK.timezone,
    shiftAStart: value('shift', 'shift_a_start') || DEFAULT_BUSINESS_CLOCK.shiftAStart,
    shiftBStart: value('shift', 'shift_b_start') || DEFAULT_BUSINESS_CLOCK.shiftBStart,
  };
}

// 알림 임계값 설정
const ALERT_THRESHOLDS = {
  oee: {
    critical: 60,    // OEE 60% 미만 (치명적)
    warning: 75      // OEE 75% 미만 (경고)
  },
  availability: {
    critical: 70,    // 가용성 70% 미만
    warning: 85      // 가용성 85% 미만
  },
  performance: {
    critical: 70,    // 성능 70% 미만
    warning: 85      // 성능 85% 미만
  },
  quality: {
    critical: 90,    // 품질 90% 미만
    warning: 95      // 품질 95% 미만
  },
  downtime: {
    critical: 120,   // 연속 다운타임 120분 이상
    warning: 60      // 연속 다운타임 60분 이상
  }
};

// 알림 타입 정의
interface Alert {
  id: string;
  machine_id: string;
  machine_name: string;
  alert_type: 'oee' | 'availability' | 'performance' | 'quality' | 'downtime' | 'maintenance';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  current_value: number;
  threshold_value: number;
  timestamp: string;
  is_active: boolean;
  acknowledged: boolean;
}

interface MachineJoin {
  name?: string | null;
  equipment_type?: string | null;
}

// GET /api/alerts - 실시간 알림 조회
export async function GET(request: NextRequest) {
  try {
    const authenticatedUser = await requireUser(request, ['admin', 'engineer']);
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const severity = searchParams.get('severity'); // 'critical', 'warning', 'info'
    const isActive = searchParams.get('is_active'); // 'true', 'false'
    const requestedLimit = Number.parseInt(searchParams.get('limit') || '50', 10);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(10_000, Math.max(1, requestedLimit))
      : 50;

    console.info('🔔 실시간 알림 API 요청:', { machineId, severity, isActive, limit });

    // 현재 시간 기준으로 최근 데이터 조회
    const currentTime = new Date();
    const recentTime = new Date(currentTime.getTime() - 30 * 60 * 1000); // 최근 30분
    const businessClock = await getBusinessClock();
    const currentBusinessDate = getBusinessDateAt(
      currentTime,
      businessClock.timezone,
      businessClock.shiftAStart
    );
    const currentShift = getShiftAt(
      currentTime,
      businessClock.timezone,
      businessClock.shiftAStart,
      businessClock.shiftBStart
    );

    const pageSize = 1000;
    // 현재 운영 중인 설비 상태도 Supabase 행 상한을 넘길 수 있으므로 전 페이지를 읽는다.
    const currentStatus: Array<{
      id: string;
      name: string;
      current_state: string;
      equipment_type?: string | null;
      location?: string | null;
      updated_at?: string | null;
    }> = [];
    for (let from = 0; ; from += pageSize) {
      let query = supabaseAdmin
        .from('machines')
        .select('id, name, current_state, equipment_type, location, updated_at')
        .eq('is_active', true)
        .order('id', { ascending: true })
        .range(from, from + pageSize - 1);
      if (machineId) query = query.eq('id', machineId);
      const { data, error } = await query;
      if (error) {
        console.error('설비 상태 조회 오류:', error);
        return NextResponse.json({ error: 'Failed to fetch machine status' }, { status: 500 });
      }
      currentStatus.push(...((data || []) as typeof currentStatus));
      if (!data || data.length < pageSize) break;
    }

    // Supabase의 행 상한 때문에 일부 설비가 알림 대상에서 사라지지 않도록 전 페이지를 읽는다.
    const performanceData: Array<{
      machine_id: string;
      oee: number | null;
      availability: number | null;
      performance: number | null;
      quality: number | null;
      record_id?: string | null;
      date: string;
      shift: string;
      created_at?: string | null;
      machines: MachineJoin | MachineJoin[] | null;
    }> = [];
    for (let from = 0; ; from += pageSize) {
      let query = supabaseAdmin
        .from('production_records')
        .select(`
          machine_id,
          oee,
          availability,
          performance,
          quality,
          record_id,
          date,
          shift,
          created_at,
          machines!inner(name, equipment_type)
        `)
        .eq('date', currentBusinessDate)
        .eq('shift', currentShift)
        .order('date', { ascending: false })
        .order('created_at', { ascending: false })
        .range(from, from + pageSize - 1);

      if (machineId) query = query.eq('machine_id', machineId);
      const { data, error } = await query;
      if (error) {
        console.error('성능 데이터 조회 오류:', error);
        return NextResponse.json({ error: 'Failed to fetch performance data' }, { status: 500 });
      }
      performanceData.push(...((data || []) as typeof performanceData));
      if (!data || data.length < pageSize) break;
    }

    // 진행 중인 장애는 시작 시각과 무관하게 포함하고, 최근 종료 건도 함께 조회한다.
    const machineLogDowntimeData: Array<{
      machine_id: string;
      state: string;
      start_time: string;
      end_time: string | null;
      duration: number | null;
      machines: MachineJoin | MachineJoin[] | null;
      source_key?: string;
    }> = [];
    for (let from = 0; ; from += pageSize) {
      let query = supabaseAdmin
        .from('machine_logs')
        .select(`
          machine_id,
          state,
          start_time,
          end_time,
          duration,
          machines!inner(name, equipment_type)
        `)
        .or(`end_time.is.null,start_time.gte.${recentTime.toISOString()}`)
        .neq('state', 'NORMAL_OPERATION')
        .order('start_time', { ascending: false })
        .range(from, from + pageSize - 1);

      if (machineId) query = query.eq('machine_id', machineId);
      const { data, error } = await query;
      if (error) {
        console.error('다운타임 데이터 조회 오류:', error);
        return NextResponse.json({ error: 'Failed to fetch machine downtime' }, { status: 500 });
      }
      machineLogDowntimeData.push(...((data || []) as typeof machineLogDowntimeData));
      if (!data || data.length < pageSize) break;
    }

    // 작업자가 기록한 비가동은 생산실적이나 machine_logs보다 독립적인 원본이다.
    // 설비 상태 로그가 없더라도 진행 중 사건을 관리자 알림에서 놓치지 않는다.
    const manualDowntimeData: Array<{
      id: string;
      machine_id: string;
      reason: string;
      start_time: string;
      end_time: string | null;
      duration_minutes: number | null;
      machines: MachineJoin | MachineJoin[] | null;
    }> = [];
    for (let from = 0; ; from += pageSize) {
      let query = supabaseAdmin
        .from('downtime_entries')
        .select(`
          id,
          machine_id,
          reason,
          start_time,
          end_time,
          duration_minutes,
          machines!inner(name, equipment_type)
        `)
        .or(`end_time.is.null,start_time.gte.${recentTime.toISOString()}`)
        .order('start_time', { ascending: false })
        .range(from, from + pageSize - 1);

      if (machineId) query = query.eq('machine_id', machineId);
      const { data, error } = await query;
      if (error) {
        console.error('수동 비가동 데이터 조회 오류:', error);
        return NextResponse.json({ error: 'Failed to fetch manual downtime' }, { status: 500 });
      }
      manualDowntimeData.push(...((data || []) as typeof manualDowntimeData));
      if (!data || data.length < pageSize) break;
    }

    const downtimeByMachineAndStart = new Map<string, {
      machine_id: string;
      state: string;
      start_time: string;
      end_time: string | null;
      duration: number | null;
      machines: MachineJoin | MachineJoin[] | null;
      source_key: string;
    }>();
    machineLogDowntimeData.forEach(log => {
      downtimeByMachineAndStart.set(`${log.machine_id}:${log.start_time}`, {
        ...log,
        source_key: log.start_time,
      });
    });
    manualDowntimeData.forEach(entry => {
      // 같은 시작 시각의 설비 로그가 있으면 작업자가 분류한 독립 사건을 우선한다.
      downtimeByMachineAndStart.set(`${entry.machine_id}:${entry.start_time}`, {
        machine_id: entry.machine_id,
        state: entry.reason,
        start_time: entry.start_time,
        end_time: entry.end_time,
        duration: entry.duration_minutes,
        machines: entry.machines,
        source_key: entry.id,
      });
    });
    const downtimeData = Array.from(downtimeByMachineAndStart.values());

    // 알림 생성 로직
    const alerts: Alert[] = [];
    // 1. 성능 지표 기반 알림 생성
    const machinePerformance: Record<string, {
      machine_id: string;
      machine_name: string;
      latest_oee: number | null;
      latest_availability: number | null;
      latest_performance: number | null;
      latest_quality: number | null;
      source_key: string;
      record_count: number;
    }> = {};

    (performanceData || []).forEach(record => {
      const machineId = record.machine_id;
      const machineName = unwrapJoin(record.machines)?.name || 'Unknown';

      if (!machinePerformance[machineId]) {
        machinePerformance[machineId] = {
          machine_id: machineId,
          machine_name: machineName,
          latest_oee: record.oee,
          latest_availability: record.availability,
          latest_performance: record.performance,
          latest_quality: record.quality,
          // One production row is one stable source event. Acknowledgement survives
          // repeated polling for that event, while a later record starts a new incident.
          source_key: record.record_id || record.created_at || `${record.date}:${record.shift}`,
          record_count: 1
        };
      } else {
        // 첫 행이 최신이다. 이후 행은 통계용 개수만 증가시키고 값을 덮어쓰지 않는다.
        machinePerformance[machineId].record_count++;
      }
    });

    // 성능 지표별 알림 생성
    Object.values(machinePerformance).forEach(machine => {
      const oee = machine.latest_oee === null ? null : machine.latest_oee * 100;
      const availability = machine.latest_availability === null
        ? null
        : machine.latest_availability * 100;
      const performance = machine.latest_performance === null
        ? null
        : machine.latest_performance * 100;
      const quality = machine.latest_quality === null ? null : machine.latest_quality * 100;

      // OEE 알림
      if (oee !== null && oee < ALERT_THRESHOLDS.oee.critical) {
        alerts.push({
          id: `oee:${machine.machine_id}:${machine.source_key}:critical`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'oee',
          severity: 'critical',
          title: 'OEE 치명적 저하',
          message: `${machine.machine_name}의 OEE가 ${oee.toFixed(1)}%로 임계값(${ALERT_THRESHOLDS.oee.critical}%)을 하회했습니다.`,
          current_value: oee,
          threshold_value: ALERT_THRESHOLDS.oee.critical,
          timestamp: currentTime.toISOString(),
          is_active: true,
          acknowledged: false
        });
      } else if (oee !== null && oee < ALERT_THRESHOLDS.oee.warning) {
        alerts.push({
          id: `oee:${machine.machine_id}:${machine.source_key}:warning`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'oee',
          severity: 'warning',
          title: 'OEE 경고',
          message: `${machine.machine_name}의 OEE가 ${oee.toFixed(1)}%로 경고 수준입니다.`,
          current_value: oee,
          threshold_value: ALERT_THRESHOLDS.oee.warning,
          timestamp: currentTime.toISOString(),
          is_active: true,
          acknowledged: false
        });
      }

      // 가용성 알림
      if (availability !== null && availability < ALERT_THRESHOLDS.availability.critical) {
        alerts.push({
          id: `availability:${machine.machine_id}:${machine.source_key}:critical`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'availability',
          severity: 'critical',
          title: '가용성 치명적 저하',
          message: `${machine.machine_name}의 가용성이 ${availability.toFixed(1)}%로 임계값을 하회했습니다.`,
          current_value: availability,
          threshold_value: ALERT_THRESHOLDS.availability.critical,
          timestamp: currentTime.toISOString(),
          is_active: true,
          acknowledged: false
        });
      } else if (availability !== null && availability < ALERT_THRESHOLDS.availability.warning) {
        alerts.push({
          id: `availability:${machine.machine_id}:${machine.source_key}:warning`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'availability',
          severity: 'warning',
          title: '가용성 경고',
          message: `${machine.machine_name}의 가용성이 ${availability.toFixed(1)}%로 경고 수준입니다.`,
          current_value: availability,
          threshold_value: ALERT_THRESHOLDS.availability.warning,
          timestamp: currentTime.toISOString(),
          is_active: true,
          acknowledged: false
        });
      }

      // 성능 알림
      if (performance !== null && performance < ALERT_THRESHOLDS.performance.critical) {
        alerts.push({
          id: `performance:${machine.machine_id}:${machine.source_key}:critical`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'performance',
          severity: 'critical',
          title: '성능 치명적 저하',
          message: `${machine.machine_name}의 성능이 ${performance.toFixed(1)}%로 임계값을 하회했습니다.`,
          current_value: performance,
          threshold_value: ALERT_THRESHOLDS.performance.critical,
          timestamp: currentTime.toISOString(),
          is_active: true,
          acknowledged: false
        });
      } else if (performance !== null && performance < ALERT_THRESHOLDS.performance.warning) {
        alerts.push({
          id: `performance:${machine.machine_id}:${machine.source_key}:warning`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'performance',
          severity: 'warning',
          title: '성능 경고',
          message: `${machine.machine_name}의 성능이 ${performance.toFixed(1)}%로 경고 수준입니다.`,
          current_value: performance,
          threshold_value: ALERT_THRESHOLDS.performance.warning,
          timestamp: currentTime.toISOString(),
          is_active: true,
          acknowledged: false
        });
      }

      // 품질 알림
      if (quality !== null && quality < ALERT_THRESHOLDS.quality.critical) {
        alerts.push({
          id: `quality:${machine.machine_id}:${machine.source_key}:critical`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'quality',
          severity: 'critical',
          title: '품질 치명적 저하',
          message: `${machine.machine_name}의 품질이 ${quality.toFixed(1)}%로 임계값을 하회했습니다.`,
          current_value: quality,
          threshold_value: ALERT_THRESHOLDS.quality.critical,
          timestamp: currentTime.toISOString(),
          is_active: true,
          acknowledged: false
        });
      } else if (quality !== null && quality < ALERT_THRESHOLDS.quality.warning) {
        alerts.push({
          id: `quality:${machine.machine_id}:${machine.source_key}:warning`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'quality',
          severity: 'warning',
          title: '품질 경고',
          message: `${machine.machine_name}의 품질이 ${quality.toFixed(1)}%로 경고 수준입니다.`,
          current_value: quality,
          threshold_value: ALERT_THRESHOLDS.quality.warning,
          timestamp: currentTime.toISOString(),
          is_active: true,
          acknowledged: false
        });
      }
    });

    // 2. 다운타임 기반 알림 생성
    (downtimeData || []).forEach(log => {
      const startMs = Date.parse(log.start_time);
      const endMs = log.end_time ? Date.parse(log.end_time) : currentTime.getTime();
      const elapsedMinutes = Number.isFinite(startMs) && Number.isFinite(endMs)
        ? Math.max(0, Math.floor((endMs - startMs) / 60_000))
        : 0;
      const duration = typeof log.duration === 'number' && log.duration > 0
        ? log.duration
        : elapsedMinutes;
      const machineName = unwrapJoin(log.machines)?.name || 'Unknown';

      if (duration >= ALERT_THRESHOLDS.downtime.critical) {
        alerts.push({
          id: `downtime:${log.machine_id}:${log.source_key}:critical`,
          machine_id: log.machine_id,
          machine_name: machineName,
          alert_type: 'downtime',
          severity: 'critical',
          title: '장기 다운타임 발생',
          message: `${machineName}이 ${duration}분간 ${log.state} 상태로 다운타임이 지속되고 있습니다.`,
          current_value: duration,
          threshold_value: ALERT_THRESHOLDS.downtime.critical,
          timestamp: log.start_time,
          is_active: !log.end_time,
          acknowledged: false
        });
      } else if (duration >= ALERT_THRESHOLDS.downtime.warning) {
        alerts.push({
          id: `downtime:${log.machine_id}:${log.source_key}:warning`,
          machine_id: log.machine_id,
          machine_name: machineName,
          alert_type: 'downtime',
          severity: 'warning',
          title: '다운타임 경고',
          message: `${machineName}이 ${duration}분간 ${log.state} 상태입니다.`,
          current_value: duration,
          threshold_value: ALERT_THRESHOLDS.downtime.warning,
          timestamp: log.start_time,
          is_active: !log.end_time,
          acknowledged: false
        });
      }
    });

    // 3. 설비 상태 기반 알림 생성
    (currentStatus || []).forEach(machine => {
      if (machine.current_state !== 'NORMAL_OPERATION') {
        let severity: 'critical' | 'warning' | 'info' = 'info';
        let title = '설비 상태 변경';

        if (machine.current_state === 'BREAKDOWN_REPAIR') {
          severity = 'critical';
          title = '설비 긴급 상황';
        } else if (
          machine.current_state === 'INSPECTION' ||
          machine.current_state === 'PM_MAINTENANCE' ||
          machine.current_state === 'MODEL_CHANGE'
        ) {
          severity = 'warning';
          title = '설비 작업 중';
        }

        alerts.push({
          id: `maintenance:${machine.id}:${machine.current_state}:${machine.updated_at || 'unknown'}`,
          machine_id: machine.id,
          machine_name: machine.name,
          alert_type: 'maintenance',
          severity: severity,
          title: title,
          message: `${machine.name}이 현재 ${machine.current_state} 상태입니다.`,
          current_value: 0,
          threshold_value: 0,
          timestamp: currentTime.toISOString(),
          is_active: true,
          acknowledged: false
        });
      }
    });

    const acknowledgementRows: Array<{ alert_key: string; action: string }> = [];
    let acknowledgementError: { code?: string } | null = null;
    for (let from = 0; ; from += pageSize) {
      const { data, error } = await supabaseAdmin
        .from('alert_acknowledgements')
        .select('alert_key, action')
        .eq('user_id', authenticatedUser.userId)
        .order('alert_key', { ascending: true })
        .range(from, from + pageSize - 1);

      if (error) {
        acknowledgementError = error;
        break;
      }
      acknowledgementRows.push(...((data || []) as typeof acknowledgementRows));
      if (!data || data.length < pageSize) break;
    }

    if (acknowledgementError && acknowledgementError.code !== '42P01') {
      console.error('알림 확인 상태 조회 오류:', acknowledgementError);
    }

    const acknowledgementByKey = new Map(
      acknowledgementRows.map(row => [row.alert_key, row.action])
    );
    alerts.forEach(alert => {
      const action = acknowledgementByKey.get(alert.id);
      alert.acknowledged = action === 'acknowledge' || action === 'dismiss';
      if (action === 'dismiss') alert.is_active = false;
    });

    // 필터링 적용
    let filteredAlerts = alerts;

    if (machineId) {
      filteredAlerts = filteredAlerts.filter(alert => alert.machine_id === machineId);
    }

    if (severity) {
      filteredAlerts = filteredAlerts.filter(alert => alert.severity === severity);
    }

    if (isActive !== null) {
      const activeFilter = isActive === 'true';
      filteredAlerts = filteredAlerts.filter(alert => alert.is_active === activeFilter);
    }

    // 심각도 및 시간 순으로 정렬
    filteredAlerts.sort((a, b) => {
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
      
      if (severityDiff !== 0) {
        return severityDiff;
      }
      
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    // 결과 제한
    const limitedAlerts = filteredAlerts.slice(0, limit);

    // 알림 요약 통계
    const alertSummary = {
      total_alerts: filteredAlerts.length,
      critical_count: filteredAlerts.filter(a => a.severity === 'critical').length,
      warning_count: filteredAlerts.filter(a => a.severity === 'warning').length,
      info_count: filteredAlerts.filter(a => a.severity === 'info').length,
      active_alerts: filteredAlerts.filter(a => a.is_active).length,
      unacknowledged_alerts: filteredAlerts.filter(a => !a.acknowledged).length,
      alert_types: {
        oee: filteredAlerts.filter(a => a.alert_type === 'oee').length,
        availability: filteredAlerts.filter(a => a.alert_type === 'availability').length,
        performance: filteredAlerts.filter(a => a.alert_type === 'performance').length,
        quality: filteredAlerts.filter(a => a.alert_type === 'quality').length,
        downtime: filteredAlerts.filter(a => a.alert_type === 'downtime').length,
        maintenance: filteredAlerts.filter(a => a.alert_type === 'maintenance').length
      }
    };

    const response = {
      alerts: limitedAlerts,
      summary: alertSummary,
      thresholds: ALERT_THRESHOLDS,
      metadata: {
        query_time: currentTime.toISOString(),
        filters: {
          machine_id: machineId,
          severity: severity,
          is_active: isActive,
          limit: limit
        },
        analysis_window: {
          start_time: recentTime.toISOString(),
          end_time: currentTime.toISOString(),
          duration_minutes: 30,
          performance_business_date: currentBusinessDate,
          performance_shift: currentShift,
        }
      }
    };

    console.info('✅ 실시간 알림 분석 완료:', {
      총알림: alertSummary.total_alerts,
      치명적: alertSummary.critical_count,
      경고: alertSummary.warning_count,
      활성: alertSummary.active_alerts
    });

    return NextResponse.json(response);

  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('❌ 실시간 알림 API 오류:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST /api/alerts - 알림 상태 업데이트 (확인 처리 등)
export async function POST(request: NextRequest) {
  try {
    const authenticatedUser = await requireUser(request, ['admin', 'engineer']);
    const body = await request.json();
    const { alert_id, action } = body; // action: 'acknowledge', 'dismiss'

    console.info('🔔 알림 상태 업데이트:', { alert_id, action });

    if (typeof alert_id !== 'string' || !alert_id.trim()) {
      return NextResponse.json({ success: false, error: 'alert_id is required' }, { status: 400 });
    }
    if (action !== 'acknowledge' && action !== 'dismiss') {
      return NextResponse.json({ success: false, error: 'Invalid alert action' }, { status: 400 });
    }

    const updatedAt = new Date().toISOString();
    const { error: persistenceError } = await supabaseAdmin
      .from('alert_acknowledgements')
      .upsert({
        alert_key: alert_id,
        user_id: authenticatedUser.userId,
        action,
        updated_at: updatedAt,
      }, { onConflict: 'alert_key,user_id' });

    if (persistenceError) {
      console.error('알림 확인 상태 저장 오류:', persistenceError);
      return NextResponse.json(
        { success: false, error: 'Failed to persist alert acknowledgement' },
        { status: persistenceError.code === '42P01' ? 503 : 500 }
      );
    }

    const response = {
      success: true,
      alert_id,
      action,
      updated_at: updatedAt,
      message: `알림 ${alert_id}이 ${action === 'acknowledge' ? '확인' : '해제'}되었습니다.`
    };

    console.info('✅ 알림 상태 업데이트 완료:', response);

    return NextResponse.json(response);

  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;

    console.error('❌ 알림 상태 업데이트 오류:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
