'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authFetch';

interface ApiOperationalAlert {
  id: string;
  machine_name?: string;
  severity: 'critical' | 'warning' | 'info';
  message: string;
  timestamp: string;
  acknowledged: boolean;
  alert_type: string;
}

export interface OperationalAlert {
  id: string;
  priority: 'critical' | 'high' | 'low';
  message: string;
  machineName?: string;
  timestamp: string;
  acknowledged: boolean;
  type: string;
}

const POLL_INTERVAL_MS = 60_000;

export function useOperationalAlerts() {
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshAlerts = useCallback(async (signal?: AbortSignal) => {
    try {
      const response = await authFetch('/api/alerts?limit=10000', {
        cache: 'no-store',
        signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json() as { alerts?: ApiOperationalAlert[] };
      const nextAlerts = (payload.alerts || []).map(alert => ({
        id: alert.id,
        priority: alert.severity === 'critical' ? 'critical' as const
          : alert.severity === 'warning' ? 'high' as const
            : 'low' as const,
        message: alert.message,
        machineName: alert.machine_name,
        timestamp: alert.timestamp,
        acknowledged: alert.acknowledged,
        type: alert.alert_type,
      }));
      setAlerts(nextAlerts);
      setError(null);
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') return;
      console.error('운영 알림 조회 실패:', caught);
      setError('운영 알림을 불러오지 못했습니다.');
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void refreshAlerts(controller.signal);
    const timer = window.setInterval(() => void refreshAlerts(), POLL_INTERVAL_MS);
    return () => {
      controller.abort();
      window.clearInterval(timer);
    };
  }, [refreshAlerts]);

  const updateAlert = useCallback(async (alertId: string, action: 'acknowledge' | 'dismiss') => {
    const response = await authFetch('/api/alerts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ alert_id: alertId, action }),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
  }, []);

  const acknowledgeAlert = useCallback(async (id?: string | number) => {
    if (typeof id !== 'string') return;
    try {
      await updateAlert(id, 'acknowledge');
      setAlerts(previous => previous.map(alert =>
        alert.id === id ? { ...alert, acknowledged: true } : alert
      ));
    } catch (caught) {
      console.error('운영 알림 확인 저장 실패:', caught);
      setError('알림 확인 상태를 저장하지 못했습니다.');
    }
  }, [updateAlert]);

  const clearAllAlerts = useCallback(async () => {
    const ids = alerts.filter(alert => !alert.acknowledged).map(alert => alert.id);
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map(id => updateAlert(id, 'dismiss')));
    const dismissed = new Set(
      ids.filter((_, index) => results[index].status === 'fulfilled')
    );
    setAlerts(previous => previous.filter(alert => !dismissed.has(alert.id)));
    if (dismissed.size !== ids.length) setError('일부 알림을 해제하지 못했습니다.');
  }, [alerts, updateAlert]);

  const requestNotificationPermission = useCallback(async () => {
    if (!('Notification' in window)) return 'denied' as NotificationPermission;
    return Notification.requestPermission();
  }, []);

  const alertStats = useMemo(() => ({
    total: alerts.length,
    unacknowledged: alerts.filter(alert => !alert.acknowledged).length,
    critical: alerts.filter(alert => alert.priority === 'critical').length,
    high: alerts.filter(alert => alert.priority === 'high').length,
    byType: alerts.reduce<Record<string, number>>((counts, alert) => {
      counts[alert.type] = (counts[alert.type] || 0) + 1;
      return counts;
    }, {}),
  }), [alerts]);

  return {
    alerts,
    error,
    alertStats,
    acknowledgeAlert,
    clearAllAlerts,
    requestNotificationPermission,
    refreshAlerts,
  };
}
