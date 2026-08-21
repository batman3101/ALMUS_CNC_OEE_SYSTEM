# GRAPH_ALT_ALV_MULTI_FACTORY

## 0. 문서 목적

이 문서는 현재 ALT(ALMUS TECH) 단일 공장용 CNC OEE 앱을 **하나의 Supabase 프로젝트 + `factory_id` 논리 멀티테넌시** 구조로 전환하고 ALV(ALMUS VINA)를 추가하기 위한 실행 계약이다.

동반 파일 `GRAPH_ALT_ALV_MULTI_FACTORY.json`과 함께 Codex/Claude Code의 구현 프롬프트 및 재개 가능한 작업 그래프로 사용한다.

H2 구현 권한이 부여된 그래프 실행의 기본 중지점은 로컬 또는 격리 staging 검증 완료(`LOCAL`)다. H2 승인이 없으면 비성공 terminal `PLAN_ONLY`에서 멈춘다. 운영 DB migration, 운영 Auth/Storage 변경, Edge Function 배포, 애플리케이션 배포, ALV 사용자·도메인 공개, legacy 제거는 각각 명시적인 사람 승인 전에는 실행하지 않는다.

## 1. 동결된 아키텍처 결정

선택지는 하나뿐이다.

- Supabase 프로젝트는 ALT와 ALV가 공유한다.
- 모든 공장 소유 데이터는 직접 `factory_id`를 가진다.
- 최종 보안 경계는 Host, UI 필터 또는 클라이언트 상태가 아니라 PostgreSQL 제약조건과 RLS다.
- 사용자의 공장별 역할은 `factory_memberships(factory_id, user_id, role)`에서 관리한다.
- 일반 사용자는 자신에게 허용된 공장만 사용한다. 다중 공장 접근과 Global Admin은 별도 명시적 권한 없이는 허용하지 않는다.
- `admin`과 `engineer`도 해당 공장 내부 권한일 뿐 다른 공장의 데이터를 볼 수 없다.
- 요청 body/query/header가 전달한 `factory_id`는 권위 있는 값이 아니다. 서버가 Host와 인증된 membership으로 공장을 확정한다.
- 기존 ALT 관리자를 자동으로 Global Admin으로 승격하지 않는다.
- ALV 데이터가 생성된 뒤에는 공장 범위가 없는 구버전 앱/RLS/RPC로 롤백하지 않는다.
- `NULL factory_id = ALT` 같은 영구 호환 규칙은 금지한다.

### 기본 사용자 정책

- 1차 출시에서 일반 사용자는 하나의 active membership만 가진다.
- 다중 membership 스키마는 중앙 지원 인력 같은 승인된 예외만 수용한다.
- active membership이 0개면 403, 1개면 해당 공장으로 진입한다.
- 2개 이상이면 승인된 공장 선택 UX가 없을 경우 구성 오류로 fail-closed 한다.
- Global Admin이 필요하면 `global_admins`에 별도로 등록하고 모든 행위를 감사한다. 일반 운영 API에서는 Global Admin도 하나의 대상 공장을 선택해야 한다.

## 2. 목표 결과와 성공 조건

### 목표 결과

- `alt.<domain>` 사용자는 ALT 데이터·설정·Realtime·리포트만 사용한다.
- `alv.<domain>` 사용자는 ALV 데이터·설정·Realtime·리포트만 사용한다.
- ALT와 ALV는 같은 설비명, 모델명, 날짜, 교대 값을 독립적으로 사용할 수 있다.
- 기존 ALT의 PK, 행 수, 핵심 값, 설정, OEE/리포트 결과는 backfill 전후 동일하다.
- API, RPC, View, Realtime, Storage, 설정 cache/topic, Edge Function 어디에도 공장 우회 경로가 없다.

### 완료 판정

다음이 모두 충족되어야 한다.

1. 공장 소유 테이블 인벤토리 100%가 `factory_id` 적용 또는 명시적 글로벌 분류를 받았다.
2. 기존 ALT 행의 `factory_id`가 모두 ALT이며 NULL, orphan, cross-factory FK가 0건이다.
3. RLS, Service Role API, SECURITY DEFINER RPC/View 인벤토리의 무범위 경로가 0건이다.
4. 실제 ALT/ALV JWT와 실제 Realtime client를 사용한 교차 공장 negative test가 모두 통과한다.
5. 설정 저장뿐 아니라 실제 behavioral consumer까지 공장별로 다르게 동작한다.
6. 일일 OEE, 분석, 리포트, Storage가 공장 기준으로 격리되고 멱등성을 가진다.
7. ALT/ALV × admin/engineer/operator × ko/vi의 12개 브라우저 조합이 통과한다.
8. 9개 검증 레인이 같은 artifact version에서 9/9 통과하고 fresh-context verifier가 승인한다.

