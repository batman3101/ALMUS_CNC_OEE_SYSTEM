'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authFetch';

export interface ShiftKey { date: string; shift: 'A' | 'B'; }
export interface DefectItem extends ShiftKey { record_id: string; }

/**
 * 마감/불량 백로그(GET pending). 무기한 대기 항목을 콘솔 배지·조건부 섹션이 소비한다.
 * useRealtimeProgress 와 같은 reqRef·언마운트·인자변경 초기화 규율을 따른다.
 */
export function useShiftBacklog(machineId: string | null) {
  const [closePending, setClosePending] = useState<ShiftKey[]>([]);
  const [defectPending, setDefectPending] = useState<DefectItem[]>([]);
  const reqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!machineId) return;
    const reqId = ++reqRef.current;
    try {
      const res = await authFetch(`/api/production-records/pending?machine_id=${machineId}`, { cache: 'no-store' });
      if (reqId !== reqRef.current || !res.ok) return;
      const body = await res.json() as { close_pending: ShiftKey[]; defect_pending: DefectItem[] };
      if (reqId !== reqRef.current) return;
      setClosePending(body.close_pending ?? []);
      setDefectPending(body.defect_pending ?? []);
    } catch { if (reqId === reqRef.current) { setClosePending([]); setDefectPending([]); } }
  }, [machineId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setClosePending([]); setDefectPending([]); }, [machineId]);
  useEffect(() => () => { reqRef.current++; }, []);

  return { closePending, defectPending, refresh };
}
