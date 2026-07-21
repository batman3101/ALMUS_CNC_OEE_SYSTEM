'use client';
import { useCallback, useState } from 'react';
import { authFetch } from '@/lib/authFetch';

/**
 * andon 비가동 토글(시작+사유 / 재개). 한 번의 POST 가 서버 RPC 로 machine_logs +
 * downtime_entries 를 함께 기록한다. onDone 으로 상위가 실시간 데이터를 새로고침한다.
 */
export function useMachineDowntime(machineId: string, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const post = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      const res = await authFetch(`/api/machines/${machineId}/downtime`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { setError('failed'); return; }
      onDone();
    } catch { setError('failed'); } finally { setBusy(false); }
  }, [machineId, onDone]);
  return {
    busy, error,
    start: (reason: string) => post({ action: 'start', reason }),
    resume: () => post({ action: 'resume' }),
  };
}