## 3. 현재 저장소에서 확인할 출발점

아래는 구현 시작 전에 다시 확인할 현재 위험 표면이다. 운영 DB 스키마와 배포 상태는 시점에 따라 달라질 수 있으므로 저장소만으로 추정하지 않는다.

| 표면 | 현재 위험 | 우선 확인 위치 |
|---|---|---|
| 사용자/인가 | 인증 결과에 공장 컨텍스트가 없고 역할이 전역으로 해석될 수 있다 | `src/lib/apiAuth.ts`, `src/contexts/AuthContext.tsx`, `src/types/` |
| 사용자 관리 | 관리자 API가 프로젝트 전체 사용자와 설비를 다룰 수 있다 | `src/app/api/admin/users/`, `src/app/api/admin/machines/` |
| 설비/생산 | 사실 테이블이 machine ID만으로 연결되어 교차 공장 참조를 막지 못한다 | `src/app/api/machines/`, `src/types/database.types.ts`, `supabase/migrations/` |
| Service Role | 서버 API가 RLS를 우회하므로 모든 HTTP method/action에 별도 공장 인가가 필요하다 | `src/app/api/**/route.ts`, `src/lib/supabase-admin.ts` |
| RPC/View | SECURITY DEFINER 또는 service-role RPC는 RLS 변경만으로 보호되지 않는다 | `supabase/migrations/`, `src/app/api/analytics/` |
| 설정 | 전역 조회, singleton cache, 공용 Realtime topic이 공장 값을 섞을 수 있다 | `src/lib/systemSettings.ts`, `src/contexts/SystemSettingsContext.tsx` |
| Realtime | 초기 snapshot 또는 subscription 한쪽만 무범위여도 데이터가 섞인다 | `src/hooks/useRealtime*.ts`, `src/contexts/NotificationContext.tsx` |
| 브랜딩 | ALT 문자열/로고 fallback이 ALV 화면에 노출될 수 있다 | `src/app/login/`, `src/components/layout/Sidebar.tsx`, `src/hooks/useSystemSettings.ts` |
| OEE/리포트 | 전역 timezone과 날짜만으로 집계하면 같은 날짜의 양 공장이 충돌한다 | `supabase/functions/daily-oee-aggregation/`, 집계·리포트 API/RPC |
| Proxy/Host | Proxy는 공장 해석에 도움을 줄 수 있지만 최종 인가 계층은 아니다 | `src/proxy.ts`, Next.js 16 로컬 문서 |

구현 전 반드시 다음 ledger를 생성한다.

- 모든 DB table/view/function/trigger/policy/grant와 factory ownership 분류
- 모든 API Route의 HTTP method/action, 인증, 역할, 공장 scope, Service Role 사용 여부
- 모든 RPC/View의 invoker/definer, grant, 입력 공장, 내부 query scope
- 모든 Realtime channel의 snapshot query, filter, cleanup, cache key
- 모든 설정 key의 저장소, cache, provider, behavioral consumer, reset/import/export 경로
- 모든 Storage bucket/path/policy와 DB 참조
- 모든 Edge Function/cron/schedule의 공장 입력, timezone, lock, retry, 결과 fan-in

## 4. 목표 데이터 모델

### 4.1 글로벌 테이블

다음만 글로벌로 허용한다.

- `auth.users`
- `user_profiles`: 이름, 이메일, 개인 언어/테마 등 전역 신원 정보
- `factories(id, code, name, timezone, default_language, is_active, ...)`
- `factory_domains(factory_id, hostname, is_primary, is_active)`
- 선택적 `global_admins(user_id, is_active, granted_by, expires_at, ...)`
- 완전 불변·읽기 전용인 공용 코드 카탈로그

기존 `user_profiles.role`, `assigned_machines`는 전환 기간에만 호환하며 최종 권한 원천이 아니다.

글로벌 소유는 전 사용자 공개를 뜻하지 않는다. `user_profiles`는 기본적으로 본인만 읽고 수정하며, 공장 관리자의 사용자 목록은 같은 factory membership으로 제한된 서버 API를 통해서만 제공한다. `auth.admin.listUsers()` 결과를 그대로 반환하지 않는다.

