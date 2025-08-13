'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { Machine, MachineLog, ProductionRecord, OEEMetrics } from '@/types';
import { calculateOEE } from '@/utils/oeeCalculator';

interface RealtimeDataState {
  machines: Machine[];
  machineLogs: MachineLog[];
  productionRecords: ProductionRecord[];
  oeeMetrics: Record<string, OEEMetrics>;
  loading: boolean;
  error: string | null;
}

export const useRealtimeData = (userId?: string, userRole?: string) => {
  const [state, setState] = useState<RealtimeDataState>({
    machines: [],
    machineLogs: [],
    productionRecords: [],
    oeeMetrics: {},
    loading: true,
    error: null
  });

  // 초기 데이터 로드
  const loadInitialData = useCallback(async () => {
    try {
      setState(prev => ({ ...prev, loading: true, error: null }));

      // Supabase가 제대로 설정되지 않은 경우 모의 데이터 사용
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      if (!supabaseUrl || supabaseUrl.includes('demo') || supabaseUrl.includes('your_supabase')) {
        console.warn('Using mock data - Supabase not configured');
        setState({
          machines: [],
          machineLogs: [],
          productionRecords: [],
          oeeMetrics: {},
          loading: false,
          error: null
        });
        return;
      }

      // 설비 데이터 로드
      const { data: machines, error: machinesError } = await supabase
        .from('machines')
        .select('*')
        .eq('is_active', true);

      if (machinesError) throw machinesError;

      // 최근 설비 로그 로드
      const { data: machineLogs, error: logsError } = await supabase
        .from('machine_logs')
        .select('*')
        .order('start_time', { ascending: false })
        .limit(100);

      if (logsError) throw logsError;

      // 최근 생산 실적 로드
      const { data: productionRecords, error: productionError } = await supabase
        .from('production_records')
        .select('*')
        .gte('date', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
        .order('date', { ascending: false });

      if (productionError) throw productionError;

      // OEE 지표 계산
      const oeeMetrics: Record<string, OEEMetrics> = {};
      if (machines && productionRecords) {
        machines.forEach(machine => {
          const machineRecords = productionRecords.filter(r => r.machine_id === machine.id);
          if (machineRecords.length > 0) {
            const latestRecord = machineRecords[0];
            oeeMetrics[machine.id] = {
              availability: latestRecord.availability || 0,
              performance: latestRecord.performance || 0,
              quality: latestRecord.quality || 0,
              oee: latestRecord.oee || 0,
              actual_runtime: latestRecord.actual_runtime || 0,
              planned_runtime: latestRecord.planned_runtime || 480, // 8시간 기본값
              ideal_runtime: latestRecord.ideal_runtime || 0,
              output_qty: latestRecord.output_qty || 0,
              defect_qty: latestRecord.defect_qty || 0
            };
          }
        });
      }

      setState({
        machines: machines || [],
        machineLogs: machineLogs || [],
        productionRecords: productionRecords || [],
        oeeMetrics,
        loading: false,
        error: null
      });

    } catch (error) {
      console.error('초기 데이터 로드 실패:', error);
      setState(prev => ({
        ...prev,
        loading: false,
        error: error instanceof Error ? error.message : '데이터 로드에 실패했습니다.'
      }));
    }
  }, []);

  // 실시간 구독 설정
  useEffect(() => {
    loadInitialData();

    // Supabase가 제대로 설정되지 않은 경우 구독 설정하지 않음
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl || supabaseUrl.includes('demo') || supabaseUrl.includes('your_supabase')) {
      return;
    }

    // 설비 로그 실시간 구독
    const machineLogsChannel = supabase
      .channel('machine_logs_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'machine_logs'
        },
        (payload) => {
          console.log('Machine log change:', payload);
          
          setState(prev => {
            let newLogs = [...prev.machineLogs];
            
            if (payload.eventType === 'INSERT') {
              newLogs = [payload.new as MachineLog, ...newLogs.slice(0, 99)];
            } else if (payload.eventType === 'UPDATE') {
              const index = newLogs.findIndex(log => log.log_id === payload.new.log_id);
              if (index !== -1) {
                newLogs[index] = payload.new as MachineLog;
              }
            } else if (payload.eventType === 'DELETE') {
              newLogs = newLogs.filter(log => log.log_id !== payload.old.log_id);
            }
            
            return { ...prev, machineLogs: newLogs };
          });
        }
      )
      .subscribe();

    // 생산 실적 실시간 구독
    const productionChannel = supabase
      .channel('production_records_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'production_records'
        },
        (payload) => {
          console.log('Production record change:', payload);
          
          setState(prev => {
            let newRecords = [...prev.productionRecords];
            let newOeeMetrics = { ...prev.oeeMetrics };
            
            if (payload.eventType === 'INSERT' || payload.eventType === 'UPDATE') {
              const record = payload.new as ProductionRecord;
              
              if (payload.eventType === 'INSERT') {
                newRecords = [record, ...newRecords];
              } else {
                const index = newRecords.findIndex(r => r.record_id === record.record_id);
                if (index !== -1) {
                  newRecords[index] = record;
                }
              }
              
              // OEE 지표 업데이트
              newOeeMetrics[record.machine_id] = {
                availability: record.availability || 0,
                performance: record.performance || 0,
                quality: record.quality || 0,
                oee: record.oee || 0,
                actual_runtime: record.actual_runtime || 0,
                planned_runtime: record.planned_runtime || 480,
                ideal_runtime: record.ideal_runtime || 0,
                output_qty: record.output_qty || 0,
                defect_qty: record.defect_qty || 0
              };
            }
            
            return { 
              ...prev, 
              productionRecords: newRecords,
              oeeMetrics: newOeeMetrics
            };
          });
        }
      )
      .subscribe();

    // 설비 정보 실시간 구독
    const machinesChannel = supabase
      .channel('machines_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'machines'
        },
        (payload) => {
          console.log('Machine change:', payload);
          
          setState(prev => {
            let newMachines = [...prev.machines];
            
            if (payload.eventType === 'INSERT') {
              newMachines = [...newMachines, payload.new as Machine];
            } else if (payload.eventType === 'UPDATE') {
              const index = newMachines.findIndex(m => m.id === payload.new.id);
              if (index !== -1) {
                newMachines[index] = payload.new as Machine;
              }
            } else if (payload.eventType === 'DELETE') {
              newMachines = newMachines.filter(m => m.id !== payload.old.id);
            }
            
            return { ...prev, machines: newMachines };
          });
        }
      )
      .subscribe();

    // 정리 함수
    return () => {
      machineLogsChannel.unsubscribe();
      productionChannel.unsubscribe();
      machinesChannel.unsubscribe();
    };
  }, [loadInitialData]);

  // 수동 새로고침 함수
  const refresh = useCallback(() => {
    loadInitialData();
  }, [loadInitialData]);

  // 역할별 필터링된 데이터 반환
  const getFilteredData = useCallback(() => {
    if (!userId || !userRole) return state;

    if (userRole === 'admin' || userRole === 'engineer') {
      return state; // 관리자와 엔지니어는 모든 데이터 접근
    }

    if (userRole === 'operator') {
      // 운영자는 담당 설비만 접근 (실제로는 user_profiles에서 assigned_machines를 가져와야 함)
      // 여기서는 간단히 처리
      return state;
    }

    return state;
  }, [state, userId, userRole]);

  return {
    ...getFilteredData(),
    refresh,
    isConnected: true // Supabase 연결 상태 (실제로는 연결 상태를 추적해야 함)
  };
};