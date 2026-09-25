# CNC OEE 멀티팩토리 브랜치 병합 전 최종 감사

## 1. 최종 판정

**BLOCK / REQUEST CHANGES**

현재 브랜치 `claude/multi-factory-alt-alv-20260821`의 감사 기준 커밋
`a528db40725ed1f5c06b090f700cb19ff4519005`는
`main@704c6257e2856778762965d55ce1893447e4479c`에 병합하면 안 된다.

이 판정은 단순한 테스트 공백 때문이 아니다. 다음 문제가 코드와 SQL에서 직접 확인됐다.

- 운영 DB에 멀티팩토리 스키마가 없는 상태에서 `main` 병합 시 새 앱이 자동 배포된다.
- 설비 생성·삭제 API가 공장 경계를 우회한다.
- `audit_log.factory_id NOT NULL` 적용 후 기존 운영 함수가 트랜잭션째 실패한다.
- 사용자 관리가 새 공장별 권한 모델이 아닌 전역 `user_profiles` 모델에 남아 있다.
- migration 순서가 문서에 정의된 무중단 cutover 순서와 충돌한다.
- 일부 migration은 운영 데이터 변형과 가짜 상태 행을 발생시킨다.

독립 코드 리뷰어는 `REQUEST CHANGES`, 아키텍처 리뷰어와 최종 검증자는 `BLOCK`으로
판정했다.

## 2. 감사 범위

| 항목 | 값 |
| --- | --- |
| 감사 일자 | 2026-08-24, Asia/Bangkok |
| 기준 브랜치 | `claude/multi-factory-alt-alv-20260821` |
| 기준 HEAD | `a528db40725ed1f5c06b090f700cb19ff4519005` |
| 비교 기준 | `origin/main@704c6257e2856778762965d55ce1893447e4479c` |
| ahead commits | 11 |
| 변경 규모 | 123 files, +8,810 / -522 |
| 주요 범위 | Next.js API, 인증·권한, Realtime, 설정, Supabase schema/RLS/RPC/migration |
| 작업 방식 | 코드·DB·배포 상태 읽기 전용 감사 |

코드, 테스트, migration, 운영 Supabase schema와 migration ledger, Vercel production 상태를
교차 확인했다. 운영 DB write, migration 적용, 코드 수정, 배포는 수행하지 않았다.

### 감사 이후 발견된 작업트리 변경

보고서 저장 및 검증 중 감사 기준 HEAD 이후의 다음 작업트리 변경이 확인됐다.

```text
M  src/app/api/__tests__/rolePolicy.test.ts
M  src/app/api/machines/__tests__/route.test.ts
M  src/app/api/machines/route.ts
M  supabase/migrations/20260824210000_multi_factory_derive_on_insert.sql
?? supabase/migrations/20260824220000_multi_factory_audit_log_factory.sql
```

기존 미추적 도구 디렉터리도 남아 있다.

```text
?? .bkit/
?? .serena/
```

위 변경은 감사 기준 HEAD에 포함되지 않았고 최종 판정이 끝난 뒤 작업트리에 나타났다.
내용을 수정하거나 검증하지 않았으며, 본 보고서는 위 변경이 아래 결함을 해결한다고 가정하지
않는다. 해당 변경을 포함한 새 commit이 만들어지면 변경된 artifact 전체를 다시 감사해야 한다.

이 보고서 파일만 본 요청에서 새로 작성했다.

## 3. 운영 상태 확인

### 3.1 Vercel

- Production 프로젝트: `almus-cnc-oee-system`
- 현재 production 상태: `READY`
- 현재 production commit: `704c6257e2856778762965d55ce1893447e4479c`
- 현재 production commit은 `origin/main`과 일치한다.
- `README.md:210-216`은 `main` push 시 Vercel 자동 배포를 명시한다.
- 최근 24시간 production runtime error는 확인되지 않았다.

즉, 현재 `main`은 정상 운영 중이며 브랜치 병합은 단순 코드 저장이 아니라 운영 앱 교체로
이어진다.

