'use client';

import { useState, useEffect } from 'react';
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

export const useMachines = () => {
  const [machines, setMachines] = useState<Machine[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMachines = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('Fetching machines via API...');

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

      console.log(`Successfully loaded ${result.count} machines`);
      
      // Supabase join 결과를 표준 형태로 변환
      const processedMachines = (result.machines || []).map((machine: any) => ({
        ...machine,
        production_model: machine.product_models,
        current_process: machine.model_processes
      }));
      
      setMachines(processedMachines);

    } catch (error: any) {
      console.error('Error in fetchMachines:', error);
      setError(error.message || 'Failed to load machines');
    } finally {
      setLoading(false);
    }
  };

  // 특정 설비 정보 가져오기
  const getMachineById = (machineId: string): Machine | undefined => {
    return machines.find(machine => machine.id === machineId);
  };

  // 설비명으로 설비 정보 가져오기
  const getMachineByName = (machineName: string): Machine | undefined => {
    return machines.find(machine => machine.name === machineName);
  };

  useEffect(() => {
    fetchMachines();
  }, []);

  return {
    machines,
    loading,
    error,
    refetch: fetchMachines,
    getMachineById,
    getMachineByName
  };
};