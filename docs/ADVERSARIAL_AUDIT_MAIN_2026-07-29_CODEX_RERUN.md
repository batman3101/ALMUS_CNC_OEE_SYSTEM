# `main` 브랜치 적대적 재감사 보고서

- 감사일: 2026-07-29
- 기준 브랜치: `origin/main`
- 기준 커밋: `4511aaa0e250a4f4235857580fefab76ecc3d9f3`
- 기준 커밋 제목: `Merge pull request #34 from batman3101/chore/claude-2026-07-29-drop-close-shift-v1`
- 비교 기준: 이전 감사 커밋 `b6b6c0bec6fcbf9940bc88f7a29b20fe0e80065b`
- 검토 범위: 애플리케이션, API, Realtime, Supabase RLS·권한·함수·마이그레이션, Vercel 운영 배포
- 수행 방식: 코드 및 운영 환경 읽기 전용 확인

## 최종 판정

**FAIL — REQUEST CHANGES**

**아키텍처 상태: BLOCK**

현재 `main`은 이전 감사 이후 실질적인 개선이 배포됐지만, 인증하지 않은 사용자가 접근할 수 있는 운영 백업 테이블과 RPC/API 일관성 경계를 우회하는 `downtime_entries` 직접 쓰기 권한이 확인됐다. 두 결함 모두 애플리케이션 테스트의 통과 여부와 무관하게 운영 데이터의 기밀성·무결성을 직접 훼손할 수 있다.

| 심각도 | 건수 |
|---|---:|
| CRITICAL | 2 |
| HIGH | 5 |
| MEDIUM | 3 |
| 합계 | 10 |

## 즉시 차단 사유

### 1. CRITICAL — 운영 백업 테이블 4개가 익명 사용자에게 완전히 노출됨

운영 Supabase 카탈로그에서 다음 `public` 테이블은 모두 RLS가 꺼져 있고 정책이 0개다. 동시에 `anon` 역할에 `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER` 권한이 부여돼 있다.

| 테이블 | 행 수 |
|---|---:|
| `model_processes_snapshot_20260716` | 61 |
| `tact_original_from_records_20260716` | 16 |
| `production_records_pre_recalc_20260716` | 3,850 |
| `function_defs_backup_20260717` | 1 |

