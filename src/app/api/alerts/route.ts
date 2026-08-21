import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { unwrapJoin } from '@/types';
import { apiAuthErrorResponse, requireUser } from '@/lib/apiAuth';
import { getBusinessDateAt, getShiftAt } from '@/utils/downtimeIntervals';
import {
  DEFAULT_ALERT_THRESHOLDS,
  DEFAULT_BUSINESS_CLOCK,
  resolveAlertConfig,
  type SettingRow,
} from './alertThresholds';

/**
 * 시계와 임계값을 **한 번의 조회**로 읽는다.
 *
 * 알림 엔드포인트는 대시보드가 주기적으로 부른다. 같은 테이블을 두 번 읽을 이유가 없다.
 */
async function loadAlertConfig(): Promise<ReturnType<typeof resolveAlertConfig>> {
  const { data, error } = await supabaseAdmin
    .from('system_settings')
    .select('category, setting_key, setting_value')
    .in('category', ['general', 'shift', 'oee'])
    .eq('is_active', true);

  if (error || !data) {
    // 조회 실패는 "설정이 기본값이다"와 다른 사건이다. 구분해서 알린다.
    console.error('알림 임계값 설정 조회 실패 — 기본값으로 판정한다:', error);
    return {
      clock: DEFAULT_BUSINESS_CLOCK,
      thresholds: DEFAULT_ALERT_THRESHOLDS,
      thresholdFallbacks: ['settings_unreadable'],
    };
  }

  return resolveAlertConfig(data as SettingRow[]);
}

// 알림 타입 정의
interface Alert {
  id: string;
  machine_id: string;
  machine_name: string;
  alert_type: 'oee' | 'availability' | 'performance' | 'quality' | 'downtime';
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  current_value: number;
  threshold_value: number;
  /**
   * 이 알림이 가리키는 **사건이 실제로 일어난 시각**.
   *
   * 조회 시각이 아니다. 예전에는 여기에 `new Date()` 를 넣어서, 사흘 전에 고장 난 설비와
   * 방금 고장 난 설비가 화면에서 같은 1초로 표시됐다. 정렬도 무의미해지고 "언제부터"를
   * 알 수 없게 된다.
   *
   * 출처를 특정할 수 없으면 `null` 이다 — 현재 시각으로 메우지 않는다.
   */
  timestamp: string | null;
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
    const { clock: businessClock, thresholds: alertThresholds, thresholdFallbacks } =
      await loadAlertConfig();
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
      /** 이 지표가 담긴 생산실적이 등록된 시각. 지표 알림의 사건 시각이다. */
      recorded_at: string | null;
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
          recorded_at: record.created_at ?? null,
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
      if (oee !== null && oee < alertThresholds.oee.critical) {
        alerts.push({
          id: `oee:${machine.machine_id}:${machine.source_key}:critical`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'oee',
          severity: 'critical',
          title: 'OEE 치명적 저하',
          message: `${machine.machine_name}의 OEE가 ${oee.toFixed(1)}%로 임계값(${alertThresholds.oee.critical}%)을 하회했습니다.`,
          current_value: oee,
          threshold_value: alertThresholds.oee.critical,
          timestamp: machine.recorded_at,
          is_active: true,
          acknowledged: false
        });
      } else if (oee !== null && oee < alertThresholds.oee.warning) {
        alerts.push({
          id: `oee:${machine.machine_id}:${machine.source_key}:warning`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'oee',
          severity: 'warning',
          title: 'OEE 경고',
          message: `${machine.machine_name}의 OEE가 ${oee.toFixed(1)}%로 경고 수준입니다.`,
          current_value: oee,
          threshold_value: alertThresholds.oee.warning,
          timestamp: machine.recorded_at,
          is_active: true,
          acknowledged: false
        });
      }

      // 가용성 알림
      if (availability !== null && availability < alertThresholds.availability.critical) {
        alerts.push({
          id: `availability:${machine.machine_id}:${machine.source_key}:critical`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'availability',
          severity: 'critical',
          title: '가용성 치명적 저하',
          message: `${machine.machine_name}의 가용성이 ${availability.toFixed(1)}%로 임계값을 하회했습니다.`,
          current_value: availability,
          threshold_value: alertThresholds.availability.critical,
          timestamp: machine.recorded_at,
          is_active: true,
          acknowledged: false
        });
      } else if (availability !== null && availability < alertThresholds.availability.warning) {
        alerts.push({
          id: `availability:${machine.machine_id}:${machine.source_key}:warning`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'availability',
          severity: 'warning',
          title: '가용성 경고',
          message: `${machine.machine_name}의 가용성이 ${availability.toFixed(1)}%로 경고 수준입니다.`,
          current_value: availability,
          threshold_value: alertThresholds.availability.warning,
          timestamp: machine.recorded_at,
          is_active: true,
          acknowledged: false
        });
      }

