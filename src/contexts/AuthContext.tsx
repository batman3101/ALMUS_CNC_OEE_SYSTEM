'use client';

import React, { createContext, useContext, useEffect, useState, ReactNode, useRef, useCallback, useMemo } from 'react';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';
import { User, AuthContextType } from '@/types';
import { log, LogCategories } from '@/lib/logger';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // 컴포넌트 마운트 상태를 추적하는 ref (메모리 누수 방지)
  const isMountedRef = useRef(true);
  
  // 로딩 타임아웃 관리를 위한 ref
  const loadingTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  
  // AbortController 관리를 위한 ref
  const abortControllerRef = useRef<AbortController | null>(null);

  // 안전한 상태 업데이트 헬퍼 함수
  // (setState, value)를 따로 받으면 제네릭 추론이 두 인자 사이에서 충돌해 각 setState의
  // 실제 타입(예: Dispatch<SetStateAction<User | null>>)과 어긋나므로, 호출부에서 이미
  // 타입 검사된 setter 호출 자체를 넘겨받는다.
  // 참조(ref)만 사용하므로 항상 동일한 identity를 유지한다 (deps: [])
  const safeSetState = useCallback((updateFn: () => void) => {
    if (isMountedRef.current) {
      updateFn();
    }
  }, []);

  // 사용자 프로필 정보 가져오기 (메모리 누수 방지 최적화)
  // ref와 외부 모듈(supabase/log)만 참조하고 상태(state)에 의존하지 않으므로 deps: []로 고정 identity 유지
  const fetchUserProfile = useCallback(async (supabaseUser: SupabaseUser): Promise<User | null> => {
    // 컴포넌트가 언마운트된 경우 early return
    if (!isMountedRef.current) {
      return null;
    }

    try {
      console.log('🔍 fetchUserProfile 시작:', { userId: supabaseUser.id, email: supabaseUser.email });
      
      let profile = null;
      let timeoutId: NodeJS.Timeout | null = null;

      // 서버 API를 통해 Service Role로 프로필 조회 (개선된 cleanup 적용)
      try {
        console.log('📋 서버 API를 통해 사용자 프로필 조회 중:', supabaseUser.id);
        
        // 이전 AbortController가 있다면 정리
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        
        const controller = new AbortController();
        abortControllerRef.current = controller;
        
        timeoutId = setTimeout(() => {
          if (isMountedRef.current && controller) {
            controller.abort();
          }
        }, 5000); // 5초 timeout
        
        const response = await fetch(`/api/auth/profile-admin?user_id=${supabaseUser.id}`, {
          signal: controller.signal
        });
        
        // timeout 정리
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        
        // AbortController 정리
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        
        // 컴포넌트가 언마운트된 경우 early return
        if (!isMountedRef.current) {
          return null;
        }
        
        if (response.ok) {
          const result = await response.json();
          if (result.success && result.profile) {
            console.log('✅ 서버 API로 프로필 조회 성공:', result.profile);
            profile = result.profile;
          }
        } else {
          console.warn('⚠️ 서버 API 조회 실패:', response.status);
        }
      } catch (apiError: unknown) {
        // timeout 정리 (에러 발생 시)
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
        
        const isAbortError = apiError instanceof Error && apiError.name === 'AbortError';
        if (isAbortError) {
          console.warn('⚠️ 서버 API 타임아웃 또는 취소됨 (5초), 일반 클라이언트로 재시도');
        } else {
          const errorMessage = apiError instanceof Error ? apiError.message : 'Unknown error';
          console.warn('⚠️ 서버 API 오류, 일반 클라이언트로 재시도:', errorMessage);
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

      // 컴포넌트가 언마운트된 경우 early return
      if (!isMountedRef.current) {
        return null;
      }

      if (!profile) {
        log.warn('No user profile found, user needs to be set up', { userId: supabaseUser.id }, LogCategories.AUTH);
        console.warn('❌ 사용자 프로필이 존재하지 않음 - 관리자가 설정해야 합니다.');
        
        // 프로필이 없는 경우 null 반환하여 로그인으로 리다이렉트
        return null;
      }

      const userProfile = {
        id: profile.user_id,
        email: supabaseUser.email || '',
        name: profile.name,
        role: profile.role,
        assigned_machines: profile.assigned_machines,
        created_at: profile.created_at,
        // 개인 환경설정 (null 이면 아직 고르지 않은 것 -> 시스템 기본값을 따른다)
        language: profile.language ?? null,
        theme_mode: profile.theme_mode ?? null
      };
      
      console.log('🎉 최종 사용자 프로필:', userProfile);
      return userProfile;
    } catch (error) {
      console.error('❌ fetchUserProfile 전체 오류:', error);
      log.error('Error in fetchUserProfile', error, LogCategories.AUTH);
      
      // 에러 발생 시 null 반환하여 로그인으로 리다이렉트
      console.log('🔄 오류로 인해 null 반환 - 로그인 필요');
      return null;
    }
  }, []);

  // 로그인 함수 (향상된 디버깅과 오류 처리)
  // fetchUserProfile, safeSetState가 고정 identity이므로 login도 고정 identity를 유지한다
  const login = useCallback(async (email: string, password: string): Promise<void> => {
    try {
      console.log('🔑 로그인 시도:', { email });
      setError(null); // 이전 오류 초기화

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
      if (!userProfile) {
        await supabase.auth.signOut();
        throw new Error('사용자 프로필이 설정되지 않았습니다. 관리자에게 문의하세요.');
      }
      safeSetState(() => setUser(userProfile));

      console.log('🎉 로그인 및 프로필 로딩 완료:', userProfile.email);
    } catch (error: unknown) {
      console.error('❌ 로그인 전체 오류:', error);
      log.error('Login error', error, LogCategories.AUTH);

      // 오류 상태 설정 (로그인 상태는 유지)
      const errorMessage = error instanceof Error ? error.message : '';
      if (errorMessage.length > 0) {
        safeSetState(() => setError(errorMessage));
      } else {
        safeSetState(() => setError('로그인 중 예기치 못한 오류가 발생했습니다.'));
      }

      throw error;
    }
  }, [fetchUserProfile, safeSetState]);

  // 로그아웃 함수
  // safeSetState가 고정 identity이므로 logout도 고정 identity를 유지한다
  const logout = useCallback(async (): Promise<void> => {
    try {
      // 즉시 사용자 상태 초기화 (UI 반응성 개선)
      safeSetState(() => setUser(null));
      safeSetState(() => setError(null));
      
      // Supabase 로그아웃
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.warn('로그아웃 중 오류 발생했지만 사용자 상태는 이미 초기화됨:', error);
        // 에러가 있어도 사용자 상태는 이미 초기화되었으므로 계속 진행
      }
      
      // 로그인 페이지로 즉시 이동 (prefetch된 페이지)
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    } catch (error: unknown) {
      log.error('Logout error', error, LogCategories.AUTH);
      // 오류가 있어도 로그인 페이지로 이동
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
  }, [safeSetState]);

  // 로딩 타임아웃 설정 함수
  const setLoadingTimeout = () => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current);
    }
    
    loadingTimeoutRef.current = setTimeout(() => {
      if (isMountedRef.current) {
        console.warn('⚠️ 인증 초기화 타임아웃 - 30초 후 강제로 로딩 종료');
        log.warn('인증 초기화 타임아웃 - 강제로 로딩 종료', {}, LogCategories.AUTH);
        safeSetState(() => setLoading(false));
        safeSetState(() => setError('인증 시스템 초기화 중 타임아웃이 발생했습니다. 네트워크 연결을 확인하고 페이지를 새로고침해주세요.'));
      }
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
      } catch (error: unknown) {
        console.error('❌ 인증 초기화 실패:', error);
        log.error('인증 초기화 실패', error, LogCategories.AUTH);
        safeSetState(() => setUser(null));

        // 더 구체적인 오류 메시지
        const errorMessage = error instanceof Error ? error.message : '';
        if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
          safeSetState(() => setError('네트워크 연결을 확인해주세요. 서버에 연결할 수 없습니다.'));
        } else {
          safeSetState(() => setError('인증 시스템 초기화에 실패했습니다. 페이지를 새로고침해주세요.'));
        }

        safeSetState(() => setLoading(false));
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
          if (userProfile) {
            safeSetState(() => setUser(userProfile));
            safeSetState(() => setError(null));
            console.log('🎉 인증 초기화 성공');
          } else {
            console.log('❌ 프로필이 없어서 세션 종료');
            await supabase.auth.signOut();
            safeSetState(() => setUser(null));
            safeSetState(() => setError('사용자 프로필이 설정되지 않았습니다. 관리자에게 문의하세요.'));
          }
        } else {
          console.log('ℹ️ 세션이 없음 - 로그인 필요');
          safeSetState(() => setUser(null));
          safeSetState(() => setError(null));
        }
      } catch (error: unknown) {
        console.error('❌ getSession 오류:', error);
        log.error('Error in getSession', error, LogCategories.AUTH);
        safeSetState(() => setUser(null));

        // 네트워크 연결 문제와 기타 오류를 구분
        const errorMessage = error instanceof Error ? error.message : '';
        if (errorMessage.includes('fetch') || errorMessage.includes('network')) {
          safeSetState(() => setError('네트워크 연결을 확인하고 다시 시도해주세요.'));
        } else {
          safeSetState(() => setError('세션 확인 중 오류가 발생했습니다.'));
        }
      } finally {
        safeSetState(() => setLoading(false));
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
            if (userProfile) {
              safeSetState(() => setUser(userProfile));
              safeSetState(() => setError(null));
            } else {
              console.log('❌ 프로필이 없어서 세션 종료');
              await supabase.auth.signOut();
              safeSetState(() => setUser(null));
              safeSetState(() => setError('사용자 프로필이 설정되지 않았습니다. 관리자에게 문의하세요.'));
            }
          } else if (event === 'SIGNED_OUT') {
            console.log('🚪 SIGNED_OUT 이벤트 - 사용자 로그아웃');
            safeSetState(() => setUser(null));
            safeSetState(() => setError(null));
          } else if (event === 'TOKEN_REFRESHED' && session?.user) {
            console.log('🔄 TOKEN_REFRESHED 이벤트 - 프로필 재로딩');
            const userProfile = await fetchUserProfile(session.user);
            if (userProfile) {
              safeSetState(() => setUser(userProfile));
              safeSetState(() => setError(null));
            } else {
              console.log('❌ 프로필이 없어서 세션 종료');
              await supabase.auth.signOut();
              safeSetState(() => setUser(null));
              safeSetState(() => setError('사용자 프로필이 설정되지 않았습니다. 관리자에게 문의하세요.'));
            }
          }
        } catch (error) {
          console.error('❌ 인증 상태 변경 처리 오류:', error);
          log.error('Auth state change error', error, LogCategories.AUTH);
          safeSetState(() => setError('인증 상태 변경 중 오류가 발생했습니다.'));
        }

        safeSetState(() => setLoading(false));
      }
    );
    const subscription = data.subscription;

    // cleanup 함수
    return () => {
      // 컴포넌트 언마운트 상태로 설정
      isMountedRef.current = false;
      
      // 모든 타임아웃 정리
      clearLoadingTimeout();
      
      // AbortController 정리
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
        abortControllerRef.current = null;
      }
      
      // Supabase 구독 정리
      if (subscription) {
        subscription.unsubscribe();
      }
    };
    // fetchUserProfile/safeSetState는 고정 identity([] deps)이므로 추가해도 마운트 1회 실행 의미는 유지된다.
    // setLoadingTimeout은 기존과 동일하게 의도적으로 제외한다 (매 렌더 재생성되는 함수라 넣으면 매 렌더 재구독됨).
  }, [fetchUserProfile, safeSetState]);

  // login/logout은 이제 고정 identity를 가지므로, 이 value는 user/loading/error가
  // 실제로 바뀔 때만 새 identity를 얻는다 (구독 중인 모든 useAuth() 소비자의 불필요한 재렌더링 방지)
  const value: AuthContextType = useMemo(() => ({
    user,
    login,
    logout,
    loading,
    error,
  }), [user, login, logout, loading, error]);

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