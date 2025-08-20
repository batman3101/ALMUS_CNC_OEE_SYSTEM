# CNC OEE 모니터링 시스템

CNC 설비의 OEE(Overall Equipment Effectiveness)를 실시간으로 모니터링하고 관리하는 웹 애플리케이션입니다.

## 주요 기능

- 🏭 **실시간 설비 모니터링**: 800+ CNC 설비 상태 실시간 추적
- 📊 **OEE 계산 및 분석**: 가동률, 성능, 품질 지표 자동 계산
- 🔔 **스마트 알림 시스템**: 임계값 기반 실시간 알림
- 📈 **대시보드 및 리포트**: 역할별 맞춤 대시보드
- 🌐 **다국어 지원**: 한국어, 베트남어 지원
- 🎨 **다크/라이트 테마**: 사용자 맞춤 테마 설정
- 👥 **역할 기반 접근 제어**: 관리자, 엔지니어, 운영자 권한 관리

## 기술 스택

- **Frontend**: Next.js 14, React 18, TypeScript
- **UI Library**: Ant Design, Chart.js
- **Backend**: Supabase (PostgreSQL, Auth, Realtime)
- **Styling**: CSS Modules, Tailwind CSS
- **State Management**: React Context API
- **Internationalization**: react-i18next

## 시작하기

### 1. 환경 설정

```bash
# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env.local
```

### 2. Supabase 설정

1. [Supabase](https://supabase.com)에서 새 프로젝트 생성
2. `.env.local` 파일에 Supabase URL과 API 키 설정:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
```

### 3. 데이터베이스 초기화

Supabase SQL Editor에서 다음 스크립트들을 순서대로 실행:

1. **기본 스키마 설정**: `supabase-setup.sql`
2. **시스템 설정 초기화**: `scripts/init-system-settings.sql`
3. **성능 최적화**: `database-optimization.sql`

### 4. 개발 서버 실행

```bash
npm run dev
```

[http://localhost:3000](http://localhost:3000)에서 애플리케이션을 확인할 수 있습니다.

## 문제 해결

### 시스템 설정 오류

시스템 설정 관련 오류가 발생하면:

1. **디버그 페이지 확인**: `/debug/system-settings`
2. **데이터베이스 상태 확인**: Supabase 대시보드에서 `system_settings` 테이블 존재 여부 확인
3. **초기화 스크립트 실행**: `scripts/init-system-settings.sql` 실행

### 권한 오류

사용자 권한 관련 문제:

1. **사용자 프로필 확인**: `user_profiles` 테이블에 사용자 정보 존재 여부 확인
2. **RLS 정책 확인**: Row Level Security 정책이 올바르게 설정되었는지 확인

## 프로젝트 구조

```
src/
├── app/                    # Next.js App Router
├── components/             # React 컴포넌트
│   ├── auth/              # 인증 관련
│   ├── dashboard/         # 대시보드
│   ├── layout/            # 레이아웃
│   ├── settings/          # 시스템 설정
│   └── notifications/     # 알림 시스템
├── contexts/              # React Context
├── hooks/                 # 커스텀 훅
├── lib/                   # 유틸리티 라이브러리
├── types/                 # TypeScript 타입 정의
└── utils/                 # 유틸리티 함수

supabase/
├── functions/             # Edge Functions
└── migrations/            # 데이터베이스 마이그레이션
```

## 배포

### Vercel 배포

```bash
# Vercel CLI 설치
npm i -g vercel

# 배포
vercel --prod
```

### 환경 변수 설정

프로덕션 환경에서 다음 환경 변수를 설정하세요:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