      // 성능 알림
      if (performance !== null && performance < alertThresholds.performance.critical) {
        alerts.push({
          id: `performance:${machine.machine_id}:${machine.source_key}:critical`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'performance',
          severity: 'critical',
          title: '성능 치명적 저하',
          message: `${machine.machine_name}의 성능이 ${performance.toFixed(1)}%로 임계값을 하회했습니다.`,
          current_value: performance,
          threshold_value: alertThresholds.performance.critical,
          timestamp: machine.recorded_at,
          is_active: true,
          acknowledged: false
        });
      } else if (performance !== null && performance < alertThresholds.performance.warning) {
        alerts.push({
          id: `performance:${machine.machine_id}:${machine.source_key}:warning`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'performance',
          severity: 'warning',
          title: '성능 경고',
          message: `${machine.machine_name}의 성능이 ${performance.toFixed(1)}%로 경고 수준입니다.`,
          current_value: performance,
          threshold_value: alertThresholds.performance.warning,
          timestamp: machine.recorded_at,
          is_active: true,
          acknowledged: false
        });
      }

      // 품질 알림
      if (quality !== null && quality < alertThresholds.quality.critical) {
        alerts.push({
          id: `quality:${machine.machine_id}:${machine.source_key}:critical`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'quality',
          severity: 'critical',
          title: '품질 치명적 저하',
          message: `${machine.machine_name}의 품질이 ${quality.toFixed(1)}%로 임계값을 하회했습니다.`,
          current_value: quality,
          threshold_value: alertThresholds.quality.critical,
          timestamp: machine.recorded_at,
          is_active: true,
          acknowledged: false
        });
      } else if (quality !== null && quality < alertThresholds.quality.warning) {
        alerts.push({
          id: `quality:${machine.machine_id}:${machine.source_key}:warning`,
          machine_id: machine.machine_id,
          machine_name: machine.machine_name,
          alert_type: 'quality',
          severity: 'warning',
          title: '품질 경고',
          message: `${machine.machine_name}의 품질이 ${quality.toFixed(1)}%로 경고 수준입니다.`,
          current_value: quality,
          threshold_value: alertThresholds.quality.warning,
          timestamp: machine.recorded_at,
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

      if (duration >= alertThresholds.downtime.critical) {
        alerts.push({
          id: `downtime:${log.machine_id}:${log.source_key}:critical`,
          machine_id: log.machine_id,
          machine_name: machineName,
          alert_type: 'downtime',
          severity: 'critical',
          title: '장기 다운타임 발생',
          message: `${machineName}이 ${duration}분간 ${log.state} 상태로 다운타임이 지속되고 있습니다.`,
          current_value: duration,
          threshold_value: alertThresholds.downtime.critical,
          timestamp: log.start_time,
          is_active: !log.end_time,
          acknowledged: false
        });
      } else if (duration >= alertThresholds.downtime.warning) {
        alerts.push({
          id: `downtime:${log.machine_id}:${log.source_key}:warning`,
          machine_id: log.machine_id,
          machine_name: machineName,
          alert_type: 'downtime',
          severity: 'warning',
          title: '다운타임 경고',
          message: `${machineName}이 ${duration}분간 ${log.state} 상태입니다.`,
          current_value: duration,
          threshold_value: alertThresholds.downtime.warning,
          timestamp: log.start_time,
          is_active: !log.end_time,
          acknowledged: false
        });
      }
    });

    // 3. 설비 상태 기반 알림은 **여기서 만들지 않는다.**
    //
    // `current_state !== 'NORMAL_OPERATION'` 이라는 똑같은 술어를 `NotificationContext` 가
    // 이미 평가한다. 판정이 같으니 둘 중 하나는 순수 잉여였고, 관리자 화면에는 같은 고장이
    // 세 번(여기 + NotificationContext + 아래 다운타임) 나열됐다 — 설비 17대에 알림 51건.
    //
    // 남길 쪽으로 `NotificationContext` 를 골랐다. 그쪽만 번역 키를 쓰기 때문이다. 여기서
    // 만들던 문구는 한국어가 하드코딩돼 있고 `BREAKDOWN_REPAIR` 같은 enum 을 그대로 노출해,
    // 베트남어 사용자에게는 읽을 수 없는 문자열이었다. 브라우저 알림·소리와 "정상 복귀 시
    // 확인 이력 정리"도 그쪽에만 있다.
    //
    // 커버리지는 줄지 않는다. `NotificationContext` 는 임계값과 무관하게 모든 비정상 상태를
    // 다루므로, 짧은 비정상 상태도 그대로 보고된다. 아래 다운타임 알림은 "임계값을 넘겨
    // 지속되고 있다"는 **다른 사실**을 말하므로 그대로 둔다.

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
      
      // 시각 미상(null)은 심각도 그룹 안에서 뒤로 보낸다. `new Date(null)` 은 1970년이 되어
      // "가장 오래된 알림"으로 둔갑하는데, 모른다는 것과 오래됐다는 것은 다른 사실이다.
      const at = a.timestamp ? Date.parse(a.timestamp) : NaN;
      const bt = b.timestamp ? Date.parse(b.timestamp) : NaN;
      if (Number.isNaN(at) && Number.isNaN(bt)) return 0;
      if (Number.isNaN(at)) return 1;
      if (Number.isNaN(bt)) return -1;
      return bt - at;
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
        downtime: filteredAlerts.filter(a => a.alert_type === 'downtime').length
      }
    };

    const response = {
      alerts: limitedAlerts,
      summary: alertSummary,
      thresholds: alertThresholds,
      metadata: {
        // 임계값이 설정이 아니라 기본값으로 판정된 지표. 비어 있으면 전부 설정대로다.
        // 이걸 숨기면 "설정을 바꿨는데 알림이 그대로"인 이유를 밖에서 알 수 없다.
        threshold_fallbacks: thresholdFallbacks,
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
