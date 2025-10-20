# Vercel 배포 가이드 - CNC OEE 모니터링 시스템

## 📋 배포 전 체크리스트

### ✅ 완료된 사항
- [x] Mock 데이터 완전 제거
- [x] 실제 Supabase 연동 확인
- [x] 프로덕션 빌드 성공 (`npm run build`)
- [x] TypeScript 타입 검증 완료
- [x] 모든 API 라우트 실제 데이터 기반으로 변경

### 🔧 배포 전 필수 준비사항

#### 1. 환경 변수 확인
현재 `.env.local` 파일의 변수들을 Vercel에 설정해야 합니다:

```env
# Supabase 설정
NEXT_PUBLIC_SUPABASE_URL=https://wmtkkefsorrdlzprhlpr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# 시스템 설정
SYSTEM_TIMEZONE=Asia/Seoul
DEFAULT_LANGUAGE=ko
ENABLE_DEBUG_LOGGING=false

# 보안 설정
NEXTAUTH_URL=https://your-domain.vercel.app
NEXTAUTH_SECRET=your-random-secret-key
```

## 🚀 Vercel 배포 단계별 가이드

### 1단계: Vercel 계정 및 프로젝트 설정

#### 1.1 Vercel CLI 설치 및 로그인
```bash
# Vercel CLI 설치
npm install -g vercel

# Vercel 로그인
vercel login
```

#### 1.2 프로젝트 초기 설정
```bash
# 프로젝트 루트에서 실행
cd "C:\WORK\app_management\CNC OEE\cnc-oee-monitoring"

# Vercel 프로젝트 초기화
vercel
```

### 2단계: 환경 변수 설정

#### 2.1 Vercel 대시보드에서 설정
1. [Vercel Dashboard](https://vercel.com/dashboard) 접속
2. 프로젝트 선택 → Settings → Environment Variables
3. 다음 환경 변수들을 **Production**, **Preview**, **Development** 모두에 추가:

```env
NEXT_PUBLIC_SUPABASE_URL=https://wmtkkefsorrdlzprhlpr.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SUPABASE_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
SYSTEM_TIMEZONE=Asia/Seoul
DEFAULT_LANGUAGE=ko
ENABLE_DEBUG_LOGGING=false
```

#### 2.2 CLI로 환경 변수 설정 (선택사항)
```bash
# 각 환경별로 변수 설정
vercel env add NEXT_PUBLIC_SUPABASE_URL production
vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
```

### 3단계: 빌드 설정 최적화

#### 3.1 `next.config.js` 확인 및 수정
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  // 프로덕션 최적화
  compress: true,
  poweredByHeader: false,

  // 이미지 최적화
  images: {
    domains: ['wmtkkefsorrdlzprhlpr.supabase.co'],
  },

  // 실험적 기능
  experimental: {
    serverComponentsExternalPackages: ['@supabase/supabase-js']
  },

  // 환경 변수 검증
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }
};

module.exports = nextConfig;
```

#### 3.2 `vercel.json` 생성 (루트 디렉토리)
```json
{
  "buildCommand": "npm run build",
  "framework": "nextjs",
  "regions": ["icn1", "hnd1"],
  "functions": {
    "app/api/**/*.ts": {
      "maxDuration": 30
    }
  },
  "headers": [
    {
      "source": "/api/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "s-maxage=0, stale-while-revalidate"
        }
      ]
    }
  ]
}
```

### 4단계: 배포 실행

#### 4.1 프로덕션 배포
```bash
# 프로덕션 배포
vercel --prod

# 또는 자동 배포 (Git push 시)
git add .
git commit -m "Ready for production deployment"
git push origin main
```

#### 4.2 미리보기 배포 (선택사항)
```bash
# 미리보기 배포
vercel

# 특정 브랜치 배포
vercel --target preview
```

## 🔒 보안 설정

### 1. CORS 설정 확인
Supabase Dashboard에서 배포된 도메인을 허용 목록에 추가:
1. Supabase Dashboard → Authentication → URL Configuration
2. Site URL: `https://your-app.vercel.app`
3. Redirect URLs: `https://your-app.vercel.app/auth/callback`

### 2. RLS (Row Level Security) 정책 재확인
배포 후 모든 RLS 정책이 올바르게 작동하는지 확인

### 3. API 보안 헤더
```typescript
// middleware.ts 또는 API 라우트에서
export function middleware(request: NextRequest) {
  const response = NextResponse.next()

  // 보안 헤더 추가
  response.headers.set('X-Frame-Options', 'DENY')
  response.headers.set('X-Content-Type-Options', 'nosniff')
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')

  return response
}
```

## 📊 성능 최적화

### 1. 캐싱 전략
```typescript
// API 라우트에서 적절한 캐시 헤더 설정
export async function GET() {
  return NextResponse.json(data, {
    headers: {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=86400'
    }
  })
}
```

