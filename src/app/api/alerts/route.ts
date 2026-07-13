import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { unwrapJoin } from '@/types';

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

// GET /api/alerts - 실시간 알림 조회
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id');
    const severity = searchParams.get('severity'); // 'critical', 'warning', 'info'
    const isActive = searchParams.get('is_active'); // 'true', 'false'
    const limit = parseInt(searchParams.get('limit') || '50');

    console.info('🔔 실시간 알림 API 요청:', { machineId, severity, isActive, limit });

    // 현재 시간 기준으로 최근 데이터 조회
    const currentTime = new Date();
    const recentTime = new Date(currentTime.getTime() - 30 * 60 * 1000); // 최근 30분

    // 현재 운영 중인 설비 상태 조회
    const { data: currentStatus, error: statusError } = await supabaseAdmin
      .from('machines')
      .select(`
        id,
        name,
        current_state,
        equipment_type,
        location
      `)
      .eq('is_active', true);

    if (statusError) {
      console.error('설비 상태 조회 오류:', statusError);
      return NextResponse.json(
        { error: 'Failed to fetch machine status' },
        { status: 500 }
      );
    }

    // 최근 생산 기록 조회 (성능 지표용)
    let performanceQuery = supabaseAdmin
      .from('production_records')
      .select(`
        machine_id,
        oee,
        availability,
        performance,
        quality,
        date,
        shift,
        machines!inner(name, equipment_type)
      `)
      .gte('date', recentTime.toISOString().split('T')[0])
      .order('date', { ascending: false })
      .limit(200);

    if (machineId) {
      performanceQuery = performanceQuery.eq('machine_id', machineId);
    }

    const { data: performanceData, error: perfError } = await performanceQuery;

    if (perfError) {
      console.error('성능 데이터 조회 오류:', perfError);
      return NextResponse.json(
        { error: 'Failed to fetch performance data' },
        { status: 500 }
      );
    }

    // 최근 다운타임 로그 조회
    let downtimeQuery = supabaseAdmin
      .from('machine_logs')
      .select(`
        machine_id,
        state,
        start_time,
        end_time,
        duration,
        machines!inner(name, equipment_type)
      `)
      .gte('start_time', recentTime.toISOString())
      .neq('state', 'NORMAL_OPERATION')
      .order('start_time', { ascending: false })
      .limit(100);

    if (machineId) {
      downtimeQuery = downtimeQuery.eq('machine_id', machineId);
    }

    const { data: downtimeData, error: downtimeError } = await downtimeQuery;

    if (downtimeError) {
      console.error('다운타임 데이터 조회 오류:', downtimeError);
    }

    // 알림 생성 로직
    const alerts: Alert[] = [];
    let alertId = 1;

    // 1. 성능 지표 기반 알림 생성
    const machinePerformance: Record<string, {
      machine_id: string;
      machine_name: string;
      latest_oee: number;
      latest_availability: number;
      latest_performance: number;
      latest_quality: number;
      record_count: number;
    }> = {};

    (performanceData || []).forEach(record => {
      const machineId = record.machine_id;
      const machineName = unwrapJoin(record.machines)?.name || 'Unknown';

      if (!machinePerformance[machineId]) {
        machinePerformance[machineId] = {
          machine_id: machineId,
          machine_name: machineName,
          latest_oee: record.oee || 0,
          latest_availability: record.availability || 0,
          latest_performance: record.performance || 0,
          latest_quality: record.quality || 0,
          record_count: 1
        };
      } else {
        // 최신 기록으로 업데이트 (이미 date 순으로 정렬됨)
        if (machinePerformance[machineId].record_count === 1) {
          machinePerformance[machineId].latest_oee = record.oee || 0;
          machinePerformance[machineId].latest_availability = record.availability || 0;
          machinePerformance[machineId].latest_performance = record.performance || 0;
          machinePerformance[machineId].latest_quality = record.quality || 0;
        }
        machinePerformance[machineId].record_count++;
      }
    });

    // 성능 지표별 알림 생성
    Object.values(machinePerformance).forEach(machine => {
      const oee = machine.latest_oee * 100;
      const availability = machine.latest_availability * 100;
      const quality = machine.latest_quality * 100;

      // OEE 알림
      if (oee < ALERT_THRESHOLDS.oee.critical) {
        alerts.push({
          id: `alert_${alertId++}`,
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
      } else if (oee < ALERT_THRESHOLDS.oee.warning) {
        alerts.push({
          id: `alert_${alertId++}`,
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
      if (availability < ALERT_THRESHOLDS.availability.critical) {
        alerts.push({
          id: `alert_${alertId++}`,
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
      } else if (availability < ALERT_THRESHOLDS.availability.warning) {
        alerts.push({
          id: `alert_${alertId++}`,
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

      // 품질 알림
      if (quality < ALERT_THRESHOLDS.quality.critical) {
        alerts.push({
          id: `alert_${alertId++}`,
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
      } else if (quality < ALERT_THRESHOLDS.quality.warning) {
        alerts.push({
          id: `alert_${alertId++}`,
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
      const duration = log.duration || 0;
      const machineName = unwrapJoin(log.machines)?.name || 'Unknown';

      if (duration >= ALERT_THRESHOLDS.downtime.critical) {
        alerts.push({
          id: `alert_${alertId++}`,
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
          id: `alert_${alertId++}`,
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
          id: `alert_${alertId++}`,
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
          duration_minutes: 30
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
    const body = await request.json();
    const { alert_id, action } = body; // action: 'acknowledge', 'dismiss'

    console.info('🔔 알림 상태 업데이트:', { alert_id, action });

    // 실제 환경에서는 alerts 테이블에 저장/업데이트
    // 현재는 메모리 기반이므로 성공 응답만 반환

    const response = {
      success: true,
      alert_id,
      action,
      updated_at: new Date().toISOString(),
      message: `알림 ${alert_id}이 ${action === 'acknowledge' ? '확인' : '해제'}되었습니다.`
    };

    console.info('✅ 알림 상태 업데이트 완료:', response);

    return NextResponse.json(response);

  } catch (error) {
    console.error('❌ 알림 상태 업데이트 오류:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}