'use client';

import { useState, useEffect } from 'react';

export interface UserProfile {
  user_id: string;
  name: string;
  role?: string;
  email?: string;
  is_active: boolean;
}

export const useUserProfiles = () => {
  const [profiles, setProfiles] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchUserProfiles = async () => {
    try {
      setLoading(true);
      setError(null);

      console.log('Fetching user profiles via API...');

      const response = await fetch('/api/user-profiles', {
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

      console.log(`Successfully loaded ${result.count} user profiles`);
      setProfiles(result.profiles || []);

    } catch (error: any) {
      console.error('Error in fetchUserProfiles:', error);
      setError(error.message || 'Failed to load user profiles');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUserProfiles();
  }, []);

  return {
    profiles,
    loading,
    error,
    refetch: fetchUserProfiles
  };
};