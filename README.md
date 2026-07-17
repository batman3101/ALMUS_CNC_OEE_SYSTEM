# CNC OEE 모니터링 시스템

CNC 설비의 OEE(Overall Equipment Effectiveness)를 실시간으로 모니터링하고 관리하는 웹 애플리케이션입니다.

## 주요 기능

- 🏭 **실시간 설비 모니터링**: CNC 설비 상태 실시간 추적 및 업데이트
- 📊 **OEE 계산 및 분석**: 가동률·성능·품질 지표 자동 계산 및 일일 집계
- ✍️ **교대별 생산 입력**: 주간조/야간조 생산량·불량·비가동 입력과 CAPA 대비 확인
- 🔧 **비가동 독립 기록**: 생산 실적 입력 전에도 비가동을 실시간으로 기록
- 🔔 **스마트 알림 시스템**: 실시간 설비 상태 기반 자동 알림
- 📈 **대시보드 및 리포트**: 역할별(관리자/엔지니어/운영자) 맞춤 대시보드, PDF/Excel 내보내기
- 🌐 **다국어 지원**: 한국어, 베트남어
- 👥 **역할 기반 접근 제어**: RLS 기반 사용자별 데이터 접근 권한 관리
- ⚡ **실시간 동기화**: Supabase Realtime + Polling 하이브리드 방식

## 📐 OEE 계산 규칙 (필독)

이 시스템의 지표를 다루기 전에 반드시 확인해야 하는 정의입니다. 이 규칙을 어기면 전 설비의 수치가 조용히 왜곡됩니다.

```
가동률(Availability) = 실가동시간 / 계획가동시간
성능(Performance)     = 이론가동시간 / 실가동시간
품질(Quality)         = 양품수량 / 생산수량
OEE                   = 가동률 × 성능 × 품질     (내부 값은 모두 0..1)
```

### `tact_time_seconds` 는 **개당(1 piece) 가공시간**입니다

사이클당 시간이 **아닙니다**. JIG 에 2 cavity 가 올라가 한 사이클에 2개가 나오는 설비라면, 그 사실은 이미 개당 t/t 에 반영되어 있습니다 (사이클 1,152초 ÷ 2 cavity = 개당 576초).

```
이론가동시간 = 생산수량 × tact_time_seconds / 60
CAPA        = 계획가동시간 / (tact_time_seconds / 60)
```

### `cavity_count` 는 **참고용**입니다

사이클 수 환산(`생산수량 / cavity`)과 JIG 구성 기록에만 씁니다. **OEE·CAPA 계산에 절대 사용하지 마세요.** 개당 t/t 를 cavity 로 다시 나누거나 곱하면 이중 반영이 되어 성능이 정확히 `1/cavity` 로 왜곡됩니다.

이 계약은 `src/app/api/production-records/__tests__/perPieceTactContract.test.ts` 가 7개 기록 경로 전체에 대해 강제합니다.

### 비가동 입력이 없으면 = 비가동 없음

현장은 비가동이 **발생했을 때만** 기록합니다. "비가동이 없었음"을 별도로 확인하게 요구하지 않습니다. 단, 비가동 **조회 자체가 실패**한 경우(`measuredMinutes === null`)는 0 으로 단정하지 않고 `NULL`(미보고)을 유지합니다 — "0건 조회됨"과 "조회 못함"은 다른 종류의 모름입니다.

### OEE 가 NULL 인 기록을 0% 로 표시하지 마세요

`NULL` 은 "계산 불가"이지 "0%"가 아닙니다. 뭉개면 정상 가동 중인 설비가 완전 정지처럼 보입니다. 지표 타입은 `number | null` 로 두어 구분이 살아있게 하세요.

### 단위와 교대

