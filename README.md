# CNC OEE 모니터링 시스템

CNC 설비의 OEE(Overall Equipment Effectiveness)를 실시간으로 모니터링하고 관리하는 웹 애플리케이션입니다.

## 주요 기능

- 🏭 **실시간 설비 모니터링**: CNC 설비 상태 실시간 추적 및 업데이트
- 📊 **OEE 계산 및 분석**: 가동률, 성능률, 품질률 지표 자동 계산
- 🔔 **스마트 알림 시스템**: 실시간 설비 상태 기반 자동 알림
- 📈 **대시보드 및 리포트**: 역할별(관리자/엔지니어/운영자) 맞춤 대시보드
- 🌐 **다국어 지원**: 한국어, 베트남어 완벽 지원
- 🎨 **반응형 UI/UX**: Ant Design 기반 모던 인터페이스
- 👥 **역할 기반 접근 제어**: 사용자별 데이터 접근 권한 관리
- ⚡ **실시간 동기화**: Supabase Realtime + Polling 하이브리드 방식

## 기술 스택

### 🖥️ Frontend
- **Next.js 14** - React 기반 풀스택 프레임워크
- **React 18** - 최신 React 기능 (Server Components, Suspense)
- **TypeScript** - 타입 안전성 보장
- **Ant Design** - 엔터프라이즈급 UI 컴포넌트 라이브러리
- **Chart.js** - 실시간 차트 및 데이터 시각화

### 🗄️ Backend & Database
- **Supabase** - PostgreSQL 기반 BaaS
  - Real-time subscriptions
  - Row Level Security (RLS)
  - Authentication & Authorization
  - Edge Functions
- **PostgreSQL** - 관계형 데이터베이스

### 🎨 Styling & UI
- **CSS Modules** - 컴포넌트 스코프 스타일링
- **Tailwind CSS** - 유틸리티 기반 CSS 프레임워크

### 🔧 State Management & Utils
- **React Context API** - 전역 상태 관리
- **Custom Hooks** - 재사용 가능한 비즈니스 로직
- **date-fns** - 날짜/시간 처리
- **react-i18next** - 국제화(i18n)

## 🚀 시작하기

### 1. 환경 설정

```bash
# 저장소 클론
git clone [repository-url]
cd cnc-oee-monitoring

# 의존성 설치
npm install

# 환경 변수 설정
cp .env.example .env.local
```

### 2. Supabase 설정

