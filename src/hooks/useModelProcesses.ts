import { useState, useEffect, useCallback } from 'react';
import type { Database } from '@/types/database';

type ModelProcess = Database['public']['Tables']['model_processes']['Row'];

interface UseModelProcessesResult {
  processes: ModelProcess[];
  loading: boolean;
  error: string | null;
  fetchProcesses: (modelId: string | null) => Promise<void>;
  clearProcesses: () => void;
}

export const useModelProcesses = (): UseModelProcessesResult => {
  const [processes, setProcesses] = useState<ModelProcess[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProcesses = useCallback(async (modelId: string | null) => {
    if (!modelId) {
      setProcesses([]);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/model-processes?model_id=${modelId}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch model processes');
      }

      const data = await response.json();
      setProcesses(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Error fetching model processes:', err);
      setProcesses([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const clearProcesses = useCallback(() => {
    setProcesses([]);
    setError(null);
  }, []);

  return {
    processes,
    loading,
    error,
    fetchProcesses,
    clearProcesses
  };
};