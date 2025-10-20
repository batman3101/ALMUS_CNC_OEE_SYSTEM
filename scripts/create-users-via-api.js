const usersToCreate = [
  {
    name: '박관리',
    email: 'admin3@cnc-oee.com',
    password: 'cncoee123!',
    role: 'admin'
  },
  {
    name: '정기술', 
    email: 'engineer2@cnc-oee.com',
    password: 'cncoee123!',
    role: 'engineer'
  },
  {
    name: '서운영',
    email: 'operator2@cnc-oee.com', 
    password: 'cncoee123!',
    role: 'operator'
  },
  {
    name: '이관리',
    email: 'admin2@cnc-oee.com',
    password: 'cncoee123!',
    role: 'engineer'
  },
  {
    name: '에헤야',
    email: 'limcaca@gmail.com',
    password: 'cncoee123!',
    role: 'operator'
  }
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