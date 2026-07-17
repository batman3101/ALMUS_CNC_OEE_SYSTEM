# 대기 Supabase 마이그레이션 적용 절차 (Runbook)

작성: 2026-07-15 점검. 대상 프로젝트: `CNC_OEE` (`wmtkkefsorrdlzprhlpr`).
라이브 최신 적용 마이그레이션: `20260714103040 codex_round2_fixes`.

이 문서는 **현재 브랜치 코드가 이미 의존**하지만 라이브 DB에 미적용된 마이그레이션의
안전한 적용 순서·사전조건·backfill·스모크 테스트·롤백을 정리한 실행 지침이다.
아직 **적용하지 않았다**. 승인 후 아래 순서대로 수행한다.

---

## 0. 핵심 결정 (먼저 읽기)

1. **적용 방식: `supabase db push` 금지 → MCP `apply_migration` 또는 대시보드 SQL Editor로
   파일 내용을 한 개씩 순서대로 적용한다.**
   - 이유: 라이브 migration 이력의 `version`이 파일명 타임스탬프와 불일치한다.
     예) 파일 `20260714120000_codex_round2_fixes.sql` ↔ 기록된 version `20260714103040`,
     파일 `20260714040000_role_based_rls.sql` ↔ 기록 `20260714033143` 등 다수.
     `db push`는 파일명 기준으로 미적용을 판정하므로, 이미 적용된 마이그레이션을
     **다시 적용하려다 충돌**한다. 파일 내용을 직접 실행하는 방식은 이 문제를 피한다.

2. **적용 순서 (6개 중 `120000`은 건너뜀):**

   | 순서 | 파일 | 적용 | 비고 |
   |---|---|---|---|
   | 1 | `20260715080500_long_range_oee_aggregation` | ✅ 필수 | 170000의 **선행 조건** (아래 3-A) |
   | – | `20260715120000_atomic_downtime_save` | ⛔ 건너뜀 | 160000이 완전 대체. 단독 적용 시 커플링 재도입 |
   | 2 | `20260715160000_independent_downtime_lifecycle` | ✅ | 비가동 독립 lifecycle, shift_states, anon 실행권한 회수 |
   | 3 | `20260715170000_oee_completeness_and_alert_acknowledgements` | ✅ | 완결성 집계 + 알림 확인 테이블 |
   | 4 | `20260715180000_active_admin_authorization` | ✅ | `is_admin()`에 `is_active` |
   | 5 | `20260715190000_active_user_audit_authorization` | ✅ | 감사 RLS + `security_invoker` 뷰 |

3. **이 6개로도 닫히지 않는 보안 구멍이 있다 (5절).** 별도 신규 마이그레이션 필요.

---

## 1. 사전 준비 (적용 전 필수)

- [ ] **DB 백업 / PITR 복원 지점 생성.** 롤백 1차 안전망.
- [ ] **저트래픽 유지보수 창** 확보. 160000이 매 `production_records` 쓰기마다 발화하는
      트리거를 추가하고, 기존 데이터 backfill을 수행한다.
- [ ] **코드(현재 브랜치)와 DB를 함께 배포.** 마이그레이션 헤더가 "앱 브랜치 병합/배포 전
      적용 금지"를 명시한다. 160000이 `save_daily_production` 반환형(`shift_states` 추가)과
      비가동 동작, anon 실행권한을 바꾸므로 구버전 코드가 돌면 불일치가 생긴다.
- [x] **호환성 확인 완료:** analytics 4개 함수는 모두 `supabaseAdmin.rpc`(service_role)로 호출된다
      (`oee-data/route.ts:153`, `oee-data/by-machine/route.ts:44`, `oee-data/aggregated/route.ts:143`,
      `productivity-analysis/route.ts:158`). → 170000의 service_role 전용 회수와 호환. 라우트 안 깨짐.

---

## 2. 순서별 상세

### 1) `20260715080500` — 장기 집계 함수
- `analytics_oee_records_summary`를 **`DROP` 후 18컬럼으로 재생성**, `analytics_oee_by_machine`(9→9),
  `analytics_productivity` 생성. 모두 anon 회수, service_role/authenticated grant.
