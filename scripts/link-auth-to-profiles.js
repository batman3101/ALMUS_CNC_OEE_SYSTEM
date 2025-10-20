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

// 생성된 Auth 계정들과 기존 프로필 데이터 매핑
const userMappings = [
  {
    auth_id: '84d5dc71-13f0-4ff3-8c84-4c2a85e64807',
    old_profile_id: '5e23e9a0-59f5-40c2-8851-3f404d44155f',
    name: '박관리',
    email: 'admin3@cnc-oee.com',
    role: 'admin'
  },
  {
    auth_id: '0f898d33-7b64-46c9-a1ff-d1385fe75ff7',
    old_profile_id: 'af2a254b-a0ce-43e0-99c9-cea8c95c3dae',
    name: '정기술',
    email: 'engineer2@cnc-oee.com',
    role: 'engineer'
  },
  {
    auth_id: '1f3c9bc7-30dc-4945-92ed-9f92dd9ce8d9',
    old_profile_id: 'df30c251-c614-48f1-ab8e-5e0b95e37938',
    name: '서운영',
    email: 'operator2@cnc-oee.com',
    role: 'operator'
  },
  {
    auth_id: '108f0bb8-4330-4c14-b63a-2c47eec9a908',
    old_profile_id: 'eeb70b8f-2cf7-4eae-a2e1-6ce0bb6cf542',
    name: '이관리',
    email: 'admin2@cnc-oee.com',
    role: 'engineer'
  },
  {
    auth_id: 'f6b96da7-3ba4-4925-b785-e8a29bb2ba75',
    old_profile_id: 'befad2bf-e896-4c0d-ad3f-1a168cffc1ac',
    name: '에헤야',
    email: 'limcaca@gmail.com',
    role: 'operator'
  }
];

async function linkAuthToProfiles() {
  console.log('🔄 Auth 계정과 프로필 데이터 연결 시작...\n');

  for (const mapping of userMappings) {
    try {
      console.log(`👤 처리 중: ${mapping.name}`);
      
      // 1. 기존 프로필에서 assigned_machines 정보 가져오기
      console.log('  📋 기존 프로필 데이터 조회...');
      const { data: oldProfile, error: profileError } = await supabaseAdmin
        .from('user_profiles')
        .select('assigned_machines')
        .eq('user_id', mapping.old_profile_id)
        .single();

      if (profileError) {
        console.error(`  ❌ 기존 프로필 조회 실패: ${profileError.message}`);
        continue;
      }

      // 2. 새로운 프로필 생성 (새 auth ID로)
      console.log('  ➕ 새 프로필 생성...');
      const { data: newProfile, error: insertError } = await supabaseAdmin
        .from('user_profiles')
        .insert({
          user_id: mapping.auth_id,
          name: mapping.name,
          email: mapping.email,
          role: mapping.role,
          assigned_machines: oldProfile?.assigned_machines || null,
          is_active: true
        })
        .select()
        .single();

      if (insertError) {
        console.error(`  ❌ 새 프로필 생성 실패: ${insertError.message}`);
        continue;
      }

      // 3. 기존 프로필 삭제
      console.log('  🗑️ 기존 프로필 삭제...');
      const { error: deleteError } = await supabaseAdmin
        .from('user_profiles')
        .delete()
        .eq('user_id', mapping.old_profile_id);

      if (deleteError) {
        console.error(`  ⚠️ 기존 프로필 삭제 실패: ${deleteError.message}`);
        console.log('  📝 새 프로필은 생성되었으나 기존 프로필이 남아있을 수 있습니다.');
      }

      console.log(`  ✅ 완료! ${mapping.name} - 새 ID: ${mapping.auth_id}\n`);
      
    } catch (error) {
      console.error(`❌ ${mapping.name} 처리 중 오류:`, error.message);
    }
  }

  console.log('🎉 Auth 계정과 프로필 연결 완료!');
}

linkAuthToProfiles().catch(console.error);