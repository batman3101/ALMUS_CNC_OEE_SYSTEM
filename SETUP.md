# CNC OEE 모니터링 시스템 설정 가이드

## 프로젝트 개요

이 프로젝트는 800대의 CNC 공작기계 운영 데이터를 관리하고 설비 종합 효율(OEE) 지표를 분석하기 위한 웹 애플리케이션입니다.

## 기술 스택

- **프론트엔드**: Next.js 15.4.5 + TypeScript + React 19
- **UI 라이브러리**: Ant Design 5.26.7
- **차트**: Chart.js 4.5.0 + react-chartjs-2
- **다국어**: react-i18next
- **백엔드**: Supabase (BaaS)
- **데이터베이스**: PostgreSQL (Supabase 관리형)

## 환경 설정

### 1. 의존성 설치

```bash
cd cnc-oee-monitoring
npm install
```

### 2. Supabase 프로젝트 설정

1. [Supabase](https://supabase.com)에서 새 프로젝트 생성
2. 프로젝트 설정에서 API 키 확인
3. `.env.local` 파일에 환경 변수 설정:

```bash
cp .env.example .env.local
```

`.env.local` 파일을 편집하여 실제 Supabase 정보로 업데이트:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_supabase_service_role_key
```

### 3. 데이터베이스 설정

1. Supabase 대시보드에서 SQL Editor로 이동
2. `supabase-setup.sql` 파일의 내용을 복사하여 실행
3. 테이블과 보안 정책이 생성되었는지 확인

### 4. 개발 서버 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)으로 접속

## 프로젝트 구조

```
src/
├── app/                    # Next.js App Router
│   ├── demo/              # 데모 페이지
│   ├── machines/          # 설비 관리 페이지
│   ├── layout.tsx         # 루트 레이아웃
│   ├── page.tsx           # 홈페이지
│   └── providers.tsx      # 전역 프로바이더
├── components/            # React 컴포넌트
│   ├── auth/              # 인증 관련 컴포넌트
│   ├── dashboard/         # 대시보드 컴포넌트
│   ├── layout/            # 레이아웃 컴포넌트
│   ├── machines/          # 설비 관리 컴포넌트
│   ├── oee/               # OEE 관련 컴포넌트
│   └── production/        # 생산 실적 컴포넌트
├── contexts/              # React Context
├── hooks/                 # 커스텀 훅
├── lib/                   # 라이브러리 설정
│   ├── i18n.ts           # 다국어 설정
│   └── supabase.ts       # Supabase 클라이언트
├── types/                 # TypeScript 타입 정의
│   ├── database.ts       # 데이터베이스 타입
│   └── index.ts          # 메인 타입
└── utils/                 # 유틸리티 함수
    ├── oeeCalculator.ts  # OEE 계산 로직
    └── shiftUtils.ts     # 교대 관련 유틸리티
```

## 사용 가능한 스크립트

- `npm run dev` - 개발 서버 실행 (Turbopack 사용)
- `npm run build` - 프로덕션 빌드
- `npm run start` - 프로덕션 서버 실행
- `npm run lint` - ESLint 실행
- `npm run test` - Jest 테스트 실행
- `npm run test:watch` - Jest 테스트 감시 모드

## 다음 단계

1. Supabase 데이터베이스 스키마 생성 (Task 2.1)
2. Row Level Security 정책 구현 (Task 2.2)
3. 인증 시스템 구현 (Task 3)

자세한 구현 계획은 `.kiro/specs/cnc-oee-monitoring/tasks.md` 파일을 참조하세요.