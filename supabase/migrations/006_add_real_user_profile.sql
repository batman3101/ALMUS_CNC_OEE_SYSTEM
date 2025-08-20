-- 실제 사용자 계정을 user_profiles 테이블에 추가하는 스크립트
-- 이 스크립트를 실행하기 전에 실제 사용자 ID를 확인해야 합니다

-- 1. 현재 Authentication 테이블에서 사용자 확인 (참고용 쿼리)
-- SELECT id, email, created_at FROM auth.users WHERE email = '실제이메일@domain.com';

-- 2. user_profiles 테이블에 실제 계정 추가
-- 아래의 '실제사용자ID'와 '실제이메일@domain.com', '실제이름'을 실제 값으로 변경해야 합니다

INSERT INTO user_profiles (
  user_id,
  name,
  role,
  email,
  is_active,
  assigned_machines,
  created_at,
  updated_at
) VALUES (
  '3dc6483a-89c9-4ba8-9b9d-ecb9abba46fa', -- Authentication 테이블의 실제 user ID로 변경
  '박영일', -- 실제 이름으로 변경
  'admin',
  'zetooo1972@gmail.com', -- 실제 이메일로 변경

  true,
  ARRAY[]::varchar[], -- 관리자는 모든 설비에 접근 가능하므로 빈 배열
  NOW(),
  NOW()
) ON CONFLICT (user_id) DO UPDATE SET
  name = EXCLUDED.name,
  role = EXCLUDED.role,
  email = EXCLUDED.email,
  is_active = EXCLUDED.is_active,
  updated_at = NOW();

-- 3. 기존 테스트 계정들을 비활성화 (선택사항)
-- UPDATE user_profiles SET is_active = false WHERE email LIKE '%test%' OR email = 'zetooo1972@gmail.com';