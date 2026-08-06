'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { authFetch } from '@/lib/authFetch';
import { useNotificationPreferences } from '@/hooks/useNotificationPreferences';

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

export function useOperationalAlerts() {
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  // 폴링 주기는 `notification.alert_check_interval_seconds` 를 따른다.
  // 예전에는 여기 60초가 상수로 박혀 있어서, 설정을 120초로 저장해도 앱은 60초로 돌았다.
  const { pollIntervalMs } = useNotificationPreferences();

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

  // 최초 1회 조회. 폴링 타이머와 분리한 이유는 아래 effect 주석에 있다.
  useEffect(() => {
    const controller = new AbortController();
    void refreshAlerts(controller.signal);
    return () => controller.abort();
  }, [refreshAlerts]);

  // 폴링 타이머.
  //
  // 주기를 의존성에 두어 설정이 **런타임에 바뀌면 다시 건다.** 마운트 시점 값을 잡아 두고
  // 다시 걸지 않으면 그것도 결국 고정 주기이고, 관리자는 설정을 바꿔 놓고 왜 안 바뀌는지
  // 모른 채 새로고침을 하게 된다.
  //
  // cleanup 이 옛 타이머를 반드시 지운다 — 지우지 않으면 주기를 한 번 바꿀 때마다 타이머가
  // 하나씩 늘어 서버 요청이 조용히 배로 뛴다.
  //
  // 최초 조회를 여기 두지 않은 것도 같은 이유다. 주기만 바꿨는데 즉시 재조회까지 일어나면
  // 설정 저장이 트래픽 스파이크가 된다.
  useEffect(() => {
    const timer = window.setInterval(() => void refreshAlerts(), pollIntervalMs);
    return () => window.clearInterval(timer);
  }, [refreshAlerts, pollIntervalMs]);

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

  // 권한 요청은 **사용자가 눌러서** 일어난다. `browser_notifications_enabled` 가 켜졌다는
  // 이유로 여기를 부르지 않는다 — 그러면 관리자가 설정을 저장한 순간 다른 사람 화면에
  // 브라우저 권한 팝업이 뜬다. 설정과 권한은 각각 따로 판정한다
  // (`src/utils/browserNotification.ts`).
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
