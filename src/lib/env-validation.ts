/**
 * 환경 변수 검증 유틸리티
 * 필수 환경 변수가 설정되어 있는지 확인합니다.
 */

interface EnvConfig {
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  NEXT_PUBLIC_APP_NAME?: string;
  NEXT_PUBLIC_DEFAULT_LANGUAGE?: string;
}

export function validateEnv(): EnvConfig {
  // 개발 환경에서 사용할 기본값들
  const defaultSupabaseUrl = 'https://demo.supabase.co';
  const defaultSupabaseKey = 'demo-key';

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 플레이스홀더 값들을 체크하고 기본값으로 대체
  const isPlaceholderUrl = !supabaseUrl || 
    supabaseUrl === 'your_supabase_project_url' || 
    supabaseUrl.includes('your_supabase');
  
  const isPlaceholderKey = !supabaseKey || 
    supabaseKey === 'your_supabase_anon_key' || 
    supabaseKey.includes('your_supabase');

  if (isPlaceholderUrl || isPlaceholderKey) {
    console.warn(
      '⚠️  Supabase environment variables are not properly configured. Using demo values.\n' +
      'Please update your .env.local file with actual Supabase credentials for production use.'
    );
  }

  return {
    NEXT_PUBLIC_SUPABASE_URL: isPlaceholderUrl ? defaultSupabaseUrl : supabaseUrl!,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: isPlaceholderKey ? defaultSupabaseKey : supabaseKey!,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME || 'CNC OEE Monitoring System',
    NEXT_PUBLIC_DEFAULT_LANGUAGE: process.env.NEXT_PUBLIC_DEFAULT_LANGUAGE || 'ko'
  };
}

export function getEnvConfig(): EnvConfig {
  try {
    return validateEnv();
  } catch (error) {
    console.error('Environment validation failed:', error);
    throw error;
  }
}