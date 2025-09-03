const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

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

async function verifyAuthAccounts() {
  console.log('🔍 Auth 계정 상태 확인 중...\n');

  try {
    // 1. auth.users 테이블의 모든 사용자 조회
    console.log('📋 Auth Users:');
    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (authError) {
      console.error('❌ Auth users 조회 실패:', authError.message);
      return;
    }

    console.log(`총 ${authData.users.length}명의 auth 사용자 발견:`);
    authData.users.forEach((user, index) => {
      console.log(`${index + 1}. ${user.email} (ID: ${user.id})`);
    });

    console.log('\n📋 User Profiles:');
    const { data: profiles, error: profileError } = await supabaseAdmin
      .from('user_profiles')
      .select('user_id, name, email, role');

    if (profileError) {
      console.error('❌ User profiles 조회 실패:', profileError.message);
      return;
    }

    console.log(`총 ${profiles.length}명의 프로필 발견:`);
    profiles.forEach((profile, index) => {
      const authUser = authData.users.find(u => u.id === profile.user_id);
      console.log(`${index + 1}. ${profile.name} (${profile.email}) - Auth: ${authUser ? '✅' : '❌'}`);
    });

    console.log('\n🔍 매핑되지 않은 프로필들:');
    const unmappedProfiles = profiles.filter(profile => 
      !authData.users.some(u => u.id === profile.user_id)
    );
    
    if (unmappedProfiles.length === 0) {
      console.log('✅ 모든 프로필이 Auth 계정과 매핑되어 있습니다!');
    } else {
      console.log(`❌ ${unmappedProfiles.length}개의 프로필이 Auth 계정과 매핑되지 않았습니다:`);
      unmappedProfiles.forEach(profile => {
        console.log(`- ${profile.name} (${profile.user_id})`);
      });
    }

  } catch (error) {
    console.error('❌ 오류:', error.message);
  }
}

verifyAuthAccounts().catch(console.error);