### 4.2 공장 소유 테이블

다음과 저장소 인벤토리에서 발견되는 모든 공장 도메인 테이블은 `factory_id NOT NULL`을 최종 상태로 가진다.

- `factory_memberships(factory_id, user_id, role, is_active)`
- `user_machine_assignments(factory_id, user_id, machine_id, is_active)`
- `product_models`, `model_processes`, `machines`
- `machine_logs`, `machine_status_history`, `downtime_entries`
- `production_records`, `production_shift_states`, `production_progress_reports`
- `alert_acknowledgements`
- `system_settings`, `system_settings_audit`
- OEE/분석 집계 결과와 집계 실행 로그
- 공장별 audit/history/derived view

수정 가능한 상태 설명·분류·템플릿은 공장 소유로 본다. 글로벌로 남길 항목은 H1에서 불변 카탈로그임을 증명해야 한다.

### 4.3 관계 무결성

- 모든 child row는 부모에서 파생 가능한 경우에도 `factory_id`를 직접 가진다.
- 모든 parent는 필요한 `(factory_id, id)` UNIQUE를 가진다.
- child FK는 `(factory_id, parent_id) -> parent(factory_id, id)` 형태로 만든다.
- 설비·모델·공정 이름의 유일성은 전역이 아니라 공장 범위다. 예: `UNIQUE(factory_id, name)`.
- 설정은 `UNIQUE(factory_id, category, setting_key)`다.
- membership은 `PRIMARY KEY(factory_id, user_id)`다.
- assignment는 membership과 machine 양쪽에 복합 FK를 가진다.
- trigger/RPC는 공장을 parent에서 파생하고 요청이 전달한 factory 값은 일치 검증에만 사용한다.
- orphan은 근거 없이 ALT로 귀속하지 않고 quarantine/report 후 사람 결정으로 보상한다.

## 5. 공장 해석과 권한 경계

### 5.1 서버 공장 해석

`resolveFactory(request)`는 다음 순서로 동작한다.

1. 신뢰할 수 있는 proxy 규칙으로 정규화한 hostname을 얻는다.
2. allowlist 또는 `factory_domains`에서 active factory를 찾는다.
3. 알 수 없거나 비활성인 host는 fail-closed 한다.
4. 인증 사용자의 active membership 또는 명시적 Global Admin 권한을 검증한다.
5. body/query/header에 factory 값이 있으면 해석 결과와 일치하는지만 확인한다.

권장 서버 계약:

```ts
requireFactoryUser(request, allowedRoles)
  -> { userId, factoryId, factoryCode, role, assignedMachineIds, isGlobalAdmin }
```

Provider 의존 순서는 다음을 목표로 한다.

```text
AuthProvider
-> FactoryProvider
-> SystemSettingsProvider
-> LanguageProvider
-> DateRangeProvider
-> NotificationProvider
-> ToastNotificationProvider
-> ThemeProvider
-> AntdConfigProvider
```

로그아웃 또는 공장 전환 시 이전 공장의 channel, cache, snapshot, pending request와 optimistic state를 먼저 제거한다.

### 5.2 RLS helper와 정책

권장 helper:

```sql
current_user_is_active()
is_global_admin()
has_factory_membership(p_factory_id uuid)
has_factory_role(p_factory_id uuid, p_roles text[])
has_machine_access(p_factory_id uuid, p_machine_id uuid)
```

필수 규칙:

- helper는 `STABLE`, `SECURITY DEFINER`, 고정 `search_path`를 사용한다.
- `PUBLIC`과 `anon` 실행 권한을 제거하고 최소 role에만 grant한다.
- 비활성 user/profile/factory/membership은 항상 false다.
- RLS는 row의 `factory_id`와 membership을 직접 비교한다.
- operator는 membership과 machine assignment를 모두 만족해야 한다.
- Global Admin 우회는 `is_global_admin()`만 허용하며 감사한다.
- 기존 permissive 정책과 새 정책이 OR로 합쳐지지 않도록 정책 교체를 같은 transaction에서 수행한다.
- `EXISTS`/InitPlan과 factory 선두 index를 사용하고 `EXPLAIN ANALYZE`로 성능을 검증한다.

### 5.3 Service Role API