- 시간 필드(`planned_runtime`, `actual_runtime`, `ideal_runtime`)는 **분**, tact time 은 **초**
- 기본 교대: A조 `08:00–20:00`, B조 `20:00–08:00`. **B조는 자정을 넘습니다** — 날짜 범위·일 집계·타임존 변경 시 양쪽을 모두 검증하세요.
- 계획가동시간 = `max(0, 가동시간 − 휴식시간)`. 휴식시간은 `system_settings(category='shift')` 설정값입니다.

## 기술 스택

### 🖥️ Frontend
- **Next.js 16** (App Router, 빌드/개발 모두 `--webpack`)
- **React 19**
- **TypeScript 5** (strict, `@/*` → `src/*`)
- **Ant Design 5** - UI 컴포넌트
- **Chart.js 4** + **Recharts 3** - 데이터 시각화
- **Tailwind CSS 4** + CSS Modules

### 🗄️ Backend & Database
- **Supabase** (PostgreSQL) — Realtime, RLS, Auth, Edge Functions
- **마이그레이션 24종**, Edge Function `daily-oee-aggregation`

### 🔧 상태 관리 & 유틸
- **React Context API** + 기능별 Custom Hooks
- **zod** - 스키마 검증 | **date-fns** - 날짜/시간 | **react-i18next** - i18n
- **xlsx** / **jsPDF** - Excel·PDF 내보내기

## 🚀 시작하기

```bash
git clone [repository-url]
cd "CNC OEE"
npm install
cp .env.example .env.local   # Supabase 키 설정
npm run dev                  # http://localhost:3000
```

`.env.local` 에 필요한 값:

```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key   # 서버 전용, 클라이언트에 노출 금지
```

환경변수는 `src/lib/env-validation.ts` 의 zod 스키마로 검증됩니다.

### 명령어

```bash
npm run dev          # 개발 서버
npm run dev:clean    # .next 캐시 삭제 후 개발 서버
npm run build        # 프로덕션 빌드
npm run lint         # ESLint
npm test             # Jest (59개 스위트)
npm test -- --runInBand
npx tsc --noEmit     # 타입 체크
```

> ⚠️ `next.config.js` 가 프로덕션 빌드에서 ESLint·TypeScript 오류를 무시합니다. **`npm run build` 성공만으로 정적 검증 통과로 판단하지 마세요.** `npm run lint` 와 `npx tsc --noEmit` 을 별도로 확인해야 합니다.

> ⚠️ `dev:clean` 과 `clean` 은 `rm -rf` 를 사용합니다.

## 📁 프로젝트 구조

```
src/
├── app/                      # Next.js App Router
│   ├── dashboard/            # 역할별 대시보드
│   ├── machines/             # 설비 관리 (+ bulk-upload)
│   ├── data-input/           # 교대별 생산 데이터 입력
│   ├── production-records/   # 생산 기록 조회·수정·삭제
│   ├── model-info/           # 제품 모델 / 공정(tact·cavity) 관리
│   ├── analytics/            # 심화 분석
│   ├── reports/              # 리포트 생성·내보내기
│   ├── settings/             # 시스템 설정
│   ├── admin/                # 관리자 전용
│   ├── login/
│   └── api/                  # API Route Handlers
├── components/               # 기능 도메인별 컴포넌트
│   ├── admin/  auth/  common/  dashboard/  data-input/  layout/
│   ├── machines/  model-info/  notifications/  oee/  production/
│   └── providers/  quality/  reports/  settings/  theme/
├── contexts/                 # Auth, Language, Notification,
│                             # SystemSettings, DateRange, UserPreferences
├── hooks/                    # 데이터 조회·Realtime·교대/OEE/설정 로직
├── lib/                      # supabase, supabase-admin, apiAuth, authFetch,
│                             # plannedRuntime, env-validation, i18n, logger …
├── types/                    # 도메인 타입 + Supabase 생성 타입
└── utils/                    # oeeCalculator, oeeAggregation, shiftUtils,
                              # downtimeIntervals, weightedOee, reportUtils …

public/locales/{ko,vi}/       # 네임스페이스별 번역 JSON
supabase/migrations/          # 순차 적용 PostgreSQL 변경 이력 (24종)
supabase/functions/           # daily-oee-aggregation (Deno Edge Function)
docs/                         # OEE 집계 등 운영·아키텍처 문서
```