### 3.2 Supabase

- Project ref: `wmtkkefsorrdlzprhlpr`
- 상태: `ACTIVE_HEALTHY`
- PostgreSQL: `17.6.1.141`
- 최신 적용 migration:
  `20260806055947_add_alert_critical_thresholds`
- `factories`, `factory_memberships`, `user_factory_selection` 테이블: 없음
- public schema의 `factory_id` 컬럼: 0개
- 브랜치의 멀티팩토리 migration: 운영에 미적용

최근 24시간 운영 write:

| 테이블 | 건수 |
| --- | ---: |
| `production_records` | 2,328 |
| `production_progress_reports` | 1,241 |
| `machine_logs` | 319 |

주요 현재 행 수:

| 테이블 | 행 수 |
| --- | ---: |
| `machines` | 800 |
| `production_records` | 55,782 |
| `production_shift_states` | 64,777 |
| `production_progress_reports` | 17,833 |
| `machine_logs` | 5,867 |
| `downtime_entries` | 6,108 |
| `system_settings` | 47 |
| `system_settings_audit` | 910 |
| `audit_log` | 118 |

운영 DB는 실사용 중이며 migration 중간 상태가 외부 사용자에게 노출될 수 있는 환경이다.

## 4. 병합 차단 Findings

### F-01. CRITICAL — 운영 DB와 자동 배포 앱의 즉시 호환 실패

#### 근거

- `README.md:212`: `main` push 시 Vercel 자동 배포
- `src/lib/factoryAuth.ts:83-95`: 요청 중 `user_factory_selection` 조회
- `src/lib/factoryAuth.ts:220-251`: `user_profiles`, `factory_memberships`와 공장 선택 조회
- `src/lib/factoryAuth.ts:90-94`: 선택 조회 오류를 403으로 종료
- 운영 DB에는 위 멀티팩토리 테이블과 `factory_id` 컬럼이 없음

#### 실패 경로

1. 현재 브랜치를 `main`에 병합한다.
2. Vercel이 새 앱을 production에 자동 배포한다.
3. 새 앱이 아직 존재하지 않는 `user_factory_selection` 또는 `factory_memberships`를 조회한다.
4. factory-aware API가 403 또는 PostgREST schema 오류를 반환한다.
5. 이후 `.eq('factory_id', ...)` query와 새 RPC도 존재하지 않는 컬럼·함수 때문에 실패한다.

#### 영향

로그인은 성공해도 설비, 생산, OEE, 설정 등 주요 API가 광범위하게 실패할 수 있다.
현재 운영 DB에 대한 앱 선배포는 허용할 수 없다.

### F-02. CRITICAL — 설비 POST/DELETE가 공장 경계를 우회

#### 근거

- `src/app/api/machines/route.ts:229-231`:
  POST가 `requireFactoryUser`가 아닌 `requireUser` 사용
- `src/app/api/machines/route.ts:286-291`:
  중복 검사가 `.eq('name', name)`만 사용
- `src/app/api/machines/route.ts:303-316`:
  INSERT에 `factory_id` 없음
- `src/app/api/machines/route.ts:374-376`:
  DELETE도 `requireUser` 사용
- `src/app/api/machines/route.ts:393-401`:
  Service Role UPDATE가 machine ID만 제한하고 `factory_id` 조건 없음
- `supabase/migrations/20260821140000_multi_factory_contract.sql:49-52`:
  `machines.factory_id NOT NULL`

#### 영향

- contract 이후 정상 설비 생성이 NOT NULL 위반으로 500 실패한다.
- ALT와 ALV에서 같은 설비명을 독립적으로 사용할 수 없다.
- 다른 공장의 machine UUID를 아는 engineer/admin이 해당 설비를 비활성화할 수 있다.
- Service Role은 RLS를 우회하므로 DB 정책이 이 누락을 막지 못한다.

### F-03. CRITICAL — `audit_log.factory_id NOT NULL`로 운영 함수 실패