- 모든 운영 Route의 모든 HTTP method/action은 `requireFactoryUser` 또는 승인된 명시적 예외를 사용한다.
- 모든 Service Role query에 `.eq('factory_id', factoryId)`를 적용한다.
- ID 조회는 `(factory_id, id)`로 수행하여 IDOR을 막는다.
- 서버가 `factory_id`를 stamp하며 body 값은 신뢰하지 않는다.
- admin/engineer도 현재 factory를 넘지 않는다.
- operator assignment를 정규화 테이블에서 검증한다.
- bulk import/update/delete는 모든 참조가 한 공장인지 먼저 확인하고 원자적으로 처리한다.
- unscoped 예외는 auth bootstrap과 분리된 `/api/global/*` allowlist만 허용하며 read-only, 최소 응답, audit를 적용한다.

### 5.4 RPC와 View

- 모든 SECURITY DEFINER 함수 내부의 SELECT/INSERT/UPDATE/DELETE에 factory 조건을 명시한다.
- machine 기반 write RPC는 machine row를 잠근 뒤 그 row에서 factory를 파생한다.
- 함수 내부에서 active membership, role, assignment를 다시 검증한다.
- advisory lock과 idempotency key에 factory를 포함한다.
- 분석 RPC는 `p_factory_id`를 필수로 받고 호출 권한을 검증한다.
- View는 가능하면 `security_invoker=true`, 결과에 `factory_id`를 포함하고 join도 factory를 함께 비교한다.
- `PUBLIC EXECUTE`를 제거하고 old unscoped signature/grant를 contract 단계에서 폐기한다.

## 6. 설정, Realtime, Storage, OEE 계약

### 6.1 설정

- 모든 조회, update, reset, import/export, snapshot/restore, audit가 factory-scoped다.
- cache key는 `${factoryId}:${category}:${settingKey}`다.
- Realtime topic은 `factory:${factoryId}:settings`다.
- reset은 한 factory에서 atomic하게 현재 row의 `default_value`로 복원하고 변경 전후 값과 actor/reason을 감사한다.
- 로그인 전 branding은 host로 해석한 최소 공개 factory metadata만 사용한다.
- 설정 조회 실패 시 ALT 이름·로고로 조용히 fallback하지 않는다.
- 각 설정 테스트는 “저장됨”에서 끝내지 않고 실제 교대/OEE/알림/브랜딩 consumer 결과까지 확인한다.

### 6.2 Realtime

- 초기 snapshot과 subscription은 같은 `factory_id` 조건을 사용한다.
- Postgres Changes filter와 RLS를 함께 적용한다.
- channel/topic 이름에 factory ID를 포함한다.
- broadcast payload는 재조회 신호로만 취급하고 factory-scoped DB를 다시 읽는다.
- INSERT/UPDATE/DELETE 모두에서 교차 공장 event 0건을 실제 client로 증명한다.
- DELETE payload/replica identity 제약 때문에 client filter가 불완전할 경우 factory별 private broadcast 또는 재조회 설계로 보상한다.
- subscribe/unsubscribe와 재연결 시 중복 channel이 없어야 한다.

### 6.3 Storage

- object path는 `factories/{factoryCode}/{assetType}/{uuid}.{ext}`를 사용한다.
- DB metadata에 `factory_id`를 저장한다.
- Storage RLS는 membership/role을 검사한다.
- 전체 public listing을 금지하고 로그인용 공개 asset은 factory별 read-only prefix로 제한한다.
- 기존 ALT asset은 checksum 검증 후 ALT prefix로 copy하고 참조를 갱신한다.
- 안정화와 별도 승인 전에는 원본을 삭제하지 않는다.

### 6.4 일일 OEE, 분석, 리포트

- 모든 입력과 query는 factory + business date를 사용한다.
- timezone과 교대/휴식 설정은 대상 factory에서만 읽는다.
- lock/idempotency/log unique key에 factory, date, job type을 포함한다.
- cron dispatcher는 active factory를 fan-out하고 한 factory 실패가 다른 factory 결과를 rollback하지 않게 한다.
- fan-in은 expected active factory 수와 실제 결과 수가 같을 때만 완료한다.
- dry-run은 어떤 UPDATE도 수행하지 않는다.
- 같은 날짜·설비명·모델명이 ALT/ALV에 있어도 집계와 리포트가 섞이지 않아야 한다.

## 7. Expand -> Backfill -> Cutover -> Contract

