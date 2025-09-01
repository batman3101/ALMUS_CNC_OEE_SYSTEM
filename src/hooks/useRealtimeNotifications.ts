'use client';

import { useState, useEffect, useCallback } from 'react';
import { notification, message } from 'antd';

interface NotificationRule {
  id: string;
  type: 'oee_target' | 'quality_issue' | 'production_target' | 'machine_status';
  condition: 'below' | 'above' | 'equals';
  threshold: number;
  priority: 'low' | 'medium' | 'high' | 'critical';
  enabled: boolean;
  message: string;
}

interface ProductionAlert {
  id: string;
  type: NotificationRule['type'];
  priority: NotificationRule['priority'];
  message: string;
  machineId?: string;
  machineName?: string;
  value?: number;
  threshold?: number;
  timestamp: string;
  acknowledged: boolean;
}

interface UseRealtimeNotificationsProps {
  productionRecords?: any[];
  aggregatedData?: {
    totalProduction: number;
    totalDefects: number;
    avgOEE: number;
    avgQuality: number;
  };
  machines?: any[];
}

// 기본 알림 규칙
const DEFAULT_NOTIFICATION_RULES: NotificationRule[] = [
  {
    id: 'oee_low',
    type: 'oee_target',
    condition: 'below',
    threshold: 60, // 60% 미만
    priority: 'high',
    enabled: true,
    message: 'OEE가 목표치({threshold}%) 미만입니다: {value}%'
  },
  {
    id: 'oee_critical',
    type: 'oee_target',
    condition: 'below',
    threshold: 40, // 40% 미만
    priority: 'critical',
    enabled: true,
    message: '긴급: OEE가 심각히 낮습니다: {value}%'
  },
  {
    id: 'quality_issue',
    type: 'quality_issue',
    condition: 'below',
    threshold: 90, // 품질 90% 미만
    priority: 'medium',
    enabled: true,
    message: '품질 이슈 발생: 품질율 {value}% (목표: {threshold}%)'
  },
  {
    id: 'quality_critical',
    type: 'quality_issue',
    condition: 'below',
    threshold: 80, // 품질 80% 미만
    priority: 'high',
    enabled: true,
    message: '심각한 품질 이슈: 품질율 {value}% 즉시 확인 필요'
  },
  {
    id: 'production_target',
    type: 'production_target',
    condition: 'below',
    threshold: 80, // 생산 목표 대비 80% 미만
    priority: 'medium',
    enabled: true,
    message: '생산 목표 미달성: {value}% 달성 (목표: {threshold}%)'
  }
];