#### 근거

- `supabase/migrations/20260821140000_multi_factory_contract.sql:49-62`:
  `audit_log.factory_id SET NOT NULL`
- `supabase/migrations/00000000000001_baseline_functions.sql:66-82`:
  `audit_role_change`가 `factory_id` 없이 INSERT
- `supabase/migrations/20260729060000_machine_row_lock_on_read.sql:167-180`:
  `correct_open_downtime_reason`이 `factory_id` 없이 INSERT
- `supabase/migrations/20260804130000_close_shift_below_progress_reason.sql:146-158`:
  `close_shift_upsert_v3`가 `factory_id` 없이 INSERT
- `supabase/migrations/20260824210000_multi_factory_derive_on_insert.sql:49-55`:
  `audit_log`를 보정 대상에서 의도적으로 제외

마지막 migration의 주석은 `audit_role_change`가 유일한 audit writer라고 전제하지만 실제로는
적어도 위 세 함수가 존재한다.

#### 영향

contract 적용 후 다음 작업에서 `23502` NOT NULL 위반이 발생하고 함수 전체가 rollback된다.

- 사용자 역할 변경
- 진행 중 비가동 사유 정정
- 보고된 진행 수량보다 낮은 수량으로 교대 마감

### F-04. CRITICAL — 사용자 관리가 전역 권한 모델에 잔존

#### 근거

- `src/lib/apiAuth.ts:42-88,119-139`:
  `requireUserManager`와 계정 역할 검사가 `user_profiles.role` 기반
- `src/app/api/admin/users/route.ts:12-47`:
  전체 `user_profiles`와 Auth 사용자 조회
- `src/app/api/admin/users/route.ts:60-111`:
  신규 사용자 생성 시 `factory_memberships`, `user_machine_assignments` 미생성
- `src/app/api/admin/users/[userId]/route.ts:69-78`:
  수정도 전역 `role`, `assigned_machines`만 갱신
- `src/contexts/AuthContext.tsx:173-183`:
  UI 역할도 전역 profile에서 공급
- `src/contexts/FactoryContext.tsx:83-90`:
  현재 공장의 role을 context state에 저장하지 않음
- `docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.md:293-303,405`:
  최종 권한 원천을 membership/assignment로 전환하도록 명시

#### 영향

- 신규 사용자는 UI에서 생성 성공 후에도 membership이 없어 factory-aware API에서 403이
  발생한다.
- 기존 사용자 역할·담당 설비 변경이 새 권한 테이블에 반영되지 않는다.
- 공장 관리자가 다른 공장의 사용자 이메일·역할을 조회하거나 계정을 수정·삭제할 수 있다.
- 삭제 과정에서 양 공장의 작업 이력 사용자 귀속이 함께 제거될 수 있다.

### F-05. HIGH — 실제 migration 순서가 승인된 cutover 순서와 충돌

#### 문서상 요구 순서

`docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.md:274-312`는 다음 순서를 요구한다.

```text
운영 expand/backfill
  -> ALT factory-aware app/RLS cutover
  -> NOT NULL 및 legacy 제거 contract
  -> ALV 생성과 제한 공개
```

구버전 앱 write가 계속되면 임시 ALT stamp trigger 또는 maintenance window를 선택하도록
명시한다.

#### 실제 migration 순서

```text
20260821130000  ALT backfill
20260821140000  NOT NULL contract
20260821150000  일부 trigger scope 보정
20260821160000  RLS cutover
20260824110000  ALV 및 memberships
20260824210000  12개 write의 factory_id derive trigger
```

`20260824110000_multi_factory_alv_and_memberships.sql:8-13`은 H7 전에는 운영에 적용하지
말라고 적혀 있지만 일반 timestamp migration 경로에 들어 있으며, 실제 membership 생성도
이 migration에 의존한다.

#### 영향