- **역할:** 라이브의 9컬럼 `analytics_oee_records_summary`를 DROP해 3)의 `CREATE OR REPLACE`가
  성공하게 만드는 **선행 조건**. (3-A 참조)

### 2) `20260715160000` — 비가동 독립 lifecycle (핵심)
- `downtime_entries`: `end_time`/`duration_minutes` NULL 허용, `version`·`updated_at` 컬럼 추가,
  `version>0` 체크, `(machine_id,start_time,end_time)` 인덱스.
- `validate_downtime_entry_write` 트리거를 **생산기록 요구 조건 없이** 재생성(= 120000의 커플링 제거).
- `upsert_downtime_entry` / `delete_downtime_entry` RPC 생성 (advisory lock + optimistic version).
- `save_daily_production`(6-arg) **재정의: 비가동을 더 이상 삭제하지 않음** + `production_shift_states` 유지.
- `delete_production_record` 재정의: 비가동 삭제 안 함(`deleted_downtime_entries:0`).
- `production_shift_states` 테이블 생성 + 기존 생산기록에서 `WORKING` backfill + 동기화 트리거.
- **anon/authenticated의 `save_daily_production`·`delete_production_record` 실행권한 회수** → 보안 C3 닫힘.
- **backfill(되돌리기 어려움, 그러나 정상화):** 이미 비활성 설비의 열린 `machine_logs`·`downtime_entries`를 종료.

### 3) `20260715170000` — 완결성 집계 + 알림 확인
- `alert_acknowledgements` 테이블 생성 → 알림 확인/해제 동작 복구.
- `analytics_oee_records_summary`(18컬럼) `CREATE OR REPLACE`, `analytics_oee_by_machine`(11컬럼) DROP+CREATE,
  `analytics_productivity`·`analytics_oee_daily` 재정의. 모두 **신뢰행(runtime+공정표준 완비, invalid 제외)만
  가중 집계**, 불완전·불가능 건수는 coverage로 분리 노출.
- **3-A ⚠️ 선행 조건:** `analytics_oee_records_summary`를 `CREATE OR REPLACE`로 9→18컬럼 변경은 불가(42P13).
  1)의 `DROP`이 반드시 선행되어야 한다. (1)을 건너뛰려면 이 파일 앞에
  `DROP FUNCTION IF EXISTS public.analytics_oee_records_summary(date,date,uuid,text);`를 직접 추가.)

### 4) `20260715180000` — 활성 관리자 인가
- `is_admin()`을 `role='admin' AND is_active IS TRUE`(또는 service_role)로 재정의. `BEGIN/COMMIT` 래핑.
- 비활성 admin이 만료 전 JWT로 PostgREST 직격하는 경로 차단(B3).

### 5) `20260715190000` — 감사 인가
- `system_settings_audit`의 모든 정책 제거 후 재구성: authenticated는 SELECT(활성 admin/engineer)만,
  INSERT는 service_role만. authenticated의 직접 INSERT 회수(감사 위조 C5 차단).
- `recent_settings_changes` 뷰에 `security_invoker=true` 적용(C6 차단), anon/authenticated grant 정리.
- `BEGIN/COMMIT` 래핑. 뷰가 존재해야 함(이미 존재).

---

## 3. 재실행 안전성 (idempotency)

- 대부분 `CREATE OR REPLACE` / `IF NOT EXISTS` / catalog 기반 DROP이라 재실행 안전.
- 160000의 `ALTER COLUMN ... DROP NOT NULL`, backfill UPDATE, `ADD COLUMN IF NOT EXISTS`, 제약 `DO IF NOT EXISTS`
  모두 재실행 안전.
- 각 파일을 **개별 migration/문 배치로** 적용한다. 180000/190000의 `BEGIN/COMMIT`은 파일 끝에 있어 무해.

---

## 4. 적용 후 스모크 테스트 (실 DB)

- [ ] **비가동 CRUD:** 추가(진행 중 = `end_time` NULL) → 조회 → 종료(version precondition) → 삭제.
      겹침 저장 409, 버전 충돌 409, 비활성 설비 거부.
