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
      // Create auth user
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: userData.email,
        password: userData.password,
        email_confirm: true
      });

      if (authError) throw authError;
      if (!authData.user) throw new Error('Failed to create user');

      // Create user profile
      const { error: profileError } = await supabase
        .from('user_profiles')
        .insert([{
          user_id: authData.user.id,
          name: userData.name,
          role: userData.role,
          assigned_machines: userData.role === 'operator' ? userData.assigned_machines : null
        }]);

      if (profileError) throw profileError;
      
      return { success: true, user: authData.user };
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
      // Update user profile
      const { error: profileError } = await supabase
        .from('user_profiles')
        .update({
          name: userData.name,
          role: userData.role,
          assigned_machines: userData.role === 'operator' ? userData.assigned_machines : null,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);

      if (profileError) throw profileError;
      
      // Update auth user email if changed
      if (userData.email !== currentEmail) {
        const { error: authError } = await supabase.auth.admin.updateUserById(
          userId,
          { email: userData.email }
        );
        if (authError) throw authError;
      }

      return { success: true };
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
      // Delete user profile first
      const { error: profileError } = await supabase
        .from('user_profiles')
        .delete()
        .eq('user_id', userId);

      if (profileError) throw profileError;

      // Delete auth user
      const { error: authError } = await supabase.auth.admin.deleteUser(userId);
      if (authError) throw authError;
      
      return { success: true };
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
      // Get user profiles
      const { data: profiles, error: profileError } = await supabase
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profileError) throw profileError;

      // Get auth users to get email addresses
      const { data: authUsers, error: authError } = await supabase.auth.admin.listUsers();
      if (authError) throw authError;

      // Combine profile and auth data
      const usersWithEmail = (profiles || []).map(profile => {
        const authUser = authUsers.users.find(u => u.id === profile.user_id);
        return {
          id: profile.user_id,
          email: authUser?.email || '',
          name: profile.name,
          role: profile.role,
          assigned_machines: profile.assigned_machines,
          created_at: profile.created_at
        };
      });

      return usersWithEmail;
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
      const { data, error } = await supabase
        .from('machines')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data || [];
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
      const { data, error } = await supabase
        .from('machines')
        .insert([machineData])
        .select()
        .single();

      if (error) throw error;
      return { success: true, machine: data };
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
      const { error } = await supabase
        .from('machines')
        .update({
          ...machineData,
          updated_at: new Date().toISOString()
        })
        .eq('id', machineId);

      if (error) throw error;
      return { success: true };
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
      const { error } = await supabase
        .from('machines')
        .delete()
        .eq('id', machineId);

      if (error) throw error;
      return { success: true };
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