- backfill 중 구버전 앱이 NULL `factory_id` 행을 추가하면 contract가 실패한다.
- contract가 먼저 성공하면 마지막 derive trigger가 적용될 때까지 구버전 앱 write가 실패한다.
- RLS cutover 후 membership 생성 전에는 직접 RLS 조회가 deny-all 상태가 된다.
- migration별 `BEGIN/COMMIT` 때문에 이러한 중간 상태가 운영 사용자에게 노출된다.

### F-06. HIGH — migration self-test가 가짜 운영 상태를 남김

#### 근거

- `supabase/migrations/20260824210000_multi_factory_derive_on_insert.sql:147-155`:
  임의 설비에 `1900-01-01`, A교대 production record를 INSERT 후 DELETE
- `supabase/migrations/20260821150000_multi_factory_trigger_scope.sql:48-57`:
  INSERT는 shift state를 `WORKING`, DELETE는 `MISSING`으로 upsert

production record만 삭제하고 생성된 `production_shift_states`는 삭제하지 않는다.

#### 영향

migration 적용 시 임의 설비에 `1900-01-01 / A / MISSING` 상태 행이 운영 데이터로
영구 커밋된다.

### F-07. HIGH — backfill이 운영 audit/CAS 메타데이터를 변경

#### 근거

`20260821130000_multi_factory_alt_backfill.sql:55-115`는 다음 운영 테이블을 대량 UPDATE한다.

- `product_models`
- `model_processes`
- `machines`
- `downtime_entries`
- `production_records`
- `production_shift_states`
- `production_progress_reports`

운영 trigger 확인 결과 UPDATE 시 `updated_at`이 현재 시간으로 변경되며,
`production_records` UPDATE는 `production_shift_states`를 upsert하고 `version`을 증가시킨다.

현재 데이터에서는 최대 다음 범위가 영향받는다.

- model 32건
- process 56건
- machine 800건
- downtime 6,108건
- production record 55,782건
- 대응 shift-state 55,782건

#### 영향

업무 값이 동일하더라도 변경 시각과 CAS version이 변해 실제 사용자 수정처럼 보일 수 있다.
문서가 요구하는 PK/count/canonical checksum parity만으로 이 side effect를 탐지할 수 없고,
현재 V1 parity 실행 증거도 없다.

### F-08. HIGH — 활성 운영 DB에 대한 lock 및 timeout 위험 미검증

#### 근거

- `20260821110000_multi_factory_expand_columns.sql:131-154`:
  다수 인덱스를 `CONCURRENTLY` 없이 하나의 transaction에서 생성
- `20260821130000_multi_factory_alt_backfill.sql:55-128`:
  핵심 테이블 일괄 UPDATE
- `20260821140000_multi_factory_contract.sql:49-97`:
  14개 NOT NULL 변경과 FK validation
- 명시적 `lock_timeout`, batch backfill, 사전 validated check 또는 production-clone
  rehearsal 증거 없음

#### 영향

운영 write가 계속되는 상태에서 lock 대기, API timeout, transaction rollback 가능성을
정량적으로 배제할 수 없다.

### F-09. HIGH — baseline과 migration ledger가 안전한 운영 적용 경로를 제공하지 않음

#### 근거

- `npm run check:migrations` 실패
- 로컬 80개 중 적용 57, intentional skip 1, 미적용 22, drift 0
- 미적용 22개에는 baseline 3개와 멀티팩토리 migration 19개가 함께 포함
- `README.md:168-172`와 `scripts/check-migrations.mjs:3-8`은 `supabase db push`를 금지
- `00000000000000_baseline_schema.sql:26-28`은 운영 적용 금지와 migration repair를 명시
- 같은 파일 `:385-386`은 모든 public table/sequence에 대해
  `anon`, `authenticated`, `service_role`에 `GRANT ALL`
- `00000000000001_baseline_functions.sql`은 과거 함수 정의를 `CREATE OR REPLACE`

#### 영향

