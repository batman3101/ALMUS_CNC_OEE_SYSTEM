import { useCallback, useEffect, useRef, useState } from 'react';
import { getInclusiveDateRange } from '@/utils/engineerDateRange';
import { authFetch } from '@/lib/authFetch';

export interface MachineOEEStat {
  machine_id: string;
  total_records: number;
  avg_availability: number | null;
  avg_performance: number | null;
  avg_quality: number | null;
  avg_oee: number | null;
  total_output: number;
  total_defect: number;
  unreported_records: number;
  reported_records: number;
  impossible_records: number;
}

export type MachineOEEStatMap = Record<string, MachineOEEStat>;

/**
 * 설비별 OEE 집계 (기간 + 교대 필터 적용).
 *
 * 엔지니어 화면의 설비별 표와 OEE 등급 필터가 쓰던 근거는 useRealtimeData 의
 * "설비별 최신 실적 1건"이었다. 기간을 3개월로 바꾸든 교대를 B로 좁히든 표는 그대로였다.
 * 이 훅은 화면의 필터와 동일한 조건으로 서버에서 집계한 값을 가져온다.
 */
export const useMachineOEEStats = (
  selectedPeriod: 'week' | 'month' | 'quarter',
  machineId?: string,
  customDateRange?: [string, string] | null,
  selectedShifts?: string[]
) => {
  const [snapshot, setSnapshot] = useState<{ scopeKey: string; stats: MachineOEEStatMap }>({
    scopeKey: '',
    stats: {}
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 오래된 응답이 최신 상태를 덮어쓰지 않도록 하는 요청 순번 가드
  const requestIdRef = useRef(0);

  const getDateRange = useCallback((): { start_date: string; end_date: string } => {
    if (customDateRange) {
      return { start_date: customDateRange[0], end_date: customDateRange[1] };
    }

    return getInclusiveDateRange(selectedPeriod === 'week' ? 7 : selectedPeriod === 'month' ? 30 : 90);
  }, [selectedPeriod, customDateRange]);

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    const { start_date, end_date } = getDateRange();
    const scopeKey = `${start_date}|${end_date}|${machineId || ''}|${(selectedShifts || []).join(',')}`;
    setLoading(true);
    setError(null);
    setSnapshot({ scopeKey: '', stats: {} });

    try {
      const params = new URLSearchParams({
        start_date,
        end_date,
        ...(machineId && { machine_id: machineId }),
        ...(selectedShifts &&
          selectedShifts.length > 0 &&
          !selectedShifts.includes('all') && { shift: selectedShifts.join(',') })
      });

      const response = await authFetch(`/api/oee-data/by-machine?${params}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const data = await response.json();
      if (!data.success) throw new Error(data.error || 'Failed to fetch machine stats');

      const map: MachineOEEStatMap = {};
      for (const row of (data.machines || []) as MachineOEEStat[]) {
        map[row.machine_id] = row;
      }

      if (requestId !== requestIdRef.current) return; // 오래된 응답 무시
      setSnapshot({ scopeKey, stats: map });
    } catch (err) {
      console.error('Error fetching machine OEE stats:', err);
      if (requestId !== requestIdRef.current) return;
      setSnapshot({ scopeKey: '', stats: {} });
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      if (requestId === requestIdRef.current) {
        setLoading(false);
      }
    }
  }, [getDateRange, machineId, selectedShifts]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const { start_date, end_date } = getDateRange();
  const currentScopeKey = `${start_date}|${end_date}|${machineId || ''}|${(selectedShifts || []).join(',')}`;
  const stats = snapshot.scopeKey === currentScopeKey ? snapshot.stats : {};

  return { stats, loading, error, refresh };
};
