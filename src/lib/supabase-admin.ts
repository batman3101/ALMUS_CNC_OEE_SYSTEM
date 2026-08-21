import { createClient } from '@supabase/supabase-js';

/**
 * Supabase Admin Client
 * 서버 측 작업 전용 - API 라우트에서만 사용, 클라이언트 컴포넌트에서는 절대 사용 금지
 */

// 환경별 검증 레벨 설정
const isDevelopment = process.env.NODE_ENV === 'development';

/**
 * 로컬 Supabase 스택인가.
 *
 * 아래 URL 검증은 운영에서 **옳다** — service role key 를 평문으로 보내면 안 되고,
 * 엉뚱한 도메인을 가리키면 데이터가 남의 프로젝트로 간다.
 *
 * 그러나 그 규칙이 `supabase start` 로 띄운 로컬 스택(`http://localhost:54321`)까지 막았다.
 * 그래서 격리 staging 에서 실제 역할로 앱을 검증할 방법이 없었고, 그 결과 슈퍼유저로는
 * 보이지 않는 권한 결함(service_role 에 grant 누락)이 정적 검사·계약 테스트·psql 격리
 * 테스트를 모두 통과했다.
 *
 * 그래서 예외를 **개발 모드 + 루프백 호스트**로만 좁혀 연다. 두 조건을 모두 요구하므로
 * 프로덕션 빌드에서는 어떤 값을 넣어도 이 경로로 들어올 수 없다.
 */
function isLocalSupabase(rawUrl: string): boolean {
  if (!isDevelopment) return false;
  try {
    const { hostname } = new URL(rawUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

/**
 * 환경 변수 유효성 검증
 */
function validateEnvironmentVariables(): { url: string; serviceRoleKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  // 1단계: 기본 존재 여부 및 빈 값 검증
  if (!url || typeof url !== 'string' || url.trim() === '') {
    const error = isDevelopment 
      ? 'NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았거나 빈 값입니다.'
      : 'Supabase 설정 오류가 발생했습니다.';
    throw new Error(error);
  }

  if (!serviceRoleKey || typeof serviceRoleKey !== 'string' || serviceRoleKey.trim() === '') {
    const error = isDevelopment
      ? 'SUPABASE_SERVICE_ROLE_KEY가 설정되지 않았거나 빈 값입니다.'
      : 'Supabase 인증 설정 오류가 발생했습니다.';
    throw new Error(error);
  }

  // 2단계: URL 형식 검증
  const trimmedUrl = url.trim();
  const localStack = isLocalSupabase(trimmedUrl);
  if (!localStack && !trimmedUrl.startsWith('https://')) {
    const error = isDevelopment
      ? 'SUPABASE_URL은 https://로 시작해야 합니다.'
      : 'Supabase URL 설정이 올바르지 않습니다.';
    throw new Error(error);
  }

  // URL 형식 상세 검증
  try {
    const urlObj = new URL(trimmedUrl);
    // 로컬 스택의 호스트는 `localhost` 라 'supabase' 를 포함하지 않는다.
    if (!localStack && !urlObj.hostname.includes('supabase')) {
      const error = isDevelopment
        ? 'SUPABASE_URL이 유효한 Supabase 도메인이 아닙니다.'
        : 'Supabase 도메인 설정이 올바르지 않습니다.';
      throw new Error(error);
    }
  } catch (urlError) {
    const error = isDevelopment
      ? `SUPABASE_URL 형식이 올바르지 않습니다: ${urlError instanceof Error ? urlError.message : '알 수 없는 오류'}`
      : 'Supabase URL 형식이 올바르지 않습니다.';
    throw new Error(error);
  }

  // 3단계: Service Role Key 형식 검증
  const trimmedKey = serviceRoleKey.trim();
  if (trimmedKey.length < 50) {  // Supabase service role key는 일반적으로 50자 이상
    const error = isDevelopment
      ? 'SUPABASE_SERVICE_ROLE_KEY의 길이가 너무 짧습니다. 올바른 service role key인지 확인해주세요.'
      : 'Supabase 인증 키 형식이 올바르지 않습니다.';
    throw new Error(error);
  }

  // JWT 형식 기본 검증 (eyJ로 시작하는지)
  if (!trimmedKey.startsWith('eyJ')) {
    const error = isDevelopment
      ? 'SUPABASE_SERVICE_ROLE_KEY가 올바른 JWT 형식이 아닙니다.'
      : 'Supabase 인증 키 형식이 올바르지 않습니다.';
    throw new Error(error);
  }

  // 개발 환경에서만 키 마스킹 로그 출력
  if (isDevelopment) {
    const maskedKey = `${trimmedKey.substring(0, 10)}...${trimmedKey.substring(trimmedKey.length - 4)}`;
    console.log('✅ Supabase Admin 설정 검증 완료');
    console.log(`   URL: ${trimmedUrl}`);
    console.log(`   Service Role Key: ${maskedKey}`);
  }

  return {
    url: trimmedUrl,
    serviceRoleKey: trimmedKey
  };
}

// 환경 변수 검증 및 설정
let supabaseConfig: { url: string; serviceRoleKey: string };

try {
  supabaseConfig = validateEnvironmentVariables();
} catch (error) {
  // 프로덕션에서는 일반적인 오류 메시지, 개발에서는 상세한 정보
  const errorMessage = isDevelopment 
    ? `Supabase Admin 설정 오류: ${error instanceof Error ? error.message : '알 수 없는 오류'}`
    : 'Supabase 설정에 문제가 있습니다. 관리자에게 문의하세요.';
  
  console.error('❌ Supabase Admin 초기화 실패:', errorMessage);
  throw new Error(errorMessage);
}

// Supabase Admin 클라이언트 생성
export const supabaseAdmin = createClient(
  supabaseConfig.url, 
  supabaseConfig.serviceRoleKey, 
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    // 추가 보안 옵션
    global: {
      headers: {
        'x-application-name': 'cnc-oee-admin'
      }
    }
  }
);

// 타입 안전성을 위한 명시적 타입 내보내기
export type SupabaseAdminClient = typeof supabaseAdmin;