1. [Supabase](https://supabase.com)에서 새 프로젝트 생성
2. `.env.local` 파일에 Supabase 설정:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

### 3. 데이터베이스 초기화

Supabase SQL Editor에서 다음 스크립트들을 순서대로 실행:

```sql
-- 1. 기본 테이블 스키마 생성
-- machines, machine_logs, production_records 등

-- 2. RLS 정책 설정
-- 역할 기반 접근 제어 정책

-- 3. 실시간 구독 활성화
-- Realtime을 위한 테이블 설정

-- 4. 초기 데이터 삽입
-- 시스템 설정, 사용자 프로필 등
```

### 4. 개발 서버 실행

```bash
npm run dev
```

🌐 [http://localhost:3000](http://localhost:3000)에서 애플리케이션을 확인할 수 있습니다.

## 📁 프로젝트 구조

```
src/
├── app/                    # Next.js App Router
│   ├── (auth)/            # 인증 관련 라우트
│   ├── dashboard/         # 대시보드 페이지
│   ├── machines/          # 설비 관리 페이지
│   ├── reports/           # 리포트 페이지
│   ├── settings/          # 시스템 설정 페이지
│   └── api/               # API 라우트
├── components/             # React 컴포넌트
│   ├── auth/              # 인증 컴포넌트
│   ├── dashboard/         # 대시보드 컴포넌트
│   ├── layout/            # 레이아웃 컴포넌트
│   ├── machines/          # 설비 관련 컴포넌트
│   ├── oee/               # OEE 차트 및 메트릭
│   ├── notifications/     # 알림 시스템
│   └── ui/                # 공통 UI 컴포넌트
├── contexts/              # React Context API
│   ├── AuthContext.tsx    # 사용자 인증 상태
│   ├── LanguageContext.tsx # 다국어 지원
│   ├── NotificationContext.tsx # 알림 관리
│   └── SystemSettingsContext.tsx # 시스템 설정
├── hooks/                 # 커스텀 훅
│   ├── useRealtimeData.ts # 실시간 데이터 구독
│   ├── useMachines.ts     # 설비 데이터 관리
│   ├── useSystemSettings.ts # 시스템 설정
│   └── useTranslation.ts  # 다국어 번역
├── lib/                   # 유틸리티 라이브러리
│   ├── supabase.ts        # Supabase 클라이언트
│   ├── supabase-admin.ts  # 서버사이드 클라이언트
│   └── utils.ts           # 공통 유틸리티
├── types/                 # TypeScript 타입 정의
│   ├── index.ts           # 메인 타입 정의
│   ├── auth.ts            # 인증 관련 타입
│   └── database.ts        # 데이터베이스 타입
└── utils/                 # 유틸리티 함수
    ├── oeeCalculator.ts   # OEE 계산 로직
    ├── dateTimeUtils.ts   # 날짜/시간 처리
    └── validation.ts      # 데이터 검증
```

## 🔐 보안 및 권한

### 사용자 역할
- **admin**: 모든 데이터 접근 및 시스템 설정 권한
- **engineer**: 전체 설비 데이터 조회 및 분석 권한
- **operator**: 담당 설비만 접근 가능

### RLS (Row Level Security) 정책
- 역할 기반 데이터 접근 제어
- 실시간 구독에서도 보안 필터링 적용
- 사용자별 데이터 격리 보장

## ⚡ 성능 최적화

### 실시간 데이터 동기화
- **Hybrid 방식**: Supabase Realtime + Polling
- **자동 재연결**: 연결 실패 시 5초 후 재시도
- **Heartbeat**: 30초 간격 연결 상태 확인

### 메모리 관리
- **컴포넌트 언마운트 시 정리**: 메모리 누수 방지
- **데이터 캐싱**: 빈번한 요청 최적화
- **배치 업데이트**: UI 렌더링 성능 향상

## 🐛 문제 해결

### 실시간 연결 문제
```bash
# 연결 상태 확인
# 브라우저 개발자 도구 Console에서
console.log('Realtime Status:', realtimeStatus);
```

### 권한 관련 오류
1. `user_profiles` 테이블에서 사용자 정보 확인
2. RLS 정책이 올바르게 설정되었는지 검증
3. 역할(role)이 정확히 할당되었는지 확인

### 데이터 동기화 문제
1. Supabase 대시보드에서 실시간 구독 상태 확인
2. 네트워크 연결 상태 점검
3. 브라우저 새로고침으로 연결 재설정

## 🚀 배포

### Vercel 배포 (권장)

```bash
# Vercel CLI 설치
npm i -g vercel

# 프로젝트 배포
vercel --prod
```

### 환경 변수 설정 (프로덕션)
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### 배포 후 확인사항
- [ ] Supabase RLS 정책 활성화 확인
- [ ] 실시간 구독 기능 정상 동작 확인
- [ ] 사용자 인증 및 권한 시스템 검증
- [ ] 성능 모니터링 설정

## 📈 모니터링 및 로그

### 실시간 성능 지표
- 활성 사용자 수
- 데이터베이스 연결 상태
- API 응답 시간
- 실시간 구독 채널 상태

### 로그 수집
- 에러 로그: 콘솔 및 Supabase 로그
- 사용자 활동 로그
- 시스템 성능 메트릭

## 🤝 기여하기

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## 📝 라이센스

이 프로젝트는 MIT 라이센스 하에 배포됩니다. 자세한 내용은 `LICENSE` 파일을 참조하세요.

---

**개발자**: ALMUS TECH
**버전**: 1.0.0
**최종 업데이트**: 2025년 9월

