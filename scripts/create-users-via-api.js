require('dotenv').config({ path: '.env.local' });

// 시드 비밀번호는 코드에 두지 않는다. 이 파일에는 계정 5개의 평문 비밀번호가 리터럴로
// 박혀 있었고 저장소는 공개다(Codex 감사 2026-07-29 후속). 환경변수로 받고, 없으면
// 약한 기본값으로 조용히 진행하는 대신 실패한다 — 시드 스크립트가 만든 계정은 실제 계정이다.
const SEED_PASSWORD = process.env.SEED_USER_PASSWORD;
if (!SEED_PASSWORD) {
  console.error('❌ SEED_USER_PASSWORD 환경변수가 필요합니다. .env.local 에 설정하세요.');
  process.exit(1);
}

const usersToCreate = [
  { name: '박관리', email: 'admin3@cnc-oee.com', password: SEED_PASSWORD, role: 'admin' },
  { name: '정기술', email: 'engineer2@cnc-oee.com', password: SEED_PASSWORD, role: 'engineer' },
  { name: '서운영', email: 'operator2@cnc-oee.com', password: SEED_PASSWORD, role: 'operator' },
  { name: '이관리', email: 'admin2@cnc-oee.com', password: SEED_PASSWORD, role: 'engineer' },
  { name: '에헤야', email: 'limcaca@gmail.com', password: SEED_PASSWORD, role: 'operator' }
];

async function createUsersViaAPI() {
  console.log('🚀 사용자 CRUD API를 통한 계정 생성 시작...\n');

  for (const user of usersToCreate) {
    try {
      console.log(`👤 생성 중: ${user.name} (${user.email})`);
      
      const response = await fetch('http://localhost:3002/api/admin/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(user),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error(`  ❌ 생성 실패: ${errorData.error}`);
        continue;
      }

      const result = await response.json();
      console.log(`  ✅ 생성 완료! ID: ${result.user.id}`);
      
    } catch (error) {
      console.error(`❌ ${user.name} 처리 중 오류:`, error.message);
    }
  }

  console.log('\n🎉 모든 사용자 생성 완료!');
  console.log('\n📋 로그인 정보:');
  console.log('임시 비밀번호: cncoee123!');
  console.log('모든 사용자가 이 비밀번호로 로그인할 수 있습니다.');
}

createUsersViaAPI().catch(console.error);