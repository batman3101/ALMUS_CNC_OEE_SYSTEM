const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

// Supabase Admin 클라이언트 생성
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  }
);

// 임시 비밀번호는 코드에 두지 않는다 — 저장소가 공개다(Codex 감사 2026-07-29 후속).
// 없으면 약한 기본값으로 진행하지 않고 실패한다.
const SEED_PASSWORD = process.env.SEED_USER_PASSWORD;
if (!SEED_PASSWORD) {
  console.error('❌ SEED_USER_PASSWORD 환경변수가 필요합니다. .env.local 에 설정하세요.');
  process.exit(1);
}

// 생성할 사용자들
const usersToCreate = [
  {
    existing_id: '5e23e9a0-59f5-40c2-8851-3f404d44155f',
    name: '박관리',
    email: 'admin3@cnc-oee.com',
    role: 'admin',
    password: SEED_PASSWORD
  },
  {
    existing_id: 'af2a254b-a0ce-43e0-99c9-cea8c95c3dae',
    name: '정기술',
    email: 'engineer2@cnc-oee.com',
    role: 'engineer',
    password: SEED_PASSWORD
  },
  {
    existing_id: 'df30c251-c614-48f1-ab8e-5e0b95e37938',
    name: '서운영',
    email: 'operator2@cnc-oee.com',
    role: 'operator',
    password: SEED_PASSWORD
  },
  {
    existing_id: 'eeb70b8f-2cf7-4eae-a2e1-6ce0bb6cf542',
    name: '이관리',
    email: 'admin2@cnc-oee.com',
    role: 'engineer',
    password: SEED_PASSWORD
  },
  {
    existing_id: 'befad2bf-e896-4c0d-ad3f-1a168cffc1ac',
    name: '에헤야',
    email: 'limcaca@gmail.com',
    role: 'operator',
    password: SEED_PASSWORD
  }
];

async function createMissingAuthAccounts() {
  console.log('🚀 기존 user_profiles 사용자들의 auth 계정 생성 시작...\n');

  for (const user of usersToCreate) {
    try {
      console.log(`👤 처리 중: ${user.name} (${user.email})`);
      
      // 1. 새로운 auth 계정 생성
      console.log('  📧 Auth 계정 생성 중...');
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,  // 이메일 인증 바로 완료
        user_metadata: {
          name: user.name,
          role: user.role
        }
      });

      if (authError) {
        console.error(`  ❌ Auth 계정 생성 실패: ${authError.message}`);
        continue;
      }

      const newAuthId = authData.user.id;
      console.log(`  ✅ Auth 계정 생성 완료: ${newAuthId}`);

      // 2. 기존 user_profiles 데이터의 user_id를 새 auth ID로 업데이트
      console.log('  🔄 user_profiles 업데이트 중...');
      const { error: updateError } = await supabaseAdmin
        .from('user_profiles')
        .update({ user_id: newAuthId })
        .eq('user_id', user.existing_id);

      if (updateError) {
        console.error(`  ❌ user_profiles 업데이트 실패: ${updateError.message}`);
        // 생성된 auth 계정 롤백
        await supabaseAdmin.auth.admin.deleteUser(newAuthId);
        continue;
      }

      console.log(`  ✅ 완료! ${user.name} - Auth ID: ${newAuthId}\n`);
      
    } catch (error) {
      console.error(`❌ ${user.name} 처리 중 오류:`, error.message);
    }
  }

  console.log('🎉 모든 계정 생성 완료!');
  console.log('\n📋 로그인 정보:');
  // 값을 찍지 않는다 — 값을 아는 사람이 실행하는 스크립트이고, 출력은 CI 로그·터미널
  // 스크롤백·화면 공유로 남는다. 18행에서 이미 env 로 옮긴 비밀번호를 여기서 다시
  // 평문으로 뱉으면 옮긴 의미가 없다(실제로 그렇게 남아 있었다).
  console.log('임시 비밀번호: SEED_USER_PASSWORD 환경변수에 설정한 값');
  console.log('모든 사용자는 그 비밀번호로 로그인할 수 있습니다.');
}

// 실행
createMissingAuthAccounts().catch(console.error);