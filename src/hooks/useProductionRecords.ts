'use client';

import { useState, useCallback } from 'react';
import { ProductionRecord } from '@/types';
import { format } from 'date-fns';
import { authFetch } from '@/lib/authFetch';

interface ProductionRecordInput {
  machine_id: string;
  output_qty: number;
  defect_qty: number;
  shift: 'A' | 'B';
  date?: string;
}

export const useProductionRecords = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 생산 실적 입력
  const createProductionRecord = useCallback(async (data: ProductionRecordInput): Promise<ProductionRecord> => {
    setLoading(true);
    setError(null);

    try {
      const response = await authFetch('/api/production-records', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          machine_id: data.machine_id,
          date: data.date || format(new Date(), 'yyyy-MM-dd'),
          shift: data.shift,
          output_qty: data.output_qty,
          defect_qty: data.defect_qty,
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || '생산 실적 입력 중 오류가 발생했습니다');
      }

      return result.record as ProductionRecord;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '생산 실적 입력 중 오류가 발생했습니다';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  // 특정 설비의 생산 실적 조회
  const getProductionRecords = useCallback(async (machineId: string, date?: string): Promise<ProductionRecord[]> => {
    setLoading(true);
    setError(null);

    try {
      // TODO: Supabase 연동 시 실제 API 호출로 대체
      await new Promise(resolve => setTimeout(resolve, 500));

      // 임시 데이터 반환
      const records: ProductionRecord[] = [];
      console.log('생산 실적 조회:', { machineId, date });
      return records;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '생산 실적 조회 중 오류가 발생했습니다';
      setError(errorMessage);
      throw new Error(errorMessage);
    } finally {
      setLoading(false);
    }
  }, []);

  // Tact Time 기반 추정 생산량 계산
  //
  // tactTime 은 개당(1 piece) 가공시간이다. JIG 의 cavity 수는 이미 개당 t/t 에
  // 반영되어 있으므로 여기서 다시 곱하지 않는다 (이중 반영 방지).
  const calculateEstimatedOutput = useCallback((
    tactTime: number, // 개당 가공시간, 초 단위
    actualRuntime: number // 분 단위
  ): number => {
    if (tactTime <= 0 || actualRuntime <= 0) return 0;

    // 추정 생산량 = 실제 가동 시간(초) / 개당 Tact Time
    const runtimeInSeconds = actualRuntime * 60;

    return Math.floor(runtimeInSeconds / tactTime);
  }, []);

  return {
    loading,
    error,
    createProductionRecord,
    getProductionRecords,
    calculateEstimatedOutput,
  };
};

export default useProductionRecords;