- baseline을 적용하면 기존 권한 hardening과 최신 함수 정의를 되돌릴 수 있다.
- baseline을 적용하지 않으면 현재 migration ledger 검사가 계속 실패한다.
- 브랜치에는 운영 적용 대상을 안전하게 분리하고 각 Human Gate를 증명한 실행 artifact가 없다.

### F-10. MEDIUM — 자동 테스트가 HTTP method 누락을 탐지하지 못함

#### 근거

- `src/app/api/__tests__/factoryScopedRoutes.test.ts:154-171`:
  Route 파일 단위로 `requireFactoryUser`와 `.eq('factory_id', ...)` 존재 여부를 수집
- 같은 파일 `:184-204`:
  method별이 아닌 파일 전체 판정
- `src/app/api/__tests__/rolePolicy.test.ts:174-188`:
  `requireUser`도 정상 guard로 인정

`/api/machines`의 GET에는 올바른 factory auth/filter가 있으므로 같은 파일의 잘못된
POST/DELETE가 가려진다. 관련 테스트와 전체 Jest가 통과했지만 F-02를 탐지하지 못했다.

## 5. 검증 결과

| 검증 | 결과 | 비고 |
| --- | --- | --- |
| `npm run lint` | PASS | 오류 0, 경고 19 |
| `npx tsc --noEmit --incremental false` | PASS | build 완료 후 단독 재실행 |
| `npm test -- --runInBand` | PASS | 147 suites, 1,195 tests |
| `npm run build` | PASS | Next.js production build |
| `npm run check:grants` | PASS | anon 도달 public table/non-volatile RPC 없음 |
| `npm run check:migrations` | **FAIL** | 미적용 22개 |
| `git diff --check origin/main...HEAD` | PASS | whitespace 오류 없음 |
| 운영 Supabase schema/ledger | **FAIL** | 멀티팩토리 schema 전체 미적용 |
| Vercel production | PASS | 현재 `main@704c6257` READY |
| 실제 JWT CRUD matrix | 미실행 | 운영 write 금지 범위 |
| Production-clone migration rehearsal | 미실행 | 사용 가능한 HEAD clone 없음 |
| 브라우저 ALT/ALV × 3 role × ko/vi | 미실행 | ALV 운영 schema/data 없음 |
| V1-V9 동일 artifact 검증 | **미충족** | 문서상 READY 조건 미달 |

### 의존성 감사 참고

`npm audit --omit=dev`는 다음 취약점을 보고했다.

- `nanoid`: high 1건
- `dompurify`: moderate 1건

`package.json`과 `package-lock.json`은 이 브랜치에서 `origin/main` 대비 변경되지 않았으므로
이번 멀티팩토리 브랜치가 새로 유입한 회귀로 분류하지 않았다.

## 6. 독립 리뷰 종합

| 검토 lane | 판정 | 핵심 근거 |
| --- | --- | --- |
| Code reviewer | `REQUEST CHANGES` | machines POST/DELETE IDOR, 전역 사용자 관리, 배포 순서 부재 |
| Architect | `BLOCK` | 운영 DB 즉시 비호환, audit writer 실패, migration 순서·lock 위험 |
| Verifier | `BLOCK`, confidence 0.99 | 상위 6개 blocker 독립 재검증 |

세 검토 lane 모두 자동 테스트 통과가 병합 가능성을 증명하지 못한다고 판단했다.

## 7. 결론

현재 감사 기준 HEAD는 다음 두 조건을 동시에 만족하지 못한다.

1. 현재 운영 ALT 앱과 DB를 중단 없이 유지할 수 있어야 한다.
2. ALT와 ALV 사이의 DB/API/RPC/RLS/사용자 관리 경계를 실제로 강제해야 한다.

따라서 현재 상태로 `main` 병합 및 운영 배포를 금지한다. 이 판정은 `WATCH`가 아니라
명확한 `BLOCK / REQUEST CHANGES`다.

본 문서는 점검 결과만 기록한다. 코드 수정, SQL 수정, migration 적용 또는 배포 작업은
포함하지 않는다.