## 🔐 보안 및 권한

### 사용자 역할
- **admin**: 모든 데이터 접근 및 시스템 설정 권한
- **engineer**: 전체 설비 데이터 조회 및 분석 (읽기 전용)
- **operator**: `assigned_machines` 에 배정된 설비만 접근

### 지켜야 할 경계
- 브라우저 코드는 `src/lib/supabase.ts` 의 **anon-key 클라이언트**만 사용하며 RLS 를 전제로 합니다.
- `src/lib/supabase-admin.ts` 와 `SUPABASE_SERVICE_ROLE_KEY` 는 **서버 전용**입니다. API Route Handler 밖에서 import 하지 마세요. Service Role 은 RLS 를 우회하므로, 이를 쓰는 API 는 요청자의 세션과 역할을 **Route Handler 에서 명시적으로 검증**해야 합니다 (`src/lib/apiAuth.ts`).
- `src/proxy.ts` 는 개발 캐시 헤더만 설정하며 **인증을 강제하지 않습니다.** UI 의 `ProtectedRoute`/`RoleGuard` 만으로 API 가 보호된다고 가정하지 마세요.

## 🗄️ 데이터베이스 작업 시 주의

### PostgREST 가 큰 쿼리를 조용히 자릅니다

PostgREST 는 `max-rows` 상한(이 프로젝트 **100,000**)을 강제합니다. `.limit()` 없는 `select()` 가 그보다 많은 행에 매칭되면 **200 응답에 경고 없이 정확히 100,000 행만** 반환합니다. 응답은 완전해 보입니다.

1. **범위가 열린 쿼리 위에서 Node 로 집계하지 마세요.** 집계는 SQL 에서 하세요 (`supabase/migrations/` 의 `analytics_*` RPC).
2. **원본 행을 반환한다면 명시적으로 페이지네이션**하고 `total`/`has_more` 를 노출해 경계가 *보이게* 하세요. 보이지 않는 상한은 정확성 버그이고, 보이는 상한은 그냥 페이지입니다.

### 마이그레이션

- 새 타임스탬프 마이그레이션으로 추가하고, 이미 적용된 것은 다시 쓰지 않습니다.
- `supabase/migrations/` 는 전체 초기 스키마가 아니라 **일부 변경 이력만** 포함합니다. 저장소만 보고 운영 스키마 전체를 추정하지 마세요.
- ⚠️ **`supabase db push` 를 사용하지 마세요.** 적용 기록의 `version` 값이 저장소 파일명 타임스탬프와 불일치해 이미 적용된 마이그레이션을 재적용하려 시도합니다. 대시보드 SQL Editor 또는 `apply_migration` 을 쓰세요.

### 스냅샷 보존

`production_records` 는 `tact_time_seconds`·`cavity_count`·`ideal_runtime`·`performance`·`oee` 를 **저장 시점 스냅샷**으로 보관합니다. 공정이 바뀌어도 과거 교대의 OEE 가 오늘 조건으로 덮이지 않게 하기 위함입니다.

이 때문에 **계산 로직을 고쳐도 기존 행은 바뀌지 않습니다.** 과거 데이터에 반영하려면 별도 재계산이 필요합니다.

## ⚡ 성능 및 메모리

- **실시간 동기화**: Supabase Realtime + Polling. 실패 시 5초 후 재연결, 30초 heartbeat.
- **정리**: Realtime 구독·타이머·이벤트 리스너는 `useEffect` cleanup 에서 해제. Context 는 `isMountedRef` 로 언마운트 후 setState 방지, `AbortController` 로 대기 요청 취소.
- **OEE 캐싱**: 5분 (`OEECache.clear()` 로 초기화)