- 트리거: 인증하지 않은 사용자가 Supabase REST 경로로 해당 테이블에 접근한다.
- 영향: 생산 데이터 스냅샷과 백업 함수 정의의 무단 조회, 변조, 삭제 가능성. ACL 차원의 `TRUNCATE` 권한도 확인됐다.
- 증거 수준: 운영 DB 실측. 행 내용은 읽지 않았고 행 수·스키마·권한만 확인했다.
- 저장소 상태: 해당 테이블 이름을 관리하는 마이그레이션이나 코드가 현재 저장소에서 확인되지 않아 운영 스키마 드리프트로 판단한다.
- 참고: [Supabase Database Linter — RLS disabled in public](https://supabase.com/docs/guides/database/database-linter?lint=0013_rls_disabled_in_public)

### 2. CRITICAL — `downtime_entries` 직접 DML이 권한·CAS·잠금 경계를 우회함

운영 DB에서 `authenticated` 역할은 `downtime_entries`에 `SELECT`, `INSERT`, `UPDATE`, `DELETE` 권한을 가진다. 운영자 정책은 역할과 담당 `machine_id`만 검사하며 다음 불변조건을 강제하지 않는다.

- 기록 소유자와 현재 사용자의 동일성
- 사용자의 `is_active`
- 클라이언트가 제출한 `expected_version`과 현재 버전의 비교
- 설비 advisory lock 참여
- API/RPC를 통한 일관된 감사 경로

API는 다른 운영자의 기록을 거부하고 버전 기반 RPC를 호출하지만, 직접 PostgREST 요청은 이를 우회한다.

- 소유권 검사: `src/app/api/downtime-entries/[id]/route.ts:24-36`
- DELETE 버전 검사와 RPC: `src/app/api/downtime-entries/[id]/route.ts:83-100`
- PATCH 버전 검사와 RPC: `src/app/api/downtime-entries/[id]/route.ts:139-205`
- CAS·잠금 구현: `supabase/migrations/20260715160000_independent_downtime_lifecycle.sql`

트리거는 담당 설비가 있는 인증 운영자가 테이블을 직접 `UPDATE` 또는 `DELETE`하는 경우다. 다른 운영자가 만든 기록이나 과거 비가동 기록을 API 권한, CAS, 공용 잠금 밖에서 변경할 수 있다. 따라서 “RPC가 유일한 쓰기 경계”라는 현재 설계 전제는 운영 DB에서 성립하지 않는다.

## HIGH

### 3. 공개 저장소에 공유 비밀번호 리터럴이 남아 있음

동일한 비밀번호 리터럴이 다음 두 파일에 남아 있다. 실제 값은 본 보고서에 재출력하지 않는다.

- `scripts/create-missing-auth-accounts.js:113`
- `scripts/create-users-via-api.js:51`

저장소는 공개 상태다. `src/__tests__/noHardcodedCredentials.test.ts:27`의 검사는 영문 `password|passwd|pwd` 레이블만 인식하므로 한국어 문장 안의 리터럴을 탐지하지 못한다.

- 영향: 과거 또는 현재 계정에 재사용됐다면 계정 탈취로 이어질 수 있는 자격증명 사고다.
- 검증 경계: 현재 유효성, 사용 계정, 회전 여부, 세션 폐기 여부는 의도적으로 시험하지 않았다.
- 심각도 판단: 노출은 확정이지만 유효한 운영 계정 침해는 입증하지 않았으므로 CRITICAL이 아닌 HIGH로 판정한다.

### 4. 비활성·비정상 역할 사용자가 RLS 직접 접근 권한을 유지할 수 있음

`current_user_role()`과 `current_user_machines()`는 `is_active`를 확인하지 않는다.

- `supabase/migrations/20260729140000_scope_operational_reads.sql:57-76`
- 담당 설비 정책: 같은 파일 `:87-116`

담당 설비 분기는 역할이 반드시 `operator`인지도 명시적으로 제한하지 않는다. API의 `requireUser`는 비활성 계정을 차단하지만 유효한 JWT를 가진 사용자의 직접 PostgREST 접근에는 적용되지 않는다.

운영 DB에는 감사 시점에 활성 프로필 13개, 비활성 프로필 0개, 비정상 역할 0개가 있어 현재 발현은 확인되지 않았다. 그러나 계정 비활성화 후 토큰이 남거나 잘못된 역할 데이터가 생성되면 즉시 권한 우회가 가능하다.

### 5. 진척 입력과 교대 마감이 10분간 겹치며 최종 수량을 잠금 밖에서 읽음

- 진척 입력 허용 종료: `window.end + buffer`
  - `src/utils/shiftReportingWindow.ts:21-32`
- 교대 마감 허용 시작: 정확히 `window.end`
  - `src/app/api/production-records/close-shift/route.ts:48-53`
- 운영 buffer: 10분
- 마감 경로의 최신 수량 조회는 RPC 및 잠금보다 먼저 수행됨
  - `src/app/api/production-records/close-shift/route.ts:35-44`
- `report_shift_progress`는 이미 확정된 생산 레코드의 존재를 거부하지 않음
  - `supabase/migrations/20260729120000_progress_report_inactive_machine_guard.sql:81-94`

재현 순서는 다음과 같다.

1. 마감 요청이 진척 수량 100을 읽는다.
2. 10분 유예 시간 안에 진척 수량 110이 승인된다.
3. 마감 RPC가 뒤늦게 잠금을 얻고 100을 확정 저장한다.

그 결과 append-only 진척 원천은 110이지만 확정 생산 레코드는 100으로 남는다. 생산 레코드가 이미 존재하므로 마감 대기 탐지도 재마감을 요구하지 않는다.

### 6. 마감 원천 digest가 OEE를 바꾸는 비가동 분류를 포함하지 않음

`downtime_window_digest`는 source, ID, 시작, 종료 시각만 해시한다.

- `supabase/migrations/20260729160000_close_shift_source_digest.sql:45-57`

그러나 `reason/state`는 계획·비계획 비가동 분류를 결정하고, 이 분류는 검증된 비가동 시간과 OEE 완결성을 바꾼다.

- 분류 계산: `src/lib/shiftDowntime.ts:46-52`, `:68-75`
- 계획정지·휴식 영향: `src/app/api/production-records/daily/downtimeCalculation.ts:56-68`

트리거는 마감 라우트가 행을 읽은 뒤 RPC digest 검사 전에 reason이 계획정지와 고장수리 사이에서 바뀌는 경우다. 시간값이 같으면 digest도 같아 stale OEE 계산값이 영구 저장될 수 있다. 새 source-CAS 보완은 부분 수정이다.

### 7. v1 마감 함수 제거가 DB 불변조건 테스트와 애플리케이션 롤백을 깨뜨림

- 운영 DB에는 `close_shift_upsert_v2`만 있고 v1은 없다.
- v1 제거: `supabase/migrations/20260729170000_drop_close_shift_upsert_v1.sql:32-34`
- SQL 불변조건 테스트는 아직 v1을 세 차례 호출함:
  - `supabase/tests/shift_write_invariants.sql:74-95`
- 이전 기준 애플리케이션 `b6b6c0...`은 v1을 호출함:
  - `src/app/api/production-records/close-shift/route.ts:72`의 이전 커밋 버전

현재 저장소의 DB 불변조건 스크립트는 운영 스키마에서 실패하며, 애플리케이션만 이전 기준으로 롤백하면 모든 교대 마감 요청이 실패한다. 실제 롤백은 수행하지 않았으므로 현재 장애가 아니라 입증된 호환성 단절로 판정한다.

## MEDIUM

### 8. Realtime에 구독 준비 전 이벤트 유실 창이 남아 있음

구독 설정 호출 직후 snapshot 조회가 시작되며, 실제 준비 완료는 나중의 비동기 `SUBSCRIBED` 콜백에서만 확인된다.

- 구독 설정: `src/hooks/useRealtimeData.ts:406-408`
- snapshot 시작: `src/hooks/useRealtimeData.ts:424-432`
- 준비 확인: `src/hooks/useRealtimeData.ts:601-607`

새 buffer는 전달된 이벤트의 순서를 보존하지만, snapshot 가시성 이후이면서 구독 준비 이전에 커밋된 이벤트는 전달 자체가 되지 않아 보존할 수 없다. 코드 순서로 경합 창은 확인했지만 실제 네트워크 타이밍 재현은 하지 않았다.

### 9. 교대 설정 계약이 여전히 비원자적이고 내부 기본값이 불일치함

- 명시적 `0`이 `||` 때문에 fallback 값으로 바뀜:
  - `src/components/settings/tabs/ShiftSettingsTab.tsx:54-55`
- UI buffer fallback은 15분, 서버 기본값은 10분:
  - `ShiftSettingsTab.tsx:55`
  - `src/lib/shiftConfig.ts:25`
- 네 개 설정을 독립 요청으로 저장해 중간 실패 시 혼합 세대가 남음:
  - `ShiftSettingsTab.tsx:85-96`
- UI는 A/B 시작 시각이 같은 경우만 거부함:
  - `ShiftSettingsTab.tsx:79-82`
- 일부 클라이언트는 저장된 종료 시각을 계속 읽음:
  - `src/hooks/useSystemSettings.ts:71-81`
  - `src/utils/shiftUtils.ts:76-88`

현재 운영값은 A 08:00, B 20:00, 종료 시각 일치, buffer 10분으로 내부 일관성이 있다. 설정 조회 오류의 fail-open은 수정됐지만 zero 처리, 기본값, 원자적 저장, 종료 시각 계약은 미완료다.

### 10. 미래 객체의 기본 ACL 강화가 DB 소유자 전체에 적용되지 않음

마이그레이션은 실행 소유자의 미래 테이블에 대해서만 `anon` 권한을 제거한다.

- `supabase/migrations/20260729150000_revoke_anon_table_grants.sql:55-57`

운영 default ACL 실측 결과:

- `postgres`가 만드는 미래 테이블은 anon 기본 권한이 제거됐지만 authenticated 전체 테이블 권한은 남는다.
- `supabase_admin`이 만드는 미래 테이블은 anon과 authenticated에 전체 DML 및 TRUNCATE가 기본 부여된다.
- 두 소유자 모두 미래 함수의 EXECUTE와 sequence 접근을 anon/authenticated에 기본 부여한다.

이는 재발 위험이며 “향후 테이블도 보호됐다”는 현재 마이그레이션 주석의 범위보다 실제 보호 범위가 좁다.

## 이전 감사 항목 상태

| 항목 | 현재 상태 |
|---|---|
| 요청 본문의 평문 비밀번호 로그 | 코드에서 수정됨 |
| `machine_logs` 직접 쓰기 | 운영 RLS에서 차단됨 |
| 담당 설비 기반 운영 데이터 읽기 | 개선됐으나 비활성·역할 검증은 미완료 |
| Edge Function 관리자·활성 계정 인가 | 배포본에서 확인, ACTIVE v2, `verify_jwt=true` |
| 임의 과거·미래 진척 입력 | 개별 요청 창 검증은 수정됨 |
| 비활성 설비 진척 입력 | 잠금 안에서 차단됨 |
| 마감 원천 신선도 | digest v2가 배포됐으나 분류·진척 경합은 미완료 |
| 설정 조회 오류의 silent fallback | 수정됨 |
| Realtime snapshot 경합 | 전달 이벤트 buffer는 개선, 준비 전 창은 미완료 |
| 교대 종료 시각 계약 | UI 일부 개선, 공유 계약은 미완료 |
| 핵심 테이블의 기존 anon grant | 운영에서 제거됨 |
| 공개 자격증명 | 다른 스크립트의 공유 비밀번호로 계속 열려 있음 |

## 검증 결과

감사 대상 커밋을 별도 clean worktree에 고정해 실행했다.

| 검증 | 결과 |
|---|---|
| `git diff --check` | 통과 |
| `npm run lint` | 통과, 오류 0 / 경고 18 |
| `npx tsc --noEmit --incremental false` | 통과 |
| `npm test -- --runInBand` | 103 suites / 678 tests 통과 |
| `npm run build` | 통과, Next.js 16.2.10, 정적 페이지 34개 생성 |
| `npm run check:migrations` | local 44, applied 43, intentional skip 1, missing 0, drift 0 |

운영 배포 확인:

- Vercel Production은 기준 커밋 `4511aaa0...` 배포가 `READY` 상태다.
- 해당 배포의 최근 24시간 런타임 오류 클러스터는 확인되지 않았다.
- Supabase 프로젝트는 `ACTIVE_HEALTHY` 상태다.
- 최신 6개 보완 마이그레이션은 운영 DB에 적용됐다.
- `daily-oee-aggregation` Edge Function은 ACTIVE v2이며 `verify_jwt=true`다.

검증 통과는 빌드·정적 품질·기존 테스트의 상태를 입증하지만, 본 보고서의 권한 및 동시성 결함을 반증하지 않는다. 현재 테스트에는 익명 백업 테이블 ACL, 직접 `downtime_entries` DML, 마감-진척 교차, 구독 준비 전 이벤트를 검증하는 운영 동등 테스트가 없다.

## 검증하지 않은 항목

읽기 전용 제약과 운영 안전을 위해 다음 행위는 수행하지 않았다.

- 운영 데이터 INSERT, UPDATE, DELETE 또는 TRUNCATE
- 실제 운영자 JWT를 이용한 PostgREST exploit
- 공유 비밀번호의 유효성 검사 또는 로그인 시도
- 실제 애플리케이션·DB 롤백
- 운영 환경의 동시 트랜잭션 경합 재현
- 브라우저 다중 클라이언트 Realtime 타이밍 재현

## 감사 무결성

감사 도중 공유 작업 폴더가 다른 작업에 의해 `fix/claude-2026-07-29-negative-elapsed` 브랜치로 변경되고 `package-lock.json` 수정이 나타났다. 해당 변경은 본 감사에 포함하지 않았다. 모든 소스 증거와 검증은 고정된 `origin/main` 커밋 `4511aaa0...`에서 수집했다.

소스 코드, 설정, 마이그레이션, 운영 데이터는 수정하지 않았다. 본 Markdown 보고서만 새로 생성했다.

## 해제 조건

다음 조건이 충족되기 전에는 현재 `main`의 운영 안전 승인을 보류해야 한다.

1. 익명 접근 가능한 네 개 백업 테이블의 노출과 파괴 권한이 제거되고 운영 카탈로그에서 재검증될 것
2. `downtime_entries` 직접 DML이 제거되거나 API/RPC와 동일한 소유권·활성 계정·CAS·잠금 불변조건이 DB에서 강제될 것
3. 공개된 비밀번호의 회전·세션 폐기·저장소 및 이력 처리 여부가 확인될 것
4. 마감 수량과 모든 OEE 영향 원천이 같은 잠금·트랜잭션·검증 경계에서 확정될 것
5. v2 기준 DB 불변조건 테스트와 롤백 정책이 일치할 것
6. 위 조건을 대상으로 독립적인 재감사를 다시 통과할 것
