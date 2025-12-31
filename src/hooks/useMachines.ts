'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/lib/supabase';

export interface Machine {
  id: string;
  name: string;
  location: string;
  equipment_type: string;
  is_active: boolean;
  current_state: string;
  production_model_id: string | null;
  current_process_id: string | null;
  created_at?: string;
  updated_at?: string;
  // 조인된 데이터
  production_model?: {
    id: string;
    model_name: string;
    description: string;
  } | null;
  current_process?: {
    id: string;
    process_name: string;
    process_order: number;
    tact_time_seconds: number;
  } | null;
  // Supabase join 결과 처리
  product_models?: {
    id: string;
    model_name: string;
    description: string;
  } | null;
  model_processes?: {
    id: string;
    process_name: string;
    process_order: number;
    tact_time_seconds: number;
  } | null;
}

export interface UseMachinesOptions {
  enableAutoRefresh?: boolean;
  refreshInterval?: number; // seconds
  enableRealtime?: boolean; // Supabase Realtime 활성화
}

export const useMachines = (options: UseMachinesOptions = {}) => {
  const { 
    enableAutoRefresh = true, 
    refreshInterval = 30,
    enableRealtime = true
  } = options;

  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(enableAutoRefresh);
  const [isRealtimeConnected, setIsRealtimeConnected] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);
  const realtimeChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const isComponentMountedRef = useRef(true);

  const fetchMachines = useCallback(async (isBackgroundRefresh: boolean = false) => {
    try {
      // 백그라운드 새로고침이 아닌 경우에만 로딩 상태 표시
      if (!isBackgroundRefresh) {
        setLoading(true);
      }
      setError(null);

      console.log(`Fetching machines via API... ${isBackgroundRefresh ? '(background)' : '(initial/manual)'}`);

      const response = await fetch('/api/machines', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        }
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const result = await response.json();
      
      if (!result.success) {
        throw new Error(result.message || 'API request failed');
      }

      console.log(`Successfully loaded ${result.count} machines ${isBackgroundRefresh ? '(background)' : ''}`);
      
      // Supabase join 결과를 표준 형태로 변환
      const processedMachines = (result.machines || []).map((machine: Machine & { product_models?: unknown; model_processes?: unknown }) => ({
        ...machine,
        production_model: machine.product_models,
        current_process: machine.model_processes
      }));
      
      // 컴포넌트가 마운트된 경우에만 상태 업데이트
      if (isComponentMountedRef.current) {
        setMachines(processedMachines);
        setLastUpdated(new Date());
      }

    } catch (error: unknown) {
      console.error('Error in fetchMachines:', error);
      if (isComponentMountedRef.current) {
        const errorMessage = error instanceof Error ? error.message : 'Failed to load machines';
        setError(errorMessage);
      }
    } finally {
      if (!isBackgroundRefresh && isComponentMountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // 특정 설비 정보 가져오기
  const getMachineById = (machineId: string): Machine | undefined => {
    return machines.find(machine => machine.id === machineId);
  };

  // 설비명으로 설비 정보 가져오기
  const getMachineByName = (machineName: string): Machine | undefined => {
    return machines.find(machine => machine.name === machineName);
  };

  // 자동 새로고침 시작
  const startAutoRefresh = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    
    console.log(`Starting auto-refresh with ${refreshInterval}s interval`);
    setIsAutoRefreshing(true);
    
    intervalRef.current = setInterval(() => {
      if (isComponentMountedRef.current) {
        fetchMachines(true); // 백그라운드 새로고침
      }
    }, refreshInterval * 1000);
  }, [refreshInterval, fetchMachines]);

  // 자동 새로고침 중지
  const stopAutoRefresh = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    console.log('Auto-refresh stopped');
    setIsAutoRefreshing(false);
  }, []);

  // 자동 새로고침 토글
  const toggleAutoRefresh = useCallback(() => {
    if (isAutoRefreshing) {
      stopAutoRefresh();
    } else {
      startAutoRefresh();
    }
  }, [isAutoRefreshing, startAutoRefresh, stopAutoRefresh]);

  // 수동 새로고침
  const refetch = useCallback(() => {
    fetchMachines(false);
  }, [fetchMachines]);

  // Realtime 채널 설정
  const setupRealtimeChannel = useCallback(() => {
    if (!enableRealtime) return;

    try {
      console.log('Setting up Realtime channel for machines...');
      
      // 기존 채널이 있다면 정리
      if (realtimeChannelRef.current) {
        supabase.removeChannel(realtimeChannelRef.current);
      }

      // 새 채널 생성
      const channel = supabase
        .channel('machines-changes')
        .on(
          'postgres_changes',
          {
            event: '*', // 모든 변경사항 감지 (INSERT, UPDATE, DELETE)
            schema: 'public',
            table: 'machines'
          },
          (payload) => {
            console.log('Realtime change received:', payload);
            
            if (!isComponentMountedRef.current) return;

            // 실시간 데이터 변경 시 전체 목록 새로고침
            // 성능 최적화: 개별 레코드 업데이트 대신 전체 새로고침으로 일관성 보장
            fetchMachines(true);
            
            // 마지막 업데이트 시간 갱신
            setLastUpdated(new Date());
          }
        )
        .subscribe((status) => {
          console.log('Realtime subscription status:', status);
          if (isComponentMountedRef.current) {
            setIsRealtimeConnected(status === 'SUBSCRIBED');
          }
        });

      realtimeChannelRef.current = channel;
      
    } catch (error) {
      console.error('Error setting up Realtime channel:', error);
    }
  }, [enableRealtime, fetchMachines]);

  // Realtime 채널 정리
  const cleanupRealtimeChannel = useCallback(() => {
    if (realtimeChannelRef.current) {
      console.log('Cleaning up Realtime channel...');
      supabase.removeChannel(realtimeChannelRef.current);
      realtimeChannelRef.current = null;
      setIsRealtimeConnected(false);
    }
  }, []);

  // 초기 데이터 로드 및 실시간 연결 설정
  useEffect(() => {
    fetchMachines();
    
    // 폴링 방식 자동 새로고침 설정
    if (enableAutoRefresh) {
      startAutoRefresh();
    }
    
    // Realtime 연결 설정  
    if (enableRealtime) {
      setupRealtimeChannel();
    }

    // 컴포넌트 언마운트 시 정리
    return () => {
      isComponentMountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
      cleanupRealtimeChannel();
    };
  }, [fetchMachines, enableAutoRefresh, enableRealtime, startAutoRefresh, setupRealtimeChannel, cleanupRealtimeChannel]);

  // 새로고침 간격 변경 시 자동 새로고침 재시작
  useEffect(() => {
    if (isAutoRefreshing) {
      startAutoRefresh();
    }
  }, [refreshInterval, isAutoRefreshing, startAutoRefresh]);

  return {
    machines,
    loading,
    error,
    isAutoRefreshing,
    isRealtimeConnected,
    lastUpdated,
    refetch,
    startAutoRefresh,
    stopAutoRefresh,
    toggleAutoRefresh,
    setupRealtimeChannel,
    cleanupRealtimeChannel,
    getMachineById,
    getMachineByName
  };
};