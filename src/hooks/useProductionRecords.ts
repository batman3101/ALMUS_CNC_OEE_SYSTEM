'use client';

import { useState, useCallback } from 'react';
import { ProductionRecord } from '@/types';
import { format } from 'date-fns';

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
      // TODO: Supabase 연동 시 실제 API 호출로 대체
      const record: ProductionRecord = {
        record_id: `prod_${Date.now()}`,
        machine_id: data.machine_id,
        date: data.date || format(new Date(), 'yyyy-MM-dd'),
        shift: data.shift,
        output_qty: data.output_qty,
        defect_qty: data.defect_qty,
        created_at: new Date().toISOString(),
      };

      // 임시 지연 (실제 API 호출 시뮬레이션)
      await new Promise(resolve => setTimeout(resolve, 1000));

      console.log('생산 실적 입력:', record);
      return record;
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
  const calculateEstimatedOutput = useCallback((
    tactTime: number, // 초 단위
    actualRuntime: number, // 분 단위
    cavityCount: number = 1 // Cavity 수량 (기본값: 1)
  ): number => {
    if (tactTime <= 0 || actualRuntime <= 0) return 0;

    // 실제 가동 시간(분)을 초로 변환하고 Tact Time으로 나누어 사이클 수 계산
    const runtimeInSeconds = actualRuntime * 60;
    const cycles = Math.floor(runtimeInSeconds / tactTime);

    // 사이클 수에 cavity 수를 곱하여 추정 생산량 계산
    const estimatedOutput = cycles * Math.max(1, cavityCount);

    return estimatedOutput;
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