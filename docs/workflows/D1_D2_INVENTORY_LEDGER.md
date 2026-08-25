# D1/D2 인벤토리 원장 — ALT/ALV 멀티테넌시 전환

> 근거: `GRAPH_ALT_ALV_MULTI_FACTORY.md` 3절 "구현 전 반드시 다음 ledger를 생성한다".
> **측정일 2026-08-21.** 저장소는 commit `704c625`, 운영 DB는 project `wmtkkefsorrdlzprhlpr` 실측.
> 이 문서는 읽기 전용 조사 결과다. 코드·스키마·운영 상태를 변경하지 않았다.

---

## J0 증거 요약

| 노드 | 상태 | 증거 |
|---|---|---|
| D1 저장소 인벤토리 | 완료 | 1~4절 |
| D2 배포 상태 인벤토리 | 완료 | 5~9절 |
| D3 제품/운영 결정 | **미확정** | 10절 — 사람 결정 필요 |

D3 미확정이므로 **J0 는 2/3** 이다. 문서 7절 P0 은 "ALT/ALV code, hostname, timezone,
기본 언어를 확정한다"를 D3 로 요구하는데, 이 값들은 저장소에도 운영 DB 에도 없다(10절).

---

## 1. API Route 원장 (D1)

- Route 파일 **44개**, 내보낸 HTTP method **77개**
- `supabase-admin`(Service Role, RLS 우회) 사용 Route **40 / 44**
- `requireUser` 를 부르지 않는 Route **4개**

| Route | method | 비고 |
|---|---|---|
| `auth/login` | POST | 로그인 자체 — 인증 전 진입점 |
| `auth/logout` | POST | 로그아웃 |
| `auth/profile` | GET, PUT | 세션 사용자 본인 프로필 |
| `system-settings/update` | POST | **설정 쓰기 경로. 전환 시 최우선 확인 대상** |

> 문서 5.3 은 "모든 운영 Route 의 **모든 HTTP method/action**"에 공장 인가를 요구한다.
> 현재 인가 계약은 `requireUser(request, allowedRoles)` 로 **공장 개념이 없다**
> (`src/lib/apiAuth.ts:42`). 이것이 5.1 의 `requireFactoryUser` 로 바뀌어야 할 지점이다.

## 2. Realtime 채널 원장 (D1)

채널 이름에 공장 식별자가 **하나도 없다**. 문서 6.2 는 "channel/topic 이름에 factory ID 를
포함한다"를 요구한다.

| 위치 | 채널 이름 | 공장 범위 |
|---|---|---|
| `contexts/NotificationContext.tsx` | `notification-machine-changes` | 없음 |
| `contexts/SystemSettingsContext.tsx` | `system_settings_changes` | 없음 |
| `lib/systemSettings.ts` | `system_settings_changes` | 없음 (Context 와 **이름 충돌**) |
| `hooks/useRealtimeData.ts` | `machines_changes`, `machine_logs_changes`, `production_records_changes` | 없음 |
| `hooks/useRealtimeMachines.ts` | `machines-channel` | 없음 |
| `hooks/useRealtimeProductionRecords.ts` | `production-records-channel-N` (동적 시퀀스) | 없음 |
| `hooks/useMachines.ts` | `channelNameRef.current` (동적) | 없음 |

## 3. 설정 cache 원장 (D1)

- cache key: `category.key` 형태 (`lib/systemSettings.ts:219, 693`) — **공장 없음**
- TTL 5분 싱글턴 캐시. 문서 6.1 이 요구하는 key 는 `factoryId:category:settingKey`
- 싱글턴 캐시 + 공장 없는 key = 한 프로세스가 두 공장을 서빙하면 **값이 섞인다**

## 4. Storage 원장 (D1/D2)

- 코드 참조는 `api/upload/image/route.ts:14` 의 `BUCKET_NAME = 'company-assets'` 한 곳
- 운영 버킷 `company-assets` 는 **`public = true`** (전체 공개), object **5개**
- 문서 6.3 은 "전체 public listing 을 금지"하고 경로를 `factories/{factoryCode}/...` 로 요구

## 5. 테이블 원장 (D2)

15개 BASE TABLE 전부 RLS 활성. **`factory_id` 를 가진 테이블은 0개.**

| 테이블 | RLS | 정책 수 | 실측 행수 | 분류(제안) |
|---|---|---|---|---|
| `production_shift_states` | on | **0** | 60,449 | 공장 소유 |
| `production_records` | on | 1 | 51,603 | 공장 소유 |
| `production_progress_reports` | on | **0** | 13,947 | 공장 소유 |
| `downtime_entries` | on | 3 | 5,695 | 공장 소유 |
| `machine_logs` | on | 1 | 5,071 | 공장 소유 |
| `system_settings_audit` | on | 2 | 910 | 공장 소유 |
| `machines` | on | 2 | 800 | 공장 소유 |
| `audit_log` | on | **0** | 102 | 판정 필요 |
| `machine_status_history` | on | 2 | 60 | 공장 소유 |
| `model_processes` | on | 1 | 56 | 공장 소유 |
| `system_settings` | on | 2 | 47 | 공장 소유 |
| `product_models` | on | 1 | 32 | 공장 소유 |
| `user_profiles` | on | 4 | 13 | **글로벌** |
| `machine_status_descriptions` | on | 1 | 9 | 판정 필요 (4.2: "수정 가능하면 공장 소유") |
| `alert_acknowledgements` | on | **0** | 3 | 공장 소유 |

