import { useState, useEffect } from 'react';
import type { Database } from '@/types/database';

type ProductModel = Database['public']['Tables']['product_models']['Row'];

interface UseProductModelsResult {
  models: ProductModel[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export const useProductModels = (): UseProductModelsResult => {
  const [models, setModels] = useState<ProductModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchModels = async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/product-models');
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to fetch product models');
      }

      const data = await response.json();
      setModels(data);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Error fetching product models:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchModels();
  }, []);

  return {
    models,
    loading,
    error,
    refetch: fetchModels
  };
};