import {
  NotificationDetectionResult,
  NotificationSeverity
} from '@/types/notifications';
import { OEEMetrics, Machine, MachineLog } from '@/types';

// OEE 임계치 설정
const OEE_THRESHOLDS = {
  CRITICAL: 0.5,  // 50% 미만
  HIGH: 0.6,      // 60% 미만
  MEDIUM: 0.7,    // 70% 미만
  LOW: 0.8        // 80% 미만
};

// 다운타임 임계치 (분)
const DOWNTIME_THRESHOLDS = {
  CRITICAL: 120,  // 2시간
  HIGH: 90,       // 1.5시간
  MEDIUM: 60,     // 1시간
  LOW: 30         // 30분
};

// 품질 임계치 (불량률 %)
const QUALITY_THRESHOLDS = {
  CRITICAL: 10,   // 10%
  HIGH: 7,        // 7%
  MEDIUM: 5,      // 5%
  LOW: 3          // 3%
};

/**
 * OEE 저하 감지
 */
export const detectOEELow = (
  machine: Machine,
  oeeMetrics: OEEMetrics,
  duration: number = 30 // 지속 시간 (분)
): NotificationDetectionResult | null => {
  const oeePercent = oeeMetrics.oee * 100;
  
  let severity: NotificationSeverity;
  let threshold: number;
  
  if (oeePercent < OEE_THRESHOLDS.CRITICAL * 100) {
    severity = 'critical';
    threshold = OEE_THRESHOLDS.CRITICAL * 100;
  } else if (oeePercent < OEE_THRESHOLDS.HIGH * 100) {
    severity = 'high';
    threshold = OEE_THRESHOLDS.HIGH * 100;
  } else if (oeePercent < OEE_THRESHOLDS.MEDIUM * 100) {
    severity = 'medium';
    threshold = OEE_THRESHOLDS.MEDIUM * 100;
  } else if (oeePercent < OEE_THRESHOLDS.LOW * 100) {
    severity = 'low';
    threshold = OEE_THRESHOLDS.LOW * 100;
  } else {
    return null; // 임계치 이상이므로 알림 불필요
  }

  return {
    shouldNotify: true,
    type: 'OEE_LOW',
    severity,
    title: 'OEE 저하 경고',
    message: `OEE가 ${threshold}% 미만으로 ${duration}분 이상 지속되고 있습니다.`,
    threshold_value: threshold,
    current_value: Math.round(oeePercent * 10) / 10,
    metadata: {
      duration,
      availability: oeeMetrics.availability,
      performance: oeeMetrics.performance,
      quality: oeeMetrics.quality
    }
  };
};

/**
 * 다운타임 초과 감지
 */
export const detectDowntimeExceeded = (
  machine: Machine,
  currentLog: MachineLog,
  expectedDuration: number = 60 // 예상 지속 시간 (분)
): NotificationDetectionResult | null => {
  if (!currentLog.start_time || currentLog.state === 'NORMAL_OPERATION') {
    return null;
  }

  const startTime = new Date(currentLog.start_time);
  const currentTime = new Date();
  const actualDuration = Math.floor((currentTime.getTime() - startTime.getTime()) / (1000 * 60));

  if (actualDuration <= expectedDuration) {
    return null;
  }

  let severity: NotificationSeverity;
  const excessTime = actualDuration - expectedDuration;

  if (excessTime >= DOWNTIME_THRESHOLDS.CRITICAL) {
    severity = 'critical';
  } else if (excessTime >= DOWNTIME_THRESHOLDS.HIGH) {
    severity = 'high';
  } else if (excessTime >= DOWNTIME_THRESHOLDS.MEDIUM) {
    severity = 'medium';
  } else {
    severity = 'low';
  }

  const stateMessages = {
    'MAINTENANCE': '점검',
    'MODEL_CHANGE': '모델 교체',
    'PLANNED_STOP': '계획 정지',
    'PROGRAM_CHANGE': '프로그램 교체',
    'TOOL_CHANGE': '공구 교환',
    'TEMPORARY_STOP': '일시 정지'
  };

  const stateMessage = stateMessages[currentLog.state as keyof typeof stateMessages] || '비정상 상태';

  return {
    shouldNotify: true,
    type: 'DOWNTIME_EXCEEDED',
    severity,
    title: '다운타임 초과',
    message: `${stateMessage} 시간이 예상 시간을 ${excessTime}분 초과했습니다.`,
    threshold_value: expectedDuration,
    current_value: actualDuration,
    metadata: {
      state: currentLog.state,
      startTime: currentLog.start_time,
      expectedDuration,
      actualDuration,
      excessTime
    }
  };
};

/**
 * 품질 문제 감지
 */
export const detectQualityIssue = (
  machine: Machine,
  oeeMetrics: OEEMetrics
): NotificationDetectionResult | null => {
  if (oeeMetrics.output_qty === 0) {
    return null; // 생산량이 없으면 품질 검사 불가
  }

  const defectRate = (oeeMetrics.defect_qty / oeeMetrics.output_qty) * 100;
  
  let severity: NotificationSeverity;
  let threshold: number;

  if (defectRate >= QUALITY_THRESHOLDS.CRITICAL) {
    severity = 'critical';
    threshold = QUALITY_THRESHOLDS.CRITICAL;
  } else if (defectRate >= QUALITY_THRESHOLDS.HIGH) {
    severity = 'high';
    threshold = QUALITY_THRESHOLDS.HIGH;
  } else if (defectRate >= QUALITY_THRESHOLDS.MEDIUM) {
    severity = 'medium';
    threshold = QUALITY_THRESHOLDS.MEDIUM;
  } else if (defectRate >= QUALITY_THRESHOLDS.LOW) {
    severity = 'low';
    threshold = QUALITY_THRESHOLDS.LOW;
  } else {
    return null; // 임계치 이하이므로 알림 불필요
  }

  return {
    shouldNotify: true,
    type: 'QUALITY_ISSUE',
    severity,
    title: '품질 문제 발생',
    message: `불량률이 ${threshold}% 임계치를 초과했습니다.`,
    threshold_value: threshold,
    current_value: Math.round(defectRate * 10) / 10,
    metadata: {
      outputQty: oeeMetrics.output_qty,
      defectQty: oeeMetrics.defect_qty,
      defectRate,
      quality: oeeMetrics.quality
    }
  };
};