### RLS 는 켜져 있는데 정책이 0개인 테이블 4개

`production_shift_states`(6만행), `production_progress_reports`(1.4만행), `audit_log`,
`alert_acknowledgements`.

정책 0 = deny-all 이므로 **현재는 fail-closed** 다. 그러나 이는 이 테이블들의 실질 접근이
전부 Service Role 경로라는 뜻이고, 문서 1절이 요구하는 "최종 보안 경계는 RLS" 가 이
테이블들에는 **아직 존재하지 않는다**. 전환 시 신규 작성 대상이다.

## 6. 정책 원장 (D2)

정책 **20개**. **`factory_id` 를 참조하는 정책은 0개** — 전부 role 기반이다.

| 테이블 | 정책 | cmd | 술어 | 전환 시 문제 |
|---|---|---|---|---|
| `system_settings` | 모든 인증된 사용자는… | SELECT | `auth.role() = authenticated` | **ALV 사용자가 ALT 설정을 읽는다** |
| `machines` | Authenticated users can modify | ALL | `user_profiles.role in (admin, engineer)` | 역할만 보고 공장을 안 본다 |
| `machines` | Scoped read | SELECT | `current_user_role()` / `current_user_machines()` | 공장 개념 없음 |
| `user_profiles` | Service role full access | ALL | JWT role = service_role | 글로벌 테이블이므로 유지 가능 |

## 7. 함수 원장 (D2)

사용자 정의 함수 **38개** (extension 소속 제외). **SECURITY DEFINER 26개 / INVOKER 12개.**
`p_factory_id` 를 받는 함수는 **0개**.

`authenticated` 에 EXECUTE 가 부여된 함수 (5.4 최우선 검토 대상):

| 함수 | security | 비고 |
|---|---|---|
| `current_user_role()` | DEFINER | RLS 정책이 직접 호출 |
| `current_user_machines()` | DEFINER | RLS 정책이 직접 호출 |
| `is_admin()` | DEFINER | RLS 정책이 직접 호출 |
| `get_system_setting(p_category, p_key)` | DEFINER | 공장 인자 없음 |
| `update_system_setting(p_category, p_key, p_value, p_reason)` | DEFINER | **쓰기**, 공장 인자 없음 |
| `update_my_preferences(p_language, p_theme_mode)` | DEFINER | 본인 전용 — 글로벌 유지 가능 |
| `update_system_settings_batch(p_updates, p_reason)` | INVOKER | **쓰기**, 공장 인자 없음 |
| `machine_downtime_merged_minutes(...)` | INVOKER | 공장 인자 없음 |
| `enforce_progress_monotonic()` | INVOKER | 트리거 함수 |

`analytics_*` 5개는 DEFINER 이나 EXECUTE 가 `service_role` 로 한정되어 있다(양호).
다만 5.4 는 "분석 RPC 는 `p_factory_id` 를 필수로 받는다"를 요구하므로 시그니처 변경 대상이다.

> CLAUDE.md 가 경고하듯 `create or replace` 로 인자를 늘리면 **오버로드**가 생긴다.
> 인자를 추가하는 RPC 는 새 이름 + 구버전 유지의 3단계 배포가 필요하다.

## 8. 뷰 원장 (D2)

뷰 **7개**, **전부 `security_invoker = true`** (양호 — 5.4 권장과 일치).
`current_machine_status`, `latest_oee_metrics`, `machine_downtime_intervals`,
`machine_status_statistics`, `machines_with_production_info`,
`recent_machine_status_changes`, `recent_settings_changes`.

결과에 `factory_id` 를 포함하고 join 도 factory 를 함께 비교하도록 재작성해야 한다.

## 9. 관계 무결성 원장 (D2)

FK **12개, 전부 단일 컬럼**. 문서 4.3 이 요구하는 `(factory_id, parent_id)` 복합 FK 는 0개.

```
downtime_entries.machine_id            -> machines.id
downtime_entries.operator_id           -> user_profiles.user_id
machine_logs.machine_id                -> machines.id
machine_logs.operator_id               -> user_profiles.user_id
machine_status_history.machine_id      -> machines.id
machines.current_process_id            -> model_processes.id
machines.production_model_id           -> product_models.id
model_processes.model_id               -> product_models.id
production_progress_reports.machine_id -> machines.id
production_records.machine_id          -> machines.id
production_shift_states.machine_id     -> machines.id
system_settings_audit.setting_id       -> system_settings.id
```

기타:

- Realtime publication `supabase_realtime`: `machines`, `machine_logs`, `production_records`, `user_profiles`
- 트리거 11개, `auth.users` 15명
- 설정 카테고리 6종(`display`, `general`, `notification`, `oee`, `shift`, `ui`) 47행