### P0. 발견과 설계 동결

- 저장소와 운영 배포 상태를 읽기 전용으로 inventory한다.
- ALT/ALV code, hostname, timezone, 기본 언어를 확정한다.
- 다중 membership/Global Admin 명단과 공장별 역할을 확정한다.
- 모든 table/settings/storage/Edge surface의 글로벌 또는 공장 소유 분류를 확정한다.
- 무중단 임시 ALT stamp trigger와 maintenance window 중 하나를 선택한다.

Human Gate H1: 데이터·권한·cutover 모델 승인.

### P1. 로컬/격리 staging 구현

1. regression fixture와 tenant-leak negative test를 먼저 작성한다.
2. `factories`, domains, memberships, assignments, 선택적 global admins를 추가한다.
3. 공장 소유 테이블에 nullable `factory_id`, index, composite unique, `NOT VALID` FK를 추가한다.
4. ALT row를 만들고 부모 관계 순서로 기존 데이터를 backfill한다.
5. source/target count, PK, canonical checksum, null/orphan/cross-FK를 비교한다.
6. auth/factory context와 server authorization을 전환한다.
7. API/RPC/View, UI/settings/i18n, Realtime/OEE/report/Edge/Storage를 병렬 구현한다.
8. 9개 검증 레인과 fresh-context verifier를 통과한다.

Human Gate H2: 로컬/격리 staging 구현 승인. 승인 없으면 문서와 계획만 남기고 비성공 terminal인 `PLAN_ONLY`에서 멈춘다. `LOCAL`은 구현과 V1~V9 검증을 통과한 경우에만 사용할 수 있다.

### P2. 운영 Expand + ALT Backfill

- 실제 schema/policy/grant/schedule snapshot과 백업/복원 가능성을 확인한다.
- nullable column과 새 테이블을 먼저 배포한다.
- 기존 앱 write가 계속된다면 임시 ALT stamp trigger와 사용량 logging을 둔다. 영구 default는 사용하지 않는다.
- 모든 기존 ALT row를 근거 있는 부모 관계로 backfill한다.
- backfill 후 정확한 parity와 무결성을 승인받는다.

Human Gate H4: 운영 expand migration과 ALT backfill 승인.

### P3. Factory-aware App/RLS Cutover

- ALT만 활성화한 상태로 factory-aware app/API/RPC/Realtime/settings/OEE를 배포한다.
- 기존 permissive RLS를 같은 transaction에서 제거하고 factory-aware 정책으로 교체한다.
- ALT role별 canary, IDOR, Realtime, 설정 consumer, OEE 결과와 성능을 확인한다.
- cutover 실패 시 강한 공장 격리를 약화하지 않는 검증된 ALT-only 정책 또는 forward fix를 사용한다.

Human Gate H5: 운영 앱/RLS/RPC/Edge cutover 승인.

### P4. Contract와 Security Cleanup

- `factory_id NOT NULL`, composite FK validate, scoped uniqueness를 최종 적용한다.
- 임시 ALT trigger/default, dual write, shadow read를 제거한다.
- old unscoped RPC signature/policy/grant와 구버전 배포 가능성을 제거한다.
- 애플리케이션이 `user_profiles.role`, `assigned_machines`를 권한 원천으로 읽지 못하게 한다.
- 이 contract가 통과하기 전에는 ALV 데이터나 사용자를 만들지 않는다.
- 비보안 legacy column의 물리 삭제는 안정화 이후 별도 승인으로 수행한다.
- factory onboarding, Global Admin audit, 복구 runbook을 확정한다.

Human Gate H6: contract migration과 unscoped legacy access 제거 승인.

### P5. ALV 생성과 제한 공개

- ALV factory/domain/settings/membership/master/machine을 생성한다.
- ALT와 같은 이름·날짜 fixture로 교차 공장 negative test를 실행한다.
- 제한 사용자·설비로 ALV canary를 실행한다.
- 실패하면 ALV domain/membership/schedule을 비활성화하고 factory-aware 앱과 RLS는 유지한다.

Human Gate H7: ALV 운영 데이터 생성과 제한 공개 승인.

## 8. 검증 계약

고정 fixture:

- ALT와 ALV
- 각 공장의 admin, engineer, operator
- membership 없음, 비활성 membership, 비활성 factory 사용자
- 두 공장에 동일한 machine/model/date/shift와 서로 다른 생산값
- 서로 다른 timezone, shift break, OEE/브랜딩/알림 설정