/**
 * 설비 정지 감지
 */
export const detectMachineStopped = (
  machine: Machine,
  currentLog: MachineLog,
  previousState?: string
): NotificationDetectionResult | null => {
  // 정상 운전에서 비정상 상태로 변경된 경우만 감지
  if (previousState !== 'NORMAL_OPERATION' || currentLog.state === 'NORMAL_OPERATION') {
    return null;
  }

  let severity: NotificationSeverity;
  
  // 상태에 따른 심각도 결정
  switch (currentLog.state) {
    case 'TEMPORARY_STOP':
      severity = 'critical'; // 예상치 못한 정지
      break;
    case 'MAINTENANCE':
      severity = 'medium'; // 계획된 점검
      break;
    case 'PLANNED_STOP':
      severity = 'low'; // 계획된 정지
      break;
    default:
      severity = 'medium';
  }

  const stateMessages = {
    'MAINTENANCE': '점검 모드로 전환되었습니다',
    'MODEL_CHANGE': '모델 교체가 시작되었습니다',
    'PLANNED_STOP': '계획 정지되었습니다',
    'PROGRAM_CHANGE': '프로그램 교체가 시작되었습니다',
    'TOOL_CHANGE': '공구 교환이 시작되었습니다',
    'TEMPORARY_STOP': '일시 정지되었습니다'
  };

  const message = stateMessages[currentLog.state as keyof typeof stateMessages] || '비정상 상태로 전환되었습니다';

  return {
    shouldNotify: true,
    type: 'MACHINE_STOPPED',
    severity,
    title: '설비 상태 변경',
    message,
    metadata: {
      previousState,
      currentState: currentLog.state,
      stateChangeTime: currentLog.start_time
    }
  };
};

/**
 * 점검 필요 감지 (운전 시간 기반)
 */
export const detectMaintenanceDue = (
  machine: Machine,
  totalRuntime: number, // 총 운전 시간 (시간)
  lastMaintenanceDate?: string
): NotificationDetectionResult | null => {
  const MAINTENANCE_INTERVAL_HOURS = 720; // 30일 * 24시간
  const WARNING_THRESHOLD_HOURS = 48; // 2일 전 경고

  let hoursSinceLastMaintenance = totalRuntime;
  
  if (lastMaintenanceDate) {
    const lastMaintenance = new Date(lastMaintenanceDate);
    const now = new Date();
    const daysSince = Math.floor((now.getTime() - lastMaintenance.getTime()) / (1000 * 60 * 60 * 24));
    hoursSinceLastMaintenance = daysSince * 24;
  }

  const hoursUntilMaintenance = MAINTENANCE_INTERVAL_HOURS - hoursSinceLastMaintenance;

  if (hoursUntilMaintenance > WARNING_THRESHOLD_HOURS) {
    return null; // 아직 점검 시기가 아님
  }

  let severity: NotificationSeverity;
  let message: string;

  if (hoursUntilMaintenance <= 0) {
    severity = 'high';
    message = '정기 점검 시기가 도래했습니다.';
  } else if (hoursUntilMaintenance <= 24) {
    severity = 'medium';
    message = `정기 점검까지 ${hoursUntilMaintenance}시간 남았습니다.`;
  } else {
    severity = 'low';
    message = `정기 점검까지 ${Math.ceil(hoursUntilMaintenance / 24)}일 남았습니다.`;
  }

  return {
    shouldNotify: true,
    type: 'MAINTENANCE_DUE',
    severity,
    title: '점검 필요',
    message,
    threshold_value: MAINTENANCE_INTERVAL_HOURS,
    current_value: hoursSinceLastMaintenance,
    metadata: {
      lastMaintenanceDate,
      totalRuntime,
      hoursUntilMaintenance,
      maintenanceIntervalHours: MAINTENANCE_INTERVAL_HOURS
    }
  };
};

/**
 * 종합 알림 감지 함수
 */
export const detectNotifications = (
  machine: Machine,
  oeeMetrics: OEEMetrics,
  currentLog?: MachineLog,
  previousState?: string,
  lastMaintenanceDate?: string
): NotificationDetectionResult[] => {
  const results: NotificationDetectionResult[] = [];

  // OEE 저하 감지
  const oeeResult = detectOEELow(machine, oeeMetrics);
  if (oeeResult) results.push(oeeResult);

  // 품질 문제 감지
  const qualityResult = detectQualityIssue(machine, oeeMetrics);
  if (qualityResult) results.push(qualityResult);

  // 현재 로그가 있는 경우
  if (currentLog) {
    // 다운타임 초과 감지
    const downtimeResult = detectDowntimeExceeded(machine, currentLog);
    if (downtimeResult) results.push(downtimeResult);

    // 설비 정지 감지
    const stoppedResult = detectMachineStopped(machine, currentLog, previousState);
    if (stoppedResult) results.push(stoppedResult);
  }

  // 점검 필요 감지
  const maintenanceResult = detectMaintenanceDue(
    machine, 
    oeeMetrics.actual_runtime / 60, // 분을 시간으로 변환
    lastMaintenanceDate
  );
  if (maintenanceResult) results.push(maintenanceResult);

  return results;
};