## 10. D3 — 확정되지 않은 제품/운영 결정

아래는 저장소와 운영 DB 어디에도 없다. 문서 7절 P0 이 D3 로 요구하는 값이며,
**추측으로 채우면 1절 "동결된 아키텍처 결정"을 위반**한다(특히 host 바인딩과 membership 명단).

| 항목 | 필요 값 | 현재 상태 |
|---|---|---|
| ALT / ALV factory code | 예: `ALT`, `ALV` | 미정 |
| hostname | `alt.<domain>`, `alv.<domain>` 의 실제 도메인 | 미정 — 현재 배포는 Vercel 단일 도메인 |
| timezone | 공장별 IANA timezone | ALT 는 `plant_timezone` 설정 확인 필요, ALV 미정 |
| 기본 언어 | ko / vi | ALT 미확정, ALV 미정 |
| membership 명단 | auth 사용자 15명의 공장 배정 | 미정 |
| Global Admin 명단 | `global_admins` 등록 대상 | 미정 (1절: 기존 ALT 관리자 자동 승격 **금지**) |
| cutover 방식 | 무중단 ALT stamp trigger vs maintenance window | 미정 |

## 11. 규모 경고 (전환 계획에 영향)

`production_records` 가 **51,603행**이다. CLAUDE.md 는 2026-08-04 기준 32,736행으로
적고 있으니 17일 만에 +18,867행 — **하루 약 1,110행**.

PostgREST `max-rows` 100,000 까지 약 48,400행 = **약 43일**. backfill·검증 쿼리는 이
상한을 전제로 페이징해야 하며, 무제한 `select()` 로 parity 를 계산하면 **조용히 잘린 값을
비교**하게 된다.

CLAUDE.md 의 행수 서술은 갱신이 필요하다(같은 파일이 "재측정 후 인용하라"고 경고한다).

## 12. 선행 blocker — 저장소 마이그레이션이 재현되지 않는다

인벤토리 도중 로컬 스택으로 스키마를 재현하려다 발견했다. 이것은 멀티테넌시 전환보다
**먼저 존재하는 결함**이며, 계약 7절 P1 의 "로컬/격리 staging 구현" 자체를 불가능하게 한다.

### 증상 (실측)

```
$ npx supabase start
Applying migration 20251116070000_create_system_settings_audit_table.sql...
ERROR: relation "public.system_settings" does not exist (SQLSTATE 42P01)
```

### 구멍의 크기

| 종류 | 운영에 존재 | 저장소에 정의 있음 | 누락 |
|---|---|---|---|
| 핵심 테이블 | 15 | 4 | **11** |
| 사용자 정의 함수 | 38 | 29 | **9** |

누락 함수: `audit_role_change`, `audit_system_settings_change`,
`close_previous_machine_log`, `get_system_setting`, `set_operator_id`,
`handle_updated_at`, `update_downtime_entries_updated_at`,
`update_updated_at_column`, `validate_machine_process_model`.

대부분 트리거 보조 함수다. "당연히 있겠거니" 하고 넘어가기 쉬운 것들이라 아무도 부재를
눈치채지 못했다.

### 왜 심각한가

1. **로컬/격리 staging 재현 불가** → RLS·backfill 을 실제로 검증할 방법이 없다. V1·V2 증거를
   만들 수 없다는 뜻이다.
2. **재해 복구 불가** → 운영 DB 가 사라지면 스키마를 되살릴 원본이 어디에도 없다.

### 대응

baseline 마이그레이션 2개를 추가했다.

- `00000000000000_baseline_schema.sql` — 타입 1, 테이블 15, 제약 전체
- `00000000000001_baseline_functions.sql` — 누락 함수 9개 (`pg_get_functiondef` 원문)

**운영에는 적용하지 않는다.** 운영에는 이미 존재하며, 이 파일들은 로컬/격리 재현 전용이다.
운영 migration 이력과 맞추려면 `supabase migration repair` 로 applied 처리해야 한다.

### 부수 발견: baseline 은 "현재 상태"가 아니라 "시퀀스 시작 상태"다

`production_records_ghost_backup_20260714` 는 현재 운영에 **없다**(실측 0개). 그런데
`20260715200000` 이 그것을 잠그고 `20260729180000` 이 드롭한다. 즉 시퀀스는 그 테이블이
있다고 전제하고 스스로 치운다.

baseline 에 그 테이블을 넣어야 재현이 운영과 같은 궤적을 그리고 같은 최종 상태에 도달한다.
대안(그 마이그레이션을 조건부로 수정)은 "이미 적용된 마이그레이션을 다시 쓰지 않는다"는
AGENTS.md 규칙을 어긴다.

### 부수 발견: 설정 값 중첩 이상

`ui.language` 의 저장 형태가 `{"value":{"value":"vi"}}` 로 **이중 중첩**돼 있다.
같은 성격의 `general.default_language` 는 `{"value":"vi"}` 다. 멀티테넌시와 무관한
기존 데이터 이상이므로 별건으로 기록한다.
