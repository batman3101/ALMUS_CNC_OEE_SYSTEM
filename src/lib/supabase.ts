import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { getEnvConfig } from './env-validation';

const env = getEnvConfig();
const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 연결 상태 추적
let isConnected = false;
let lastConnectionCheck = 0;
const CONNECTION_CHECK_INTERVAL = 30000; // 30초

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true
  }
});

// Supabase 연결 상태 확인 함수
export async function checkSupabaseConnection(): Promise<boolean> {
  try {
    const now = Date.now();
    // 최근 체크가 30초 이내라면 캐시된 결과 반환
    if (now - lastConnectionCheck < CONNECTION_CHECK_INTERVAL && isConnected) {
      return isConnected;
    }

    // 간단한 쿼리로 연결 상태 확인
    const { error } = await supabase
      .from('system_settings')
      .select('count', { count: 'exact', head: true })
      .limit(1);
    
    isConnected = !error;
    lastConnectionCheck = now;
    
    if (error) {
      console.warn('Supabase connection check failed:', error.message);
    }
    
    return isConnected;
  } catch (error) {
    console.error('Error checking Supabase connection:', error);
    isConnected = false;
    lastConnectionCheck = Date.now();
    return false;
  }
}

// 연결 상태 가져오기 (동기)
export function getConnectionStatus(): boolean {
  return isConnected;
}

// Supabase 작업을 안전하게 실행하는 래퍼 함수
export async function safeSupabaseOperation<T>(
  operation: (client: SupabaseClient) => Promise<T>,
  fallbackValue?: T
): Promise<T> {
  try {
    const connected = await checkSupabaseConnection();
    
    if (!connected && fallbackValue !== undefined) {
      console.warn('Supabase not connected, returning fallback value');
      return fallbackValue;
    }
    
    return await operation(supabase);
  } catch (error) {
    console.error('Supabase operation failed:', error);
    
    if (fallbackValue !== undefined) {
      return fallbackValue;
    }
    
    throw error;
  }
}

// Server-side client for admin operations
export const createServerClient = () => {
  const env = getEnvConfig();
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  
  if (!serviceRoleKey) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY environment variable');
  }
  
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
};