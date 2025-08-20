import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { User, Machine } from '@/types';

interface CreateUserData {
  name: string;
  email: string;
  password: string;
  role: 'admin' | 'operator' | 'engineer';
  assigned_machines?: string[];
}

interface UpdateUserData {
  name: string;
  email: string;
  role: 'admin' | 'operator' | 'engineer';
  assigned_machines?: string[];
}

export const useAdminOperations = () => {
  const [loading, setLoading] = useState(false);

  const createUser = async (userData: CreateUserData) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(userData),
      });

      if (!response.ok) {
        throw new Error('Failed to create user');
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error creating user:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const updateUser = async (userId: string, userData: UpdateUserData, currentEmail: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...userData,
          currentEmail
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to update user');
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error updating user:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const deleteUser = async (userId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete user');
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error deleting user:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/users');
      if (!response.ok) {
        throw new Error('Failed to fetch users');
      }
      const data = await response.json();
      return data.users;
    } catch (error) {
      console.error('Error fetching users:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const fetchMachines = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/machines');
      if (!response.ok) {
        throw new Error('Failed to fetch machines');
      }
      const data = await response.json();
      return data.machines;
    } catch (error) {
      console.error('Error fetching machines:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const createMachine = async (machineData: Omit<Machine, 'id' | 'created_at' | 'updated_at'>) => {
    setLoading(true);
    try {
      const response = await fetch('/api/admin/machines', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(machineData),
      });

      if (!response.ok) {
        throw new Error('Failed to create machine');
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error creating machine:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const updateMachine = async (machineId: string, machineData: Partial<Machine>) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/machines/${machineId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(machineData),
      });

      if (!response.ok) {
        throw new Error('Failed to update machine');
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error updating machine:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  const deleteMachine = async (machineId: string) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/machines/${machineId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete machine');
      }

      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Error deleting machine:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  return {
    loading,
    createUser,
    updateUser,
    deleteUser,
    fetchUsers,
    fetchMachines,
    createMachine,
    updateMachine,
    deleteMachine
  };
};

export default useAdminOperations;