'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase, checkSupabaseConnection, safeSupabaseOperation } from '@/lib/supabase';
import { User, AuthContextType, AppError, ErrorCodes } from '@/types';
import { MockAuthService, isDevelopment } from '@/lib/mockAuth';
import { log, LogCategories } from '@/lib/logger';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 로딩 타임아웃 관리를 위한 ref
  const loadingTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // 사용자 프로필 정보 가져오기
  const fetchUserProfile = async (supabaseUser: SupabaseUser): Promise<User | null> => {
    try {
      // Supabase 연결 상태 확인
      const connected = await checkSupabaseConnection();
      if (!connected) {
        log.warn('Supabase not connected, using fallback user profile', {}, LogCategories.AUTH);
        return {
          id: supabaseUser.id,
          email: supabaseUser.email || '',
          name: supabaseUser.user_metadata?.name || supabaseUser.email || 'Unknown User',
          role: 'operator', // 기본 역할
          created_at: supabaseUser.created_at
        };
      }

      const profile = await safeSupabaseOperation(
        async (client) => {
          const { data, error } = await client
            .from('user_profiles')
            .select('*')
            .eq('user_id', supabaseUser.id)
            .single();
          
          if (error) {
            throw error;
          }
          
          return data;
        },
        null // fallback value
      );

      if (!profile) {
        log.warn('No user profile found, using default profile', { userId: supabaseUser.id }, LogCategories.AUTH);
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
      log.error('Error in fetchUserProfile', error, LogCategories.AUTH);
      // 에러 발생 시 기본 프로필 반환
      return {
        id: supabaseUser.id,
        email: supabaseUser.email || '',
        name: supabaseUser.user_metadata?.name || supabaseUser.email || 'Unknown User',
        role: 'operator',
        created_at: supabaseUser.created_at
      };
    }
  };

  // 로그인 함수
  const login = async (email: string, password: string): Promise<void> => {
    try {
      // 개발 환경에서는 테스트 계정도 허용
      if (isDevelopment() && MockAuthService.getAvailableUsers().some(user => user.email === email)) {
        // 개발 환경의 모의 계정 사용
        log.info('개발 모드: 모의 인증으로 로그인', { email }, LogCategories.AUTH);
        const mockUser = await MockAuthService.login(email, password);
        setUser(mockUser);
        return;
      }

      // 실제 Supabase 인증 사용
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
      log.error('Login error', error, LogCategories.AUTH);
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
      log.error('Logout error', error, LogCategories.AUTH);
      throw error;
    }
  };

  // 로딩 타임아웃 설정 함수
  const setLoadingTimeout = () => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
    }
    
    loadingTimeoutRef.current = setTimeout(() => {
      log.warn('인증 초기화 타임아웃 - 강제로 로딩 종료', {}, LogCategories.AUTH);
      setLoading(false);
      setError('인증 시스템 초기화 중 타임아웃이 발생했습니다. 페이지를 새로고침해주세요.');
    }, 10000); // 10초 타임아웃
  };

  // 로딩 타임아웃 해제 함수
  const clearLoadingTimeout = () => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
      loadingTimeoutRef.current = null;
    }
  };

  // 인증 상태 변경 감지
  useEffect(() => {
    const initializeAuth = async () => {
      try {
        setError(null);
        setLoadingTimeout(); // 타임아웃 설정
        
        // 항상 Supabase 세션 확인 (개발 환경에서도 실제 인증 시스템 사용)
        await getSession();
      } catch (error) {
        log.error('인증 초기화 실패', error, LogCategories.AUTH);
        setUser(null);
        setError('인증 시스템 초기화에 실패했습니다.');
        setLoading(false);
        clearLoadingTimeout();
      }
    };

    // 현재 세션 확인 (Supabase)
    const getSession = async () => {
      try {
        // 먼저 연결 상태 확인
        const connected = await checkSupabaseConnection();
        
        if (!connected) {
          log.warn('Supabase not connected during session check', {}, LogCategories.AUTH);
          setUser(null);
          setError('서버와 연결할 수 없습니다. 잠시 후 다시 시도해주세요.');
          setLoading(false);
          clearLoadingTimeout();
          return;
        }

        const session = await safeSupabaseOperation(
          async (client) => {
            const { data, error } = await client.auth.getSession();
            if (error) {
              throw error;
            }
            return data.session;
          },
          null
        );
        
        if (session?.user) {
          const userProfile = await fetchUserProfile(session.user);
          setUser(userProfile);
          setError(null);
        } else {
          setUser(null);
          setError(null);
        }
      } catch (error) {
        log.error('Error in getSession', error, LogCategories.AUTH);
        setUser(null);
        setError('세션 확인 중 오류가 발생했습니다.');
      } finally {
        setLoading(false);
        clearLoadingTimeout();
      }
    };

    initializeAuth();

    // Supabase 인증 상태 변경 리스너 (항상 활성화)
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
    const subscription = data.subscription;

    return () => {
      clearLoadingTimeout();
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
    error,
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