### 9개 검증 레인

| ID | 검증 레인 | 필수 증거 |
|---|---|---|
| V1 | Schema/Backfill | table ledger 100%, ALT PK/count/checksum parity, NULL/orphan/cross-FK 0 |
| V2 | RLS/PostgREST | 실제 ALT/ALV JWT CRUD matrix, inactive/no-membership deny, permissive bypass 0 |
| V3 | Service Role API | method/action ledger 100%, server stamp, IDOR/bulk cross-factory deny |
| V4 | RPC/View | function/view ledger 100%, internal scope, grant/search_path/lock 확인 |
| V5 | Realtime | 실제 client의 snapshot + INSERT/UPDATE/DELETE 격리, cleanup/재연결 확인 |
| V6 | Settings/Storage | cache/topic/reset/import/export/audit와 실제 consumer 격리, object 정책 확인 |
| V7 | OEE/Report/Edge | factory timezone, B교대 자정, 멱등성, dry-run, fan-out/fan-in 격리 |
| V8 | Browser/i18n | ALT/ALV × 3 role × ko/vi, host mismatch, loading/error/empty/mobile 확인 |
| V9 | Migration/Performance/Rollback | migration drift, EXPLAIN, lock, old-app block, 보상 절차 rehearsal |

V1~V9는 같은 commit/migration/artifact version을 검증해야 한다. 하나라도 실패하면 artifact version을 올린 뒤 9개 레인을 모두 다시 실행한다. 선택적 부분 재검증 결과로 final verifier에 직행하지 않는다.

ALV 운영 공개 후에는 같은 9개 범주를 `PV1`~`PV9`로 다시 fan-out한다. `PJ`가 현재 production artifact version의 입력 9개를 정확히 받은 경우에만 `PV` fresh-context production verifier로 진행하며, 문구상 체크리스트만으로 `DONE`에 도달할 수 없다.

일반 코드 검증은 최소한 다음을 포함한다.

```powershell
npm run lint
npx tsc --noEmit --incremental false
npm test -- --runInBand
npm run build
```

실제 Supabase, Auth, Storage, Realtime, 브라우저 E2E를 실행할 수 없으면 통과로 간주하지 않고 정확한 미검증 항목과 재개 노드를 남긴다.

## 9. 실패와 복구 원칙

- cross-factory leak, unscoped privileged path, ALT parity 손상, rollback 불가 중 하나라도 발견되면 즉시 공개를 중단한다.
- expand/backfill 이후에는 additive schema를 남기고 앱만 롤백할 수 있다. backfill을 파괴적으로 되돌리지 않는다.
- ALV 데이터 생성 뒤 old unscoped app/RLS로 rollback하지 않는다.
- ALV 장애 시 ALV domain, membership, schedule을 비활성화하고 ALT와 factory-aware RLS를 유지한다.
- 잘못된 factory binding은 해당 domain과 write를 차단하고 audit 후 보상한다.
- Storage 원본은 checksum과 안정화 승인 전 삭제하지 않는다.
- 복구 migration도 새 forward migration으로 작성한다. 이미 적용된 migration을 수정하지 않는다.

## 10. 실행 그래프 요약

```text
S
├─ D1 repo inventory ─┐
├─ D2 deployed read-only inventory ─┼─ J0(3/3) -> A0 -> H1
└─ D3 product/operations decisions ─┘                 |
                                                       v
                  P1 schema ───────────────┐
                  P2 auth/RLS/API/RPC ─────┤
H1 -> A1 fan-out -> P3 settings/RT/Edge ───┼─ J1(5/5) -> H2
                  P4 migration/recovery ───┤                |
                  P5 UI/host/i18n ─────────┘                v
                              T0 -> I1 -> I2 -> I3/I4/I5 -> J2
                                                               |
                           V1..V9 <----------- FIX <--- FAIL ---+
                              |                                  |
                           J3(9/9) -> fresh verifier -> PASS -> READY
                                                               |
                                                              H3
                                                 no -> LOCAL   | yes
                                                              PR0
                                 H4 -> PR1 -> CV1 -> H5 -> PR2 -> CV2
                                                              |
                                 H6 -> PR3 contract -> CANARY -> OK -> H7 -> PR4 ALV
                                                                                |
                                                                     PV1..PV9 -> PJ(9/9) -> PV -> DONE
```

