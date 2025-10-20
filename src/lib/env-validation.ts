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
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 플레이스홀더 값들을 체크
  const isPlaceholderUrl = !supabaseUrl || 
    supabaseUrl === 'your_supabase_project_url' || 
    supabaseUrl.includes('your_supabase') ||
    supabaseUrl.length < 10;
  
  const isPlaceholderKey = !supabaseKey || 
    supabaseKey === 'your_supabase_anon_key' || 
    supabaseKey.includes('your_supabase') ||
    supabaseKey.length < 50;

  // 실제 Supabase URL 패턴 검증
  const isValidSupabaseUrl = supabaseUrl && 
    (supabaseUrl.includes('.supabase.co') || supabaseUrl.includes('localhost'));

  if (isPlaceholderUrl || isPlaceholderKey || !isValidSupabaseUrl) {
    console.error(
      '❌ Missing Supabase Configuration\n' +
      'Supabase credentials are not properly configured\n' +
      `- URL valid: ${!isPlaceholderUrl && isValidSupabaseUrl}\n` +
      `- Key valid: ${!isPlaceholderKey}\n` +
      'Please configure .env.local with actual Supabase credentials.'
    );
    throw new Error('Supabase configuration is required');
  } else {
    console.info(
      '🔗 Production Mode: Using Supabase authentication\n' +
      `Connected to: ${supabaseUrl}`
    );
  }

  return {
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: supabaseKey,
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