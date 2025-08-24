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

  // 사용자 프로필 정보 가져오기 (간소화)
  const fetchUserProfile = async (supabaseUser: SupabaseUser): Promise<User | null> => {
    try {
      console.log('🔍 fetchUserProfile 시작:', { userId: supabaseUser.id, email: supabaseUser.email });
      
      let profile = null;

      // 서버 API를 통해 Service Role로 프로필 조회 (timeout 적용)
      try {
        console.log('📋 서버 API를 통해 사용자 프로필 조회 중:', supabaseUser.id);
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000); // 5초 timeout
        
        const response = await fetch(`/api/auth/profile-admin?user_id=${supabaseUser.id}`, {
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.profile) {
            console.log('✅ 서버 API로 프로필 조회 성공:', result.profile);
            profile = result.profile;
          }
        } else {
          console.warn('⚠️ 서버 API 조회 실패:', response.status);
        }
      } catch (apiError: any) {
        if (apiError.name === 'AbortError') {
          console.warn('⚠️ 서버 API 타임아웃 (5초), 일반 클라이언트로 재시도');
        } else {
          console.warn('⚠️ 서버 API 오류, 일반 클라이언트로 재시도:', apiError.message);
        }
      }
      
      // Service Role이 실패한 경우 일반 클라이언트로 재시도
      if (!profile) {
        try {
          console.log('📋 일반 클라이언트로 사용자 프로필 조회 중:', supabaseUser.id);
          
          const { data, error } = await supabase
            .from('user_profiles')
            .select('*')
            .eq('user_id', supabaseUser.id)
            .single();
          
          if (error) {
            console.error('❌ 프로필 조회 오류:', {
              code: error.code,
              message: error.message,
              userId: supabaseUser.id
            });
            
            if (error.code === '42501' || error.message?.includes('RLS')) {
              console.error('🔒 RLS 정책에 의해 접근이 차단되었습니다.');
            }
          } else {
            console.log('✅ 일반 클라이언트로 프로필 조회 성공:', data);
            profile = data;
          }
        } catch (clientError) {
          console.warn('⚠️ 일반 클라이언트 조회 실패:', clientError);
        }
      }

      if (!profile) {
        log.warn('No user profile found, creating default profile', { userId: supabaseUser.id }, LogCategories.AUTH);
        console.warn('❌ 사용자 프로필이 존재하지 않음 - 기본 프로필을 반환합니다.');
        
        // 프로필이 없는 경우 기본 사용자 정보 반환
        const defaultProfile = {
          id: supabaseUser.id,
          email: supabaseUser.email || '',
          name: supabaseUser.user_metadata?.name || supabaseUser.email || 'Unknown User',
          role: 'operator' as const, // 기본 역할
          created_at: supabaseUser.created_at
        };
        
        console.log('🔄 기본 프로필 반환:', defaultProfile);
        return defaultProfile;
      }

      const userProfile = {
        id: profile.user_id,
        email: supabaseUser.email || '',
        name: profile.name,
        role: profile.role,
        assigned_machines: profile.assigned_machines,
        created_at: profile.created_at
      };
      
      console.log('🎉 최종 사용자 프로필:', userProfile);
      return userProfile;
    } catch (error) {
      console.error('❌ fetchUserProfile 전체 오류:', error);
      log.error('Error in fetchUserProfile', error, LogCategories.AUTH);
      
      // 에러 발생 시 기본 프로필 반환
      const fallbackProfile = {
        id: supabaseUser.id,
        email: supabaseUser.email || '',
        name: supabaseUser.user_metadata?.name || supabaseUser.email || 'Unknown User',
        role: 'operator' as const,
        created_at: supabaseUser.created_at
      };
      
      console.log('🔄 오류로 인한 기본 프로필 반환:', fallbackProfile);
      return fallbackProfile;
    }
  };

  // 로그인 함수 (향상된 디버깅과 오류 처리)
  const login = async (email: string, password: string): Promise<void> => {
    try {
      console.log('🔑 로그인 시도:', { email, isDev: isDevelopment() });
      setError(null); // 이전 오류 초기화
      
      // 개발 환경에서는 테스트 계정도 허용
      if (isDevelopment() && MockAuthService.getAvailableUsers().some(user => user.email === email)) {
        console.log('🧑‍💻 개발 모드: 모의 인증으로 로그인');
        log.info('개발 모드: 모의 인증으로 로그인', { email }, LogCategories.AUTH);
        const mockUser = await MockAuthService.login(email, password);
        setUser(mockUser);
        console.log('✅ 모의 로그인 성공:', mockUser.email);
        return;
      }

      // 실제 Supabase 인증 사용
      console.log('📊 Supabase 로그인 시도...');
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        console.error('❌ Supabase 로그인 오류:', {
          message: error.message,
          status: error.status,
          code: error.message
        });
        
        // 사용자 친화적인 오류 메시지 제공
        if (error.message?.includes('Invalid login credentials')) {
          throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
        } else if (error.message?.includes('Email not confirmed')) {
          throw new Error('이메일 인증이 필요합니다. 인증 메일을 확인해주세요.');
        } else {
          throw new Error(`로그인 실패: ${error.message}`);
        }
      }

      if (!data.user) {
        console.error('❌ 사용자 데이터가 반환되지 않음');
        throw new Error('로그인에 실패했습니다. 다시 시도해주세요.');
      }

      console.log('✅ Supabase 로그인 성공, 사용자 프로필 로딩 중...');
      
      // 사용자 프로필 정보 가져오기
      const userProfile = await fetchUserProfile(data.user);
      setUser(userProfile);
      
      console.log('🎉 로그인 및 프로필 로딩 완료:', userProfile.email);
    } catch (error: any) {
      console.error('❌ 로그인 전체 오류:', error);
      log.error('Login error', error, LogCategories.AUTH);
      
      // 오류 상태 설정 (로그인 상태는 유지)
      if (typeof error.message === 'string' && error.message.length > 0) {
        setError(error.message);
      } else {
        setError('로그인 중 예기치 못한 오류가 발생했습니다.');
      }
      
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
      console.warn('⚠️ 인증 초기화 타임아웃 - 30초 후 강제로 로딩 종료');
      log.warn('인증 초기화 타임아웃 - 강제로 로딩 종료', {}, LogCategories.AUTH);
      setLoading(false);
      setError('인증 시스템 초기화 중 타임아웃이 발생했습니다. 네트워크 연결을 확인하고 페이지를 새로고침해주세요.');
    }, 30000); // 30초 타임아웃으로 증가
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
        console.log('🚀 인증 시스템 초기화 시작');
        setError(null);
        setLoadingTimeout(); // 30초 타임아웃 설정
        
        // 항상 Supabase 세션 확인 (개발 환경에서도 실제 인증 시스템 사용)
        await getSession();
      } catch (error: any) {
        console.error('❌ 인증 초기화 실패:', error);
        log.error('인증 초기화 실패', error, LogCategories.AUTH);
        setUser(null);
        
        // 더 구체적인 오류 메시지
        if (error.message?.includes('fetch') || error.message?.includes('network')) {
          setError('네트워크 연결을 확인해주세요. 서버에 연결할 수 없습니다.');
        } else {
          setError('인증 시스템 초기화에 실패했습니다. 페이지를 새로고침해주세요.');
        }
        
        setLoading(false);
        clearLoadingTimeout();
      }
    };

    // 현재 세션 확인 (Supabase) - 연결 확인 제거로 최적화
    const getSession = async () => {
      try {
        console.log('🔍 세션 확인 시작');
        
        const { data, error } = await supabase.auth.getSession();
        
        if (error) {
          console.error('❌ 세션 확인 오류:', error);
          throw error;
        }
        
        const session = data.session;
        console.log('🔑 세션 상태:', { hasSession: !!session, userId: session?.user?.id });
        
        if (session?.user) {
          console.log('✅ 유효한 세션 발견, 사용자 프로필 로딩 중...');
          const userProfile = await fetchUserProfile(session.user);
          setUser(userProfile);
          setError(null);
          console.log('🎉 인증 초기화 성공');
        } else {
          console.log('ℹ️ 세션이 없음 - 로그인 필요');
          setUser(null);
          setError(null);
        }
      } catch (error: any) {
        console.error('❌ getSession 오류:', error);
        log.error('Error in getSession', error, LogCategories.AUTH);
        setUser(null);
        
        // 네트워크 연결 문제와 기타 오류를 구분
        if (error.message?.includes('fetch') || error.message?.includes('network')) {
          setError('네트워크 연결을 확인하고 다시 시도해주세요.');
        } else {
          setError('세션 확인 중 오류가 발생했습니다.');
        }
      } finally {
        setLoading(false);
        clearLoadingTimeout();
        console.log('🏁 인증 초기화 완료');
      }
    };

    initializeAuth();

    // Supabase 인증 상태 변경 리스너 (항상 활성화)
    const { data } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('🔄 인증 상태 변경:', {
          event,
          userId: session?.user?.id,
          email: session?.user?.email,
          hasSession: !!session
        });
        
        try {
          if (event === 'SIGNED_IN' && session?.user) {
            console.log('✅ SIGNED_IN 이벤트 - 프로필 로딩 중...');
            const userProfile = await fetchUserProfile(session.user);
            setUser(userProfile);
            setError(null);
          } else if (event === 'SIGNED_OUT') {
            console.log('🚪 SIGNED_OUT 이벤트 - 사용자 로그아웃');
            setUser(null);
            setError(null);
          } else if (event === 'TOKEN_REFRESHED' && session?.user) {
            console.log('🔄 TOKEN_REFRESHED 이벤트 - 프로필 재로딩');
            const userProfile = await fetchUserProfile(session.user);
            setUser(userProfile);
            setError(null);
          }
        } catch (error) {
          console.error('❌ 인증 상태 변경 처리 오류:', error);
          log.error('Auth state change error', error, LogCategories.AUTH);
          setError('인증 상태 변경 중 오류가 발생했습니다.');
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