정규화된 node/edge, join count, human gate, compensation, retry 조건은 동반 JSON을 따른다.

## 11. Codex/Claude Code용 복사 프롬프트

```text
@docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.md
@docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.json

위 두 파일을 단일 실행 계약으로 사용해 현재 CNC OEE 앱을 하나의 Supabase 프로젝트에서 `factory_id` 기반 논리 멀티테넌시로 전환하고 ALV를 추가하라.

절대 조건:
1. 별도 Supabase 프로젝트 또는 공장별 독립 배포 대안을 다시 검토하지 말고, 단일 Supabase + factory_id 경로만 실행한다.
2. Host는 공장 선택자일 뿐 보안 경계가 아니다. DB composite FK + RLS, Service Role API, SECURITY DEFINER RPC/View가 각각 공장 격리를 증명해야 한다.
3. `user_profiles`의 기존 전역 role/assigned_machines를 최종 권한 원천으로 사용하지 말고 `factory_memberships`와 `user_machine_assignments`로 전환한다.
4. 기존 ALT 관리자를 자동 Global Admin으로 승격하지 않는다. body/query/header의 factory_id를 신뢰하지 않는다.
5. 구현 전에 repo와 실제 배포 상태를 읽기 전용으로 inventory하여 table/view/function/policy/grant/API method/action/Realtime/settings/Storage/Edge ledger를 완성한다.
6. 테스트 fixture와 cross-factory negative test를 먼저 작성하고, ALT의 PK/count/checksum/settings/OEE/report 기준선을 보존한다.
7. 모든 공장 소유 row에 직접 factory_id를 두고 composite FK와 factory-scoped unique를 적용한다. orphan을 임의로 ALT에 귀속하지 않는다.
8. 설정은 저장 여부만 확인하지 말고 실제 교대/OEE/알림/브랜딩 consumer까지 검증한다.
9. V1~V9가 현재 artifact version 하나에서 9/9 통과한 뒤 fresh-context verifier 승인을 받아야 한다. 실패 후에는 version을 올리고 9개 전체를 재실행한다. ALV 운영 공개 후에도 PV1~PV9와 PJ 9/9, 별도 production verifier를 통과한다.
10. 운영 DB migration, 앱/RLS/RPC/Edge 배포, NOT NULL/unscoped legacy 제거, ALV 데이터/사용자/도메인 공개는 각각 그래프의 Human Gate 승인 없이는 실행하지 않는다. Contract는 ALV 활성화보다 먼저 완료한다.
11. H2 구현 승인이 없으면 비성공 terminal `PLAN_ONLY`에서 멈춘다. 구현과 V1~V9는 통과했으나 운영 승인이 없으면 `LOCAL`에서 멈춘다. 실제 Supabase/Realtime/브라우저 검증을 실행하지 못했으면 미검증으로 명시하고 통과라고 쓰지 않는다.
12. ALV 데이터 생성 뒤 unscoped 구버전 앱/RLS/RPC로 rollback하지 않는다.
13. 기존 dirty worktree와 사용자 변경을 보존하고 이 작업 범위 밖 파일을 되돌리거나 정리하지 않는다.

실행 방식:
- JSON의 start_node부터 edge 조건, expected_inputs, human_gate, retry, compensation을 그대로 따른다.
- 각 node 완료 시 completion_evidence를 저장하고 현재 artifact version과 다음 재개 node를 기록한다.
- 독립 node는 병렬화하고, join은 expected input 수가 정확히 일치할 때만 통과한다.
- high_risk node는 대응 human gate evidence가 없으면 실행하지 않는다.
- 구현/리뷰는 분리하고 final verdict는 fresh context verifier가 수행한다.
- 각 단계에서 실제 코드와 운영 상태가 문서와 다르면 실제 증거를 우선하되, 단일 Supabase + factory_id 결정과 보안 불변조건을 약화하지 말고 문서와 ledger를 함께 갱신한다.

먼저 D1, D2, D3을 수행하고 J0의 3/3 증거를 제시하라. H1 승인이 이미 명시되어 있지 않다면 설계 결정표와 발견된 blocker만 보고하고 운영 변경 없이 멈춰라.
```

## 12. 이번 문서 작성의 변경 범위

이 문서 작성은 계획 산출물만 변경한다. 애플리케이션 코드, migration, 운영 Supabase, Auth 사용자, Storage object, Edge Function, DNS, 배포 상태는 변경하지 않는다.