export const useRealtimeNotifications = ({
  productionRecords = [],
  aggregatedData,
  machines = []
}: UseRealtimeNotificationsProps = {}) => {
  const [alerts, setAlerts] = useState<ProductionAlert[]>([]);
  const [rules, setRules] = useState<NotificationRule[]>(DEFAULT_NOTIFICATION_RULES);
  const [lastCheckTimestamp, setLastCheckTimestamp] = useState<number>(Date.now());

  // 알림 생성 함수
  const createAlert = useCallback((
    type: NotificationRule['type'],
    priority: NotificationRule['priority'],
    message: string,
    machineId?: string,
    machineName?: string,
    value?: number,
    threshold?: number
  ): ProductionAlert => ({
    id: `${type}_${machineId || 'global'}_${Date.now()}`,
    type,
    priority,
    message,
    machineId,
    machineName,
    value,
    threshold,
    timestamp: new Date().toISOString(),
    acknowledged: false
  }), []);

  // 브라우저 알림 표시 함수
  const showNotification = useCallback((alert: ProductionAlert) => {
    const config = {
      message: `${alert.machineName ? `[${alert.machineName}] ` : ''}생산 알림`,
      description: alert.message,
      placement: 'topRight' as const,
      duration: alert.priority === 'critical' ? 0 : alert.priority === 'high' ? 10 : 6,
    };

    if (alert.priority === 'critical') {
      notification.error(config);
    } else if (alert.priority === 'high') {
      notification.warning(config);
    } else {
      notification.info(config);
    }

    // 중요도가 높은 경우 시스템 알림도 표시
    if (alert.priority === 'critical' || alert.priority === 'high') {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification(`CNC OEE 모니터링`, {
          body: alert.message,
          icon: '/favicon.ico',
          tag: alert.id
        });
      }
    }
  }, []);

  // 알림 규칙 확인 및 알림 생성
  const checkNotificationRules = useCallback(() => {
    const newAlerts: ProductionAlert[] = [];
    const currentTimestamp = Date.now();

    // 전체 OEE 및 품질 검사
    if (aggregatedData) {
      rules.forEach(rule => {
        if (!rule.enabled) return;

        let shouldAlert = false;
        let value: number;
        let alertMessage = rule.message;

        switch (rule.type) {
          case 'oee_target':
            value = aggregatedData.avgOEE;
            if (rule.condition === 'below' && value < rule.threshold) {
              shouldAlert = true;
            }
            break;

          case 'quality_issue':
            value = aggregatedData.avgQuality;
            if (rule.condition === 'below' && value < rule.threshold) {
              shouldAlert = true;
            }
            break;

          case 'production_target':
            // 간단한 생산 목표 대비 계산 (실제로는 더 복잡한 로직 필요)
            const totalProduced = aggregatedData.totalProduction;
            const dailyTarget = 1000; // 하드코딩된 목표값 (실제로는 설정에서 가져와야 함)
            value = Math.round((totalProduced / dailyTarget) * 100);
            if (rule.condition === 'below' && value < rule.threshold) {
              shouldAlert = true;
            }
            break;
        }

        if (shouldAlert) {
          alertMessage = alertMessage
            .replace('{value}', value!.toFixed(1))
            .replace('{threshold}', rule.threshold.toString());

          const alert = createAlert(
            rule.type,
            rule.priority,
            alertMessage,
            undefined,
            undefined,
            value!,
            rule.threshold
          );

          newAlerts.push(alert);
        }
      });
    }

    // 설비별 검사
    productionRecords.forEach(record => {
      const machineId = record.machine_id;
      const machineName = `CNC-${machineId}`;

      rules.forEach(rule => {
        if (!rule.enabled) return;

        let shouldAlert = false;
        let value: number;
        let alertMessage = rule.message;

        switch (rule.type) {
          case 'oee_target':
            value = record.oee * 100; // 백분율로 변환
            if (rule.condition === 'below' && value < rule.threshold) {
              shouldAlert = true;
            }
            break;

          case 'quality_issue':
            value = record.quality * 100; // 백분율로 변환
            if (rule.condition === 'below' && value < rule.threshold) {
              shouldAlert = true;
            }
            break;
        }

        if (shouldAlert) {
          alertMessage = alertMessage
            .replace('{value}', value!.toFixed(1))
            .replace('{threshold}', rule.threshold.toString());

          const alert = createAlert(
            rule.type,
            rule.priority,
            alertMessage,
            machineId,
            machineName,
            value!,
            rule.threshold
          );

          newAlerts.push(alert);
        }
      });
    });

    // 새로운 알림만 추가 및 표시
    if (newAlerts.length > 0) {
      setAlerts(prev => {
        const existingAlertIds = new Set(prev.map(alert => 
          `${alert.type}_${alert.machineId || 'global'}`
        ));

        const trulyNewAlerts = newAlerts.filter(alert => 
          !existingAlertIds.has(`${alert.type}_${alert.machineId || 'global'}`)
        );

        // 새로운 알림 표시
        trulyNewAlerts.forEach(alert => {
          showNotification(alert);
        });

        return [...prev, ...trulyNewAlerts];
      });
    }

    setLastCheckTimestamp(currentTimestamp);
  }, [aggregatedData, productionRecords, rules, createAlert, showNotification]);

  // 실시간 알림 검사
  useEffect(() => {
    if (!aggregatedData && productionRecords.length === 0) return;

    // 초기 검사
    checkNotificationRules();

    // 주기적 검사 (30초마다)
    const interval = setInterval(checkNotificationRules, 30000);

    return () => clearInterval(interval);
  }, [checkNotificationRules]);

  // 브라우저 알림 권한 요청
  const requestNotificationPermission = useCallback(async () => {
    if ('Notification' in window) {
      const permission = await Notification.requestPermission();
      if (permission === 'granted') {
        message.success('브라우저 알림이 활성화되었습니다');
      } else if (permission === 'denied') {
        message.warning('브라우저 알림이 차단되었습니다');
      }
      return permission;
    }
    return 'denied';
  }, []);

  // 알림 확인 처리
  const acknowledgeAlert = useCallback((alertId: string) => {
    setAlerts(prev => 
      prev.map(alert => 
        alert.id === alertId 
          ? { ...alert, acknowledged: true }
          : alert
      )
    );
  }, []);

  // 모든 알림 확인
  const acknowledgeAllAlerts = useCallback(() => {
    setAlerts(prev => 
      prev.map(alert => ({ ...alert, acknowledged: true }))
    );
  }, []);

  // 알림 삭제
  const removeAlert = useCallback((alertId: string) => {
    setAlerts(prev => prev.filter(alert => alert.id !== alertId));
  }, []);

  // 모든 알림 삭제
  const clearAllAlerts = useCallback(() => {
    setAlerts([]);
  }, []);

  // 알림 규칙 업데이트
  const updateRule = useCallback((ruleId: string, updates: Partial<NotificationRule>) => {
    setRules(prev => 
      prev.map(rule => 
        rule.id === ruleId 
          ? { ...rule, ...updates }
          : rule
      )
    );
  }, []);

  // 활성 알림 통계
  const alertStats = {
    total: alerts.length,
    unacknowledged: alerts.filter(alert => !alert.acknowledged).length,
    critical: alerts.filter(alert => alert.priority === 'critical').length,
    high: alerts.filter(alert => alert.priority === 'high').length,
    byType: {
      oee_target: alerts.filter(alert => alert.type === 'oee_target').length,
      quality_issue: alerts.filter(alert => alert.type === 'quality_issue').length,
      production_target: alerts.filter(alert => alert.type === 'production_target').length,
      machine_status: alerts.filter(alert => alert.type === 'machine_status').length
    }
  };

  return {
    alerts: alerts.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()),
    rules,
    alertStats,
    acknowledgeAlert,
    acknowledgeAllAlerts,
    removeAlert,
    clearAllAlerts,
    updateRule,
    requestNotificationPermission,
    checkNotificationRules,
    lastCheckTimestamp
  };
};