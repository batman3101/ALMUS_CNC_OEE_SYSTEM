/**
 * 개발 환경용 모의 인증 시스템
 * 실제 Supabase 연결 없이 로컬에서 테스트할 수 있도록 합니다.
 */

import { User } from '@/types';

// 개발용 사용자 계정들 - 환경 변수에서 로드
const getMockUsers = (): Array<User & { password: string }> => [
  {
    id: 'dev-admin-001',
    email: process.env.DEV_ADMIN_EMAIL || 'admin@example.com',
    name: '개발자 관리자',
    role: 'admin',
    assigned_machines: [],
    created_at: new Date().toISOString(),
    password: process.env.DEV_ADMIN_PASSWORD || 'default-admin-password'
  },
  {
    id: 'dev-operator-001',
    email: process.env.DEV_OPERATOR_EMAIL || 'operator@example.com',
    name: '테스트 운영자',
    role: 'operator',
    assigned_machines: ['1', '2', '3'],
    created_at: new Date().toISOString(),
    password: process.env.DEV_OPERATOR_PASSWORD || 'default-operator-password'
  },
  {
    id: 'dev-engineer-001',
    email: process.env.DEV_ENGINEER_EMAIL || 'engineer@example.com',
    name: '테스트 엔지니어',
    role: 'engineer',
    assigned_machines: [],
    created_at: new Date().toISOString(),
    password: process.env.DEV_ENGINEER_PASSWORD || 'default-engineer-password'
  }
];

export const MOCK_USERS = getMockUsers();

// 로컬 스토리지 키
const AUTH_STORAGE_KEY = 'cnc_oee_auth_user';
const SESSION_STORAGE_KEY = 'cnc_oee_auth_session';

export class MockAuthService {
  // 로그인
  static async login(email: string, password: string): Promise<User> {
    // 실제 환경에서는 지연 시뮬레이션
    await new Promise(resolve => setTimeout(resolve, 500));

    const user = MOCK_USERS.find(u => u.email === email && u.password === password);
    
    if (!user) {
      throw new Error('이메일 또는 비밀번호가 올바르지 않습니다.');
    }

    // 비밀번호 제외하고 사용자 정보 반환
    const { password: _, ...userWithoutPassword } = user;
    
    // 로컬 스토리지에 저장
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(userWithoutPassword));
    localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({
      access_token: `mock_token_${user.id}`,
      refresh_token: `mock_refresh_${user.id}`,
      expires_at: Date.now() + (24 * 60 * 60 * 1000), // 24시간
      user: userWithoutPassword
    }));

    return userWithoutPassword;
  }

  // 로그아웃
  static async logout(): Promise<void> {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }

  // 현재 사용자 가져오기
  static getCurrentUser(): User | null {
    try {
      const userStr = localStorage.getItem(AUTH_STORAGE_KEY);
      const sessionStr = localStorage.getItem(SESSION_STORAGE_KEY);
      
      if (!userStr || !sessionStr) return null;
      
      const session = JSON.parse(sessionStr);
      
      // 세션 만료 확인
      if (Date.now() > session.expires_at) {
        this.logout();
        return null;
      }
      
      return JSON.parse(userStr);
    } catch (error) {
      console.error('사용자 정보 로드 실패:', error);
      return null;
    }
  }

  // 세션 확인
  static isAuthenticated(): boolean {
    return this.getCurrentUser() !== null;
  }

  // 자동 로그인 (개발 편의용)
  static async autoLogin(): Promise<User | null> {
    const savedUser = this.getCurrentUser();
    if (savedUser) {
      return savedUser;
    }

    // 개발 환경에서 기본 관리자 계정으로 자동 로그인
    if (process.env.NODE_ENV === 'development') {
      try {
        const adminEmail = process.env.DEV_ADMIN_EMAIL || 'admin@example.com';
        const adminPassword = process.env.DEV_ADMIN_PASSWORD || 'default-admin-password';
        return await this.login(adminEmail, adminPassword);
      } catch (error) {
        console.warn('자동 로그인 실패:', error);
        return null;
      }
    }

    return null;
  }

  // 사용자 목록 (개발용)
  static getAvailableUsers(): Array<Omit<User & { password: string }, 'password'> & { email: string }> {
    return MOCK_USERS.map(({ password, ...user }) => ({
      ...user,
      email: user.email
    }));
  }

  // 역할별 빠른 전환 (개발용)
  static async switchToRole(role: 'admin' | 'operator' | 'engineer'): Promise<User> {
    const user = MOCK_USERS.find(u => u.role === role);
    if (!user) {
      throw new Error(`${role} 역할의 사용자를 찾을 수 없습니다.`);
    }
    
    return this.login(user.email, user.password);
  }
}

// 개발 환경 확인
export const isDevelopment = () => {
  // 환경 변수에서 직접 체크
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 명시적 개발 모드
  if (process.env.NODE_ENV === 'development') {
    return true;
  }

  // Supabase 설정이 없거나 플레이스홀더인 경우
  const isInvalidConfig = !supabaseUrl || 
    !supabaseKey ||
    supabaseUrl.includes('placeholder') ||
    supabaseUrl.includes('demo') ||
    supabaseUrl.includes('your_supabase') ||
    supabaseKey.includes('placeholder') ||
    supabaseKey.includes('your_supabase') ||
    supabaseUrl.length < 10 ||
    supabaseKey.length < 50;

  // 유효한 Supabase URL 형식이 아닌 경우
  const isValidSupabaseUrl = supabaseUrl && 
    (supabaseUrl.includes('.supabase.co') || supabaseUrl.includes('localhost'));

  return isInvalidConfig || !isValidSupabaseUrl;
};