### 2. 이미지 최적화
```typescript
// next/image 사용 확인
import Image from 'next/image'

<Image
  src="/machine-image.jpg"
  alt="CNC Machine"
  width={300}
  height={200}
  priority={true}
/>
```

## 🔍 배포 후 검증 사항

### 1. 기능 테스트 체크리스트
- [ ] 사용자 로그인/로그아웃
- [ ] 대시보드 데이터 로딩
- [ ] 실시간 데이터 업데이트
- [ ] 설비 목록 조회
- [ ] OEE 계산 및 차트 표시
- [ ] 생산 기록 입력/수정
- [ ] 보고서 생성 및 다운로드
- [ ] 관리자 기능 (사용자 관리, 설정)
- [ ] 다국어 지원 (한국어/베트남어)
- [ ] 모바일 반응형 동작

### 2. 성능 테스트
- [ ] Lighthouse 스코어 90+ 목표
- [ ] First Contentful Paint < 2초
- [ ] API 응답 시간 < 1초
- [ ] 실시간 연결 안정성

### 3. 보안 테스트
- [ ] 권한별 접근 제어 확인
- [ ] RLS 정책 동작 확인
- [ ] HTTPS 강제 적용
- [ ] 민감한 정보 노출 없음

## 🚨 문제 해결 가이드

### 일반적인 배포 오류

#### 1. 빌드 오류
```bash
# 로컬에서 빌드 재테스트
npm run build

# 타입 오류 확인
npm run type-check

# 린트 오류 확인
npm run lint
```

#### 2. 환경 변수 오류
```bash
# Vercel에서 환경 변수 확인
vercel env ls

# 환경 변수 다시 설정
vercel env rm VARIABLE_NAME
vercel env add VARIABLE_NAME
```

#### 3. Supabase 연결 오류
- Supabase URL과 키가 정확한지 확인
- CORS 설정이 올바른지 확인
- RLS 정책이 활성화되어 있는지 확인

#### 4. API 라우트 오류
```typescript
// API 라우트에서 에러 로깅 추가
export async function GET() {
  try {
    // 실제 로직
  } catch (error) {
    console.error('API Error:', error)
    return NextResponse.json(
      { error: 'Internal Server Error' },
      { status: 500 }
    )
  }
}
```

## 📱 모니터링 설정

### 1. Vercel Analytics 활성화
```bash
# Vercel Analytics 설치
npm install @vercel/analytics

# _app.tsx 또는 layout.tsx에 추가
import { Analytics } from '@vercel/analytics/react'

export default function RootLayout({ children }) {
  return (
    <html>
      <body>
        {children}
        <Analytics />
      </body>
    </html>
  )
}
```

### 2. 로그 모니터링
Vercel Dashboard → Functions 탭에서 API 함수 로그 확인

### 3. 에러 추적
- Vercel Dashboard에서 에러 로그 모니터링
- 필요시 Sentry 등 외부 에러 추적 도구 연동

## 🔄 CI/CD 설정

### GitHub Actions (선택사항)
```yaml
# .github/workflows/vercel.yml
name: Vercel Production Deployment
env:
  VERCEL_ORG_ID: ${{ secrets.VERCEL_ORG_ID }}
  VERCEL_PROJECT_ID: ${{ secrets.VERCEL_PROJECT_ID }}
on:
  push:
    branches:
      - main
jobs:
  Deploy-Production:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Install Vercel CLI
        run: npm install --global vercel@latest
      - name: Pull Vercel Environment Information
        run: vercel pull --yes --environment=production --token=${{ secrets.VERCEL_TOKEN }}
      - name: Build Project Artifacts
        run: vercel build --prod --token=${{ secrets.VERCEL_TOKEN }}
      - name: Deploy Project Artifacts to Vercel
        run: vercel deploy --prebuilt --prod --token=${{ secrets.VERCEL_TOKEN }}
```

## 📞 지원 및 문의

### Vercel 공식 문서
- [Vercel Next.js 배포 가이드](https://vercel.com/guides/deploying-nextjs-with-vercel)
- [환경 변수 설정](https://vercel.com/docs/concepts/projects/environment-variables)
- [도메인 연결](https://vercel.com/docs/concepts/projects/domains)

### 긴급 문제 발생 시
1. Vercel Dashboard에서 이전 배포로 롤백
2. 로컬에서 문제 수정 후 재배포
3. Supabase 연결 상태 확인

---

**배포 완료 후 이 문서를 참고하여 모든 기능이 정상 동작하는지 확인하시기 바랍니다.**

**작성일**: 2025년 9월 14일
**버전**: 1.0
**작성자**: Claude (CNC OEE 시스템 배포 가이드)