- [ ] **생산 저장:** 단건/일일, 수량만 입력 시 runtime/OEE NULL 보존, B교대 자정 교차.
- [ ] **BUG-007 정상화:** 기존 비가동이 있는 교대를 **휴무 전환/생산기록 삭제해도 비가동 이력 보존**.
- [ ] **OEE 통계 카드:** `total_output`·`impossible_records`·`avg_oee_excluding_impossible`가 0/null이 아닌 실제 값.
- [ ] **aggregated OEE:** 기간별·전체 OEE가 null이 아님.
- [ ] **알림 확인/해제** 동작 및 재조회 유지.
- [ ] **비활성 admin 차단:** 비활성 admin JWT로 PostgREST 직접 `user_profiles` 수정 시도 → 거부.
- [ ] **감사 경로:** `update_system_setting` RPC로 설정 변경 시 감사행 기록되는지(190000 후 owner 권한 경로 확인),
      authenticated 직접 INSERT 거부.
- [ ] **`recent_settings_changes`:** 비관리자 조회 시 차단/빈 결과.
- [ ] **재검증:** 7/13+ 재계산 일치 유지(적용 전 통과 확인됨: 2,318건 불일치 0).

---

## 5. ⚠️ 이 6개로도 닫히지 않는 보안 구멍 (별도 신규 마이그레이션 필요)

라이브 `pg_policies` 확인 결과:

- `production_records` — `"Allow all access"` (ALL, public, `USING true`) → **anon 키로 32.7만 행 전체 읽기·쓰기.**
- `machine_logs` — `"Allow all access"` (ALL, public, `USING true`) → anon 전체 읽기·쓰기.
- `machines` — `"Anyone can read machines"` (SELECT, public, `true`) → anon 전체 열람(쓰기는 admin/engineer 차단).
- `production_records_ghost_backup_20260714` — RLS 비활성(616행 anon 노출).

**6개 마이그레이션 어느 것도 위 정책을 건드리지 않는다.** anon 노출은 지금 인터넷에서 악용 가능하므로,
`downtime_entries`가 이미 쓰는 역할·설비범위 정책과 동일 패턴으로 교체하는 신규 마이그레이션이 별도로 필요하다.
(단, 브라우저 anon 클라이언트가 이 테이블들을 직접 구독/조회하는 경로가 있으므로, 정책 교체 후 Realtime 구독과
운영자 설비범위 조회를 반드시 회귀 테스트한다.)

---

## 6. 롤백

- **1차 안전망:** 적용 전 백업/PITR 복원 지점.
- 함수: 직전 버전(`codex_round2_fixes`·`downtime_reporting_visibility` 파일 본문) 재적용으로 복원 가능.
- 신규 테이블(`alert_acknowledgements`, `production_shift_states`): DROP.
- 신규 컬럼(`version`·`updated_at`), 신규 트리거: DROP.
- backfill(닫힌 로그/비가동): 되돌리기 비권장 — 무한 열림 정리이므로 유지가 정상.

---

## 6. 롤백

- **1차 안전망:** 적용 전 백업/PITR 복원 지점.
- 함수: 직전 버전(`codex_round2_fixes`·`downtime_reporting_visibility` 파일 본문) 재적용으로 복원 가능.
- 신규 테이블(`alert_acknowledgements`, `production_shift_states`): DROP.
- 신규 컬럼(`version`·`updated_at`), 신규 트리거: DROP.
- backfill(닫힌 로그/비가동): 되돌리기 비권장 — 무한 열림 정리이므로 유지가 정상.

---

## 6. 롤백

- **1차 안전망:** 적용 전 백업/PITR 복원 지점.
- 함수: 직전 버전(`codex_round2_fixes`·`downtime_reporting_visibility` 파일 본문) 재적용으로 복원 가능.
- 신규 테이블(`alert_acknowledgements`, `production_shift_states`): DROP.
- 신규 컬럼(`version`·`updated_at`), 신규 트리거: DROP.
- backfill(닫힌 로그/비가동): 되돌리기 비권장 — 무한 열림 정리이므로 유지가 정상.

