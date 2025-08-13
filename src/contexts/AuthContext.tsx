'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { User, AuthContextType, AppError, ErrorCodes } from '@/types';
import { MockAuthService, isDevelopment } from '@/lib/mockAuth';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // 사용자 프로필 정보 가져오기
  const fetchUserProfile = async (supabaseUser: SupabaseUser): Promise<User | null> => {
    try {
      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', supabaseUser.id)
        .single();

      if (error) {
        console.error('Error fetching user profile:', error);
        // 프로필이 없는 경우 기본 사용자 정보 반환
        return {
          id: supabaseUser.id,
          email: supabaseUser.email || '',
          name: supabaseUser.user_metadata?.name || supabaseUser.email || 'Unknown User',
          role: 'operator', // 기본 역할
          created_at: supabaseUser.created_at
        };
      }

      return {
        id: profile.user_id,
        email: supabaseUser.email || '',
        name: profile.name,
        role: profile.role,
        assigned_machines: profile.assigned_machines,
        created_at: profile.created_at
      };
    } catch (error) {
      console.error('Error in fetchUserProfile:', error);
      return null;
    }
  };

  // 로그인 함수
  const login = async (email: string, password: string): Promise<void> => {
    try {
      if (isDevelopment()) {
        // 개발 환경: 모의 인증 사용
        console.log('🔧 개발 모드: 모의 인증으로 로그인');
        const mockUser = await MockAuthService.login(email, password);
        setUser(mockUser);
        return;
      }

      // 프로덕션 환경: Supabase 인증 사용
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        throw error;
      }

      if (!data.user) {
        throw new Error('No user data returned');
      }

      // 사용자 프로필 정보 가져오기
      const userProfile = await fetchUserProfile(data.user);
      setUser(userProfile);
    } catch (error: any) {
      console.error('Login error:', error);
      throw error;
    }
  };

  // 로그아웃 함수
  const logout = async (): Promise<void> => {
    try {
      if (isDevelopment()) {
        // 개발 환경: 모의 인증 로그아웃
        await MockAuthService.logout();
        setUser(null);
        return;
      }

      // 프로덕션 환경: Supabase 로그아웃
      const { error } = await supabase.auth.signOut();
      if (error) {
        throw error;
      }
      setUser(null);
    } catch (error: any) {
      console.error('Logout error:', error);
      throw error;
    }
  };

  // 인증 상태 변경 감지
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        if (isDevelopment()) {
          // 개발 환경: 모의 인증 사용
          console.log('🔧 개발 모드: 모의 인증 시스템 초기화');
          const mockUser = await MockAuthService.autoLogin();
          setUser(mockUser);
          setLoading(false);
          return;
        }

        // 프로덕션 환경: Supabase 세션 확인
        await getSession();
      } catch (error) {
        console.error('인증 초기화 실패:', error);
        setUser(null);
        setLoading(false);
      }
    };

    // 현재 세션 확인 (Supabase)
    const getSession = async () => {
      try {
        const { data: { session }, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('Error getting session:', error);
          setUser(null);
        } else if (session?.user) {
          const userProfile = await fetchUserProfile(session.user);
          setUser(userProfile);
        } else {
          setUser(null);
        }
      } catch (error) {
        console.error('Error in getSession:', error);
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    initializeAuth();

    // Supabase 인증 상태 변경 리스너 (프로덕션 환경에서만)
    let subscription: any = null;
    if (!isDevelopment()) {
      const { data } = supabase.auth.onAuthStateChange(
        async (event, session) => {
          console.log('Auth state changed:', event, session?.user?.email);
          
          if (event === 'SIGNED_IN' && session?.user) {
            const userProfile = await fetchUserProfile(session.user);
            setUser(userProfile);
          } else if (event === 'SIGNED_OUT') {
            setUser(null);
          } else if (event === 'TOKEN_REFRESHED' && session?.user) {
            const userProfile = await fetchUserProfile(session.user);
            setUser(userProfile);
          }
          
          setLoading(false);
        }
      );
      subscription = data.subscription;
    }

    return () => {
      if (subscription) {
        subscription.unsubscribe();
      }
    };
  }, []);

  const value: AuthContextType = {
    user,
    login,
    logout,
    loading,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

// AuthContext 사용을 위한 커스텀 훅
export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};

export default AuthContext;