## 🧪 테스트

- Jest + Testing Library, 설정 `jest.config.js` / `jest.setup.js`
- 단위 테스트가 닿지 않는 route 파일(계산 함수를 export 하지 않음)은 **소스 계약 테스트**로 고정합니다. 예: `perPieceTactContract.test.ts`, `processCompletenessContract.test.ts`
- **불변 속성을 검증하세요.** "저장된 값 == 재계산한 값" 같은 자기일관성 검사는 양쪽이 똑같이 틀려도 통과합니다. cavity 이중 반영 버그가 정확히 이 방식으로 감사를 통과했습니다. 올바른 형태는 "cavity 가 1/2/4 어느 값이든 결과가 같아야 한다" 같은 불변 조건입니다.
- **불변 조건을 고정하는 테스트는 변이 테스트로 검증하세요.** 버그를 일부러 되살려 실패하는지 확인하지 않은 테스트는 아무것도 지키지 않을 수 있습니다.

변경 범위별 최소 확인:

| 변경 | 필수 확인 |
|---|---|
| 일반 TS/React | `npm run lint`, 영향 파일 타입 에러 |
| OEE·교대·날짜 util | 경계값: 0, 음수, 100% 초과, 자정 교차 |
| API Route | 인증/역할과 400·401·403·404·409·500 경로 |
| Supabase query/migration | query shape, RLS 영향, rollback 절차 |
| Realtime hook | subscribe/unsubscribe, 재연결, polling fallback |
| UI/i18n | ko/vi 양쪽, 역할별 렌더링, loading/error/empty |

## 🌐 국제화

- 사용자에게 보이는 문구는 하드코딩하지 말고 적절한 i18n 네임스페이스를 사용합니다.
- 번역 키는 `public/locales/ko/` 와 `public/locales/vi/` 에 **동시에**, 동일한 키 구조로 추가합니다.
- 새 네임스페이스를 만들면 `src/lib/i18n.ts` 의 import·`resources`·`ns` 와 필요 시 `src/hooks/useTranslation.ts` 도 갱신합니다.

## 🚀 배포

Vercel 자동 배포(`main` 푸시 시). 수동 배포:

```bash
npm i -g vercel
vercel --prod
```

프로덕션 환경변수: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`

### 배포 후 확인
- [ ] RLS 정책 활성화 확인
- [ ] 실시간 구독 정상 동작
- [ ] 역할별(admin/engineer/operator) 인증·권한 검증
- [ ] 대시보드 OEE 수치가 정상 범위인지 확인 (실제 화면에서)

## 🐛 문제 해결

**전 설비 OEE 가 일정한 비율로 낮게 나온다** — 성능이 `1/cavity`(48.8% 또는 24.5%) 근처에 몰려 있다면 cavity 이중 반영을 의심하세요. 위 [OEE 계산 규칙](#-oee-계산-규칙-필독) 참고.

**OEE 가 0.0% 로 표시된다** — 실제 값이 `NULL`(계산 불가)인데 0 으로 뭉개진 것일 수 있습니다. DB 에서 `oee IS NULL` 을 직접 확인하세요.

**로직을 고쳤는데 과거 데이터가 안 바뀐다** — 정상입니다. `production_records` 는 저장 시점 스냅샷을 보관합니다. 재계산이 필요합니다.

**권한 오류** — `user_profiles` 의 role/assigned_machines 확인 → RLS 정책 검증 → Route Handler 의 세션 검증 확인

## 🤝 기여하기

1. Fork → feature 브랜치 생성
2. 변경 후 `npm run lint` + `npx tsc --noEmit` + `npm test` 통과 확인
3. 문서나 주석이 구현과 달라졌다면 같은 변경에서 갱신
4. Pull Request

## 📝 라이센스

MIT. 자세한 내용은 `LICENSE` 참조.

---

**개발자**: ALMUS TECH
**버전**: 1.0.0
