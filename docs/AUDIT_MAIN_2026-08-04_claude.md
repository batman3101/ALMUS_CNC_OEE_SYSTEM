# `main` 브랜치 감사 보고서 (Claude)

- 감사일: 2026-08-04
- 감사 대상: `origin/main` = `2f927d6f40443b2e895fe66e69f17ab894980480` (PR #37 병합 직후, 현재 배포본)
- 방식: 코드 직접 읽기 + **운영 DB 읽기 전용 실측**(Supabase MCP)
- 변경: 없음. 읽기 전용 감사이며 수정은 대기한다.
- 선행 문서: `../CNC OEE-codex-2026-08-04-ultrareview/docs/ADVERSARIAL_AUDIT_MAIN_2026-08-04_CODEX.md`

> 로컬 `main`(`1e2eff2`)은 `origin/main`보다 8커밋 뒤처져 있다. 감사 대상은 배포본인 `origin/main`이다.

## 결론

**조건부 REQUEST CHANGES.** codex 보고서의 12건 중 **11건이 실재**하고 1건은 심각도가 과대평가됐다.
추가로 codex가 보지 못한 축(`authenticated` 역할 권한)에서 **1건**을 새로 찾았고, `CLAUDE.md`의
전제 수치 하나가 10배 틀렸다.

다만 **지금 당장 데이터가 손상되고 있는 상태는 아니다.** 최상위 결함의 실현 조건(동시 쓰기)과
2순위 결함의 실현 조건(비활성 계정 존재, 현재 0명)이 아직 충족되지 않았다. "고쳐야 한다"와
"지금 불타고 있다"는 다르며, 이 보고서는 전자다.

| 심각도 | 건수 |
|---|---:|
| CRITICAL | 1 |
| HIGH | 5 |
| MEDIUM | 7 |
| 정정(과대평가) | 1 |
| 문서 오류 | 1 |

---

## 실측한 운영 DB 상태 (2026-08-04)

| 항목 | 값 | 의미 |
|---|---:|---|
| `production_records` | 32,736 | **`CLAUDE.md`의 "~325k" 는 10배 틀렸다** |
| `production_progress_reports` | 2 | 진척 보고 기능이 사실상 미사용 |
| `downtime_entries` | 2,692 | |
| `machine_logs` | 300 | |
| `machines` | 800 | |
| `user_profiles` | 13 | |
| `is_active` 가 아닌 계정 | **0** | 결함 #2 의 실현 주체가 현재 없음 |

---

## CRITICAL

### 1. 생산실적 `PATCH`/`PUT` 이 잠금 밖에서 파생지표 전체를 덮어쓴다 — 운영자도 할 수 있다

**확인됨.** `src/app/api/production-records/[recordId]/route.ts`

- `PATCH`(436행) / `PUT`(304행) 은 허용 역할이 `['admin','engineer','operator']` 다.
- 처리 순서: 레코드를 `.select().single()` 로 읽고 → `buildUpdateData()` 가 Node 에서
  `ideal_runtime`·`availability`·`performance`·`quality`·`oee` 를 **전부 다시 계산**하고 →
  `.update(updateData).eq('record_id', …)` 로 통째로 쓴다.
- 이 경로에는 advisory lock 도, 버전·지문 대조(CAS)도 **없다**.
- 반면 `close_shift_upsert_v2` 와 `confirm_shift_defect` 는
  `pg_advisory_xact_lock(machine||date||shift)` 아래에서 돈다.

즉 같은 행을 고치는 두 부류가 **서로 다른 잠금 네임스페이스**에 있다. `CLAUDE.md` 가
이미 경고한 바로 그 실패 모드다 — "넷 다 잠금이 있는 것처럼 보이지만 상호 배제는 전혀 없다".

재현 순서:

1. `PATCH` 가 `defect_qty = 1` 인 행을 읽는다.
2. 그 사이 `confirm_shift_defect` 가 `defect_qty = 5` 와 새 `quality`/`oee` 를 확정 저장한다.
3. `PATCH` 가 1단계에서 읽은 값 기준으로 계산한 파생지표를 덮어쓴다 → **확정 불량이 사라진다.**

`close_shift_upsert_v2` 는 `on conflict … defect_qty = production_records.defect_qty` 로 확정 불량을
일부러 보존한다. 그 보존 규약을 **`PATCH` 만 지키지 않는다.**

가장 무거운 지점은 **운영자가 이 경로를 쓸 수 있다**는 것이다(`assertMachineAccess` 로 담당 설비에
한정되지만, 담당 설비의 확정 실적은 고칠 수 있다). 콘솔 UI 는 2단계 확정으로 조심스럽게 설계돼
있는데, 그 옆에 규율 없는 문이 열려 있다.

**방향** — 셋 중 하나. 순서대로 권한다.

1. `PATCH`/`PUT` 을 전용 RPC(`update_production_record_v1`)로 옮기고 같은 advisory 키를 잡는다.
   가장 확실하고, 기존 RPC 들과 규약이 하나가 된다.
2. 그게 크면 최소한 **CAS**를 넣는다 — 읽을 때 `defect_qty`·`updated_at` 지문을 뜨고
   `.update(...).eq('record_id', id).eq('defect_qty', seenDefect)` 로 조건부 갱신, 0행이면 409.
   `close_shift_source_digest` 가 이미 쓰는 패턴이라 새 개념이 아니다.
3. 정책 결정으로 해결: `PATCH`/`PUT` 에서 **운영자를 빼고**(`['admin','engineer']`),
   확정된 행의 `defect_qty` 수정은 `confirm_shift_defect` 로만 하게 막는다.

> 인자를 늘려 기존 RPC 를 고치지는 말 것. `CLAUDE.md` 의 3단계 배포 규칙(새 이름 + 구버전 유지)이
> 이미 두 번 필요했던 이유가 그것이다.

---

## HIGH

### 2. `product_models` · `model_processes` 만 쓰기 경계 밖에 남아 있고, 정책이 `is_active` 를 보지 않는다

**확인됨 — 그리고 codex 보고서보다 정확한 그림이 있다.**

운영 DB 실측:

| 테이블 | `authenticated` 권한 | RLS 정책 |
|---|---|---|
| `production_records` | `SELECT` | — |
| `downtime_entries` | `SELECT` | — |
| `machines` | `SELECT` | — |
| **`product_models`** | `SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES` | `ALL`, admin/engineer, **`is_active` 미검사** |
| **`model_processes`** | `SELECT,INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES` | `ALL`, admin/engineer, **`is_active` 미검사** |

핵심 도메인 테이블은 전부 `SELECT` 만 열려 있는데 **이 둘만 예외**다. 그리고 `ModelInfoManager.tsx`
는 API 를 거치지 않고 브라우저 Supabase 클라이언트로 직접 `insert`/`update`/`delete` 한다
(57·109·121·151·170·201·218행).

그래서 **쓰기 규칙이 두 벌**이다:

- API `POST /api/product-models`, `/api/model-processes` → `['admin','engineer']` (`is_active` 검사함)
- 실제로 쓰이는 경로 = 브라우저 → PostgREST → RLS → **`is_active` 검사 안 함**

강한 근거: 이 저장소는 **올바른 헬퍼를 이미 갖고 있다.**

```sql
-- current_user_role(): is_active 를 본다
select role from public.user_profiles where user_id = (select auth.uid()) and is_active
-- is_admin(): is_active 를 본다
... where user_id = auth.uid() and role = 'admin' and is_active is true
```

그런데 이 두 정책만 헬퍼를 쓰지 않고 조건을 **인라인으로 다시 적었고**, 다시 적으면서 `is_active`
가 빠졌다. 규칙을 두 번 적으면 언젠가 한쪽만 바뀐다는, 이 저장소가 `pageAccess.ts` 에서 이미
배운 교훈과 같은 형태다.

`TRUNCATE`/`TRIGGER`/`REFERENCES` 가 `authenticated` 에 붙어 있는 것도 사실이다. 다만 PostgREST 는
`TRUNCATE` 를 노출하지 않으므로 **웹에서 도달 가능한 위협은 아니다** — 과잉 권한이지 취약점은 아니다.

**현재 실현 가능성**: 비활성 계정이 **0명**이므로 오늘 악용될 주체가 없다. 그러나
`is_active=false` 는 `auth.users` 를 밴하지 않는다(`user_profiles` 만 바꾼다). 즉 계정을 하나
비활성화하는 순간, 그 계정의 refresh token 이 살아 있는 한 **기한 없이** 두 마스터 테이블을
고칠 수 있다. `tact_time_seconds` 는 모든 성능·OEE 계산의 분모다.

**방향** — 둘 중 하나. 1번이 더 작다.

1. RLS 정책을 `current_user_role() in ('admin','engineer')` 로 교체하고,
   `TRUNCATE`/`TRIGGER`/`REFERENCES` 를 회수한다. **RLS 술어는 `CLAUDE.md` 가 기록한
   `in (select unnest(...))` 성능 규칙을 지킬 것** — 여기서는 스칼라 비교라 해당 없지만,
   함수 호출을 `(select current_user_role())` 로 감싸 행마다 재평가되지 않게 한다.
2. 근본적으로는 `ModelInfoManager` 의 쓰기를 API 로 옮기고 `authenticated` 쓰기 권한을 전부 회수해,
   다른 테이블과 같은 경계에 세운다. 그러면 규칙이 하나가 된다.

부수적으로 **비활성화가 세션을 끊지 않는다**는 점 자체를 볼 것.
`is_active=false` 시 `auth.admin.signOut(userId, 'global')` 또는 밴을 함께 하지 않으면,
API 쪽 `requireUser` 는 막아도 PostgREST 직접 경로는 열려 있다.

### 3. 삭제와 마감이 서로 다른 잠금을 쓴다 → "레코드는 있는데 상태는 MISSING"

**확인됨.** 운영 DB 의 함수 정의 실측:

- `delete_production_record` — `SELECT … FOR UPDATE` (행 잠금만). advisory 없음.
- `close_shift_upsert_v2` — `pg_advisory_xact_lock` 2개. 행 잠금 없음.

`CLAUDE.md` 가 명시한 대로 두 잠금은 **서로를 차단하지 않는다.** 삭제가
`production_shift_states.status = 'MISSING'` 을 쓰는 사이 마감이 행을 다시 만들면,
생산실적은 존재하는데 교대 상태는 `MISSING` 인 조합이 남는다. `MISSING` 은 `OFF`/`HOLIDAY` 와
구분되는 값이라 백로그·미보고 집계가 이 행을 잘못 센다.

**방향** — `delete_production_record` 첫 줄에 마감과 **동일한 키**의 advisory lock 을 추가한다.
순서는 `CLAUDE.md` 규칙대로 advisory → 행 잠금. 이건 시그니처 변경이 아니라 본문 추가라
3단계 배포가 필요 없다.

### 4. 마지막 진척보다 작은 수량으로 교대를 마감할 수 있다

**확인됨.** `close-shift/route.ts:36-46` — `final_qty` 가 오면 마지막 진척값을 **아예 조회하지 않는다**.
`close_shift_upsert_v2` 의 검사도 `v_defect > p_output_qty`(확정 불량과의 비교) 하나뿐이다.

결과: 진척이 100 인 교대를 10 으로 마감할 수 있다. 확정 레코드가 생기므로 그 교대는 백로그에서도
사라지고, `production_progress_reports` 의 append-only 이력과 확정값이 어긋난 채 남는다.

이것이 **정책 구멍**인 이유: 진척 API 는 감소를 409 로 거부한다 — "조용히 받으면 그 차이만큼
생산량이 증발한다"가 그 이유였다. 같은 논리가 마감에는 적용되지 않았다.

**방향은 먼저 결정이 필요하다.** 두 갈래이고, 고르는 사람은 현장을 아는 쪽이어야 한다.

- **(가) 하향 마감을 금지한다** — 진척은 오직 늘어나므로 최종 수량도 그보다 작을 수 없다.
  RPC 안에서 마지막 진척을 읽어 `p_output_qty < last_progress` 면 거부(`reason='below_progress'`).
  잠금 안에서 읽어야 의미가 있다.
- **(나) 하향 마감을 허용하되 흔적을 남긴다** — 진척 과다 보고를 종이 카운트로 정정하는 실무가
  실제로 있다면 금지가 오히려 현장을 막는다. 이 경우 UI 에 경고를 띄우고 사유를 받아
  감사 로그에 남긴다.

진척 보고가 운영 DB 에 **2건뿐**이라는 사실이 판단에 중요하다. 이 기능은 아직 현장에서 거의
쓰이지 않으므로, 지금이 규칙을 정하기 좋은 때다.

### 5. 사용자 수정·삭제의 부분 실패가 성공으로 보고된다

**확인됨.** `src/app/api/admin/users/[userId]/route.ts`

- `PUT`(37–83행): 프로필 갱신 성공 + Auth 이메일 변경 **실패** → `profileUpdated` 만 보고
  **HTTP 200**. 관리자 화면에는 성공으로 뜨는데 이메일은 안 바뀐 상태.
- `DELETE`(117–160행): 순서가 ① `machine_logs.operator_id = NULL` → ② 프로필 삭제 →
  ③ Auth 삭제. ②가 실패해도 ①은 되돌리지 않는다(작업자 귀속이 영구 소실).
  ③이 실패해도 ②가 됐으면 **200 을 돌려준다.**

③ 실패의 결과가 특히 나쁘다 — **로그인은 되는데 프로필이 없는 계정**이 남는다. 그 계정은
`requireUser` 에서 403("사용자 프로필을 찾을 수 없습니다")을 맞으므로, 사용자는 로그인에
성공한 뒤 모든 화면이 깨진 상태를 본다. 그리고 관리자 목록에는 안 보이므로 **되살릴 방법도 없다.**

**방향**

- 순서를 뒤집는다: Auth 삭제를 **먼저**. Auth 가 사라지면 로그인이 막히므로, 뒤 단계가 실패해도
  남는 것은 "고아 프로필"이고 이건 목록에 보이므로 복구 가능하다. 지금은 반대로 **복구 불가능한
  쪽**이 남는다.
- 부분 실패는 200 이 아니라 **207 또는 500 + 무엇이 남았는지**를 돌려준다. 최소한
  `authDeleted=false` 를 성공으로 접지 않는다.
- `machine_logs` 귀속 해제는 삭제가 확정된 뒤로 미룬다.

### 6. Realtime 유실 창이 세 훅 중 두 곳에 남아 있다

**확인됨 — 그리고 올바른 해법이 이미 저장소 안에 있다.**

`useRealtimeData` 는 재감사 #8 에서 고쳐졌다: `snapshotAppliedRef`, `replayBufferedUpdates`,
`subscriptionGate` 로 **구독 준비 → 스냅샷 → 버퍼 재생** 순서를 만든다(285·298·313·436행).

그런데 `useRealtimeMachines`(177·271행)와 `useRealtimeProductionRecords`(312·400행)에는 그 장치가
**하나도 없다**. 스냅샷을 먼저 읽고 채널을 나중에 연다. 그 사이 커밋된 변경은 스냅샷에도 없고
이벤트로도 안 온다.

패턴이 이미 있는데 두 곳에만 적용된 것이라, 이건 설계 문제가 아니라 **적용 누락**이다.

**방향** — `useRealtimeData` 가 쓰는 `subscriptionGate`/`realtimeBuffer` 를 두 훅에 그대로 적용한다.
새로 설계할 것이 없다. 함께 `TIMED_OUT`(아래 #9)도 같은 커밋에서 처리하면 세 훅의 상태 처리가
한 벌이 된다.

---

## MEDIUM

### 7. Next.js 16.2.10 — 보안 패치 이전 버전

`package.json` `"next": "^16.2.10"`, 실제 설치본도 `16.2.10`. 권고 GHSA-6gpp-xcg3-4w24 의
영향 범위는 `>=16.0.0 <16.2.11`, 패치는 `16.2.11`.

**방향** — `16.2.11` 이상으로 올린다. 다만 이 앱은 Server Actions·custom server·rewrites 를
쓰지 않아 모든 권고 경로가 적용된다고 단정할 수 없다. 긴급 핫픽스가 아니라 **다음 정기 갱신**에
묶어도 되는 등급이다.

### 8. 정상적인 동시성 충돌이 500 으로 보고된다

`production-progress/route.ts:97-118` 이 처리하는 reason 은 `machine_in_downtime`,
`machine_inactive`, `machine_not_found`, `decreased` 네 가지다. RPC 가 돌려주는
**`already_closed` 는 없어서** 마지막 줄의 일반 500 으로 떨어진다.

데이터는 보호되지만, 마감과 겹친 정상적인 경합이 서버 장애로 기록되고 작업자에게도
"저장 실패"로 보인다. 실패 보고 통합(PR #37)이 만든 원장에도 오류로 쌓인다.

**방향** — `already_closed` → 409 + 전용 문구("이 교대는 이미 마감됐습니다"). 진척 UI 는
409 를 이미 구분해 다루므로 문구만 추가하면 된다.

### 9. `TIMED_OUT` 을 세 훅 모두 처리하지 않는다

`useRealtimeData`·`useRealtimeMachines`·`useRealtimeProductionRecords` 어디에도 `TIMED_OUT`
문자열이 없다. Supabase 가 이 상태를 주면 오류 표시도 재연결 루프도 시작되지 않아, 화면이
"연결됨"인 채로 갱신만 멈춘다 — 가장 알아채기 어려운 실패 형태다.

**방향** — `CHANNEL_ERROR` 와 동일 분기에 넣는다. #6 과 같은 커밋으로.

### 10. 시스템 설정 broadcast 가 검증 없이 전역 상태에 반영된다

`SystemSettingsContext.tsx:220-223` — `supabase.channel('system_settings_changes')` 에
`{ config: { private: true } }` 가 없고, `payload.payload` 의 `category`/`key`/`value` 를
역할 확인이나 DB 재조회 없이 그대로 반영한다.

프로젝트가 public channel 을 허용하는 설정이면, 로그인한 아무 사용자나 교대 시작 시각·휴식 시간·
OEE 임계값을 **비영속적으로** 위조해 화면 간 split-brain 을 만들 수 있다. DB 는 안전하다
(`system_settings` 는 `authenticated` 에 `SELECT` 만, 쓰기는 `is_admin()` 정책) — 훼손되는 것은
화면이 믿는 값이다.

**방향** — 채널을 private 으로 만들고 Realtime authorization 을 걸거나, broadcast 를 **신호로만**
쓰고 값은 항상 DB 에서 다시 읽는다. 후자가 더 단순하고 확실하다.

### 11. 미래 시각의 열린 비가동이 현재 입력을 막을 수 있다

`downtime-entries/route.ts:65-69` 은 `start_time` 이 유효한 날짜인지만 보고 **미래인지 보지 않는다**.
진척 RPC 는 `end_time IS NULL` 인 비가동을 전부 "지금 비가동"으로 판정한다(`start_time <= now()`
조건 없음).

결과: 미래 시작 비가동이 하나 있으면 UI 는 입력 가능해 보이는데 저장은 409
`machine_in_downtime` 으로 거부된다. 작업자에게는 원인 없는 거부로 보인다.

**방향** — 두 곳 다 손대는 편이 낫다. 입력 시 `start_time > now()` 거부(명확한 사용자 오류),
그리고 RPC 의 "현재 비가동" 판정에 `start_time <= now()` 를 추가(방어).

### 12. 운영자에게 확정적으로 실패할 삭제 버튼이 보인다

- `/production-records` 는 전 역할 허용 (`pageAccess.ts:58`)
- `ProductionRecordList.tsx:345` 의 `Popconfirm` 삭제 버튼에 역할 검사가 없다 (`useAuth` 조차 안 씀)
- `DELETE /api/production-records/[recordId]` 는 `['admin','engineer']` (382행)

운영자는 버튼을 누를 수 있고 **항상 403** 을 받는다. 보안 결함은 아니다 — API 가 막는다.
`pageAccess.ts` 가 세운 원칙("권한 없는 것은 자물쇠와 함께 비활성으로 남긴다")이 **페이지 단위로만
적용되고 페이지 안의 동작에는 적용되지 않은** 사례다.

**방향** — 목록에서 역할을 읽어 버튼을 비활성 + 자물쇠로 표시한다. 더 나은 방향은
`pageAccess.ts` 에 동작 단위 권한 함수를 하나 더 두어(`canDeleteProductionRecord(role)`),
UI 와 API 가 **같은 함수**를 읽게 하는 것이다. 이미 `canManageUsers`/`USER_MANAGEMENT_ROLES` 가
그 패턴이다.

### 13. 쓰지 않는 `oee_calculations` 테이블이 전 사용자에게 열려 있다 — 신규 발견

**codex 보고서에 없는 항목.** 운영 DB 실측:

```
oee_calculations · authenticated: SELECT,INSERT,UPDATE,DELETE,TRUNCATE,...
정책 "인증된 사용자는 OEE 계산을 관리할 수 있음": cmd=ALL, using=(auth.role()='authenticated'), with_check=NULL
```

`ALL` 정책에서 `with_check` 가 NULL 이면 Postgres 는 `USING` 식을 검사에도 쓴다. 따라서
**운영자를 포함한 모든 로그인 사용자가 이 테이블에 자유롭게 INSERT/UPDATE/DELETE 할 수 있다.**

현재 행 수는 **0** 이고 애플리케이션 코드에서 참조하지 않는다. 그래서 피해는 없지만,
"아무나 쓸 수 있는 테이블"이 스키마에 남아 있는 것 자체가 다음 감사의 오탐/진탐을 가른다.

**방향** — 쓰지 않으면 `DROP`. 남길 이유가 있으면 다른 테이블과 같은 경계
(`authenticated` 는 `SELECT` 만)로 맞춘다.

---

## codex 보고서 정정

### 정정 1 — 생산실적 페이지네이션(codex #6)은 HIGH 가 아니다

주장 자체는 맞다. `production-records/route.ts:126` 은 `q.range(0, page * limit - 1)` 로
**0번째부터 누적** 조회한 뒤 `merged.slice((page-1)*limit, page*limit)` 로 메모리에서 자른다.

그러나 "깊은 페이지가 빈 배열이 된다"는 결과는 PostgREST `max-rows`(100,000)를 넘어야 발생하는데,
**운영 데이터는 32,736행**이다. `limit=100` 기준 최대 328페이지, `page*limit` 이 100,000 에 닿지
않는다. 즉 **현재 발현하지 않는 잠재 결함**이다.

실재하는 부분은 성능이다 — 328페이지를 열면 32,736행을 전송해 4,900행 남기고 버린다.

같이 지적할 것이 하나 더 있다. 바로 위 주석이 이렇게 적혀 있다:

> `// 스코프가 하나면 (관리자·엔지니어·설비 지정) 청크가 1개라 예전과 똑같이 그 페이지만 받는다.`

**이 문장은 코드와 다르다.** `range(0, page*limit-1)` 은 청크 개수와 무관하게 항상 0부터 받는다.
틀린 주석이 문제를 가리고 있으므로, 고치기 전이라도 **주석 먼저 정정**하는 편이 안전하다.

**방향** — 급하지 않다. 다만 고칠 때는 keyset 페이지네이션이나 전용 RPC 로 가고,
운영자 스코프(담당 설비 800대 분할 조회) 때문에 청크 병합이 필요한 구조라는 점을 감안한다.

### 정정 2 — "익명 grant 전수 검사 통과"는 축이 하나 빠졌다

codex 표의 `익명 grant 검사 | 테이블·뷰 23개와 비휘발성 RPC 10개 모두 접근 불가` 는 `anon` 기준이고
그 결론은 맞다(재확인함). 그러나 **`authenticated` 축은 검사되지 않았다.** 그 축에서
`authenticated` 에 전체 DML 이 열린 객체가 12개 나왔고, 그중 위 #2·#13 이 실제 노출이다.

나머지 9개는 안전한 것으로 확인됐다:

- 뷰 6개(`current_machine_status`, `latest_oee_metrics`, `machine_downtime_intervals`,
  `machine_status_statistics`, `machines_with_production_info`, `recent_machine_status_changes`)는
  전부 `security_invoker = true` → 기반 테이블 RLS 를 그대로 따른다. **우회 아님.**
- `audit_log` 는 RLS 켜짐 + **정책 0개** → 전부 거부.
- `machine_status_descriptions` 는 `SELECT` 정책만 → 쓰기 거부.
- `machine_status_history` 는 `INSERT` 가 admin/engineer, `UPDATE`/`DELETE` 정책 없음 → 거부.

**권한 감사는 `anon` 과 `authenticated` 두 축을 다 봐야 한다.** 한 축만 보면 "전수"라는 말이
사실과 달라진다.

### 정정 3 — 함수 `search_path` 경고는 권한 상승이 아니다

Supabase advisor 가 6개 함수에 `function_search_path_mutable` 을 띄운다
(`close_shift_upsert_v2`, `confirm_shift_defect`, `toggle_machine_downtime`, `report_shift_progress`,
`correct_open_downtime_reason`, `enforce_progress_monotonic`, `machine_downtime_merged_minutes`).

실측 결과 이들은 **전부 `SECURITY INVOKER`** 다. 호출자 권한으로 도므로 `search_path` 조작으로
권한이 올라가지 않는다. 반대로 `SECURITY DEFINER` 인 함수들(`is_admin`, `current_user_role`,
`update_system_setting`, `update_my_preferences`, `get_system_setting`, `apply_machine_update`,
`delete_production_record`)은 **모두 `search_path` 가 고정돼 있다.**

**INFO 등급.** 위생상 붙이면 좋지만 보안 결함이 아니다.

---

## 문서 오류

### `CLAUDE.md` 의 "~325k rows" 는 실제와 10배 다르다

`CLAUDE.md` 의 PostgREST 절은 이렇게 단언한다:

> `production_records` 는 ~325k 행을 담고 있으므로, 제한 없는 조회는 조용히 틀린다.

**실측 32,736행.** 100,000 캡의 3분의 1이다. 규칙 자체("SQL 에서 집계하라", "원시 행은 페이지로")는
여전히 옳지만, **근거로 든 숫자가 틀리면 다음 사람이 규칙의 적용 범위를 잘못 판단한다** —
정정 1 이 정확히 그 사례다(codex 가 이 수치를 전제로 HIGH 를 매겼다).

2026-07-16 의 698k행 정리 이후 숫자가 갱신되지 않은 것으로 보인다.

**방향** — 수치를 갱신하되 규칙은 유지하고, "현재 N행 / 캡 100k" 처럼 **여유를 함께** 적는다.
그러면 다음에 다시 늘었을 때 판단 근거가 남는다.

---

## 우선순위 제안

수정은 대기 중이며, 착수 순서만 제안한다.

| 순서 | 항목 | 이유 |
|---:|---|---|
| 1 | #1 `PATCH`/`PUT` 잠금 통합 | 확정 데이터가 소실되고, **되돌릴 수 없다** |
| 2 | #3 삭제 RPC advisory lock | 한 줄 추가. 배포 위험 없음 |
| 3 | #5 사용자 삭제 순서 뒤집기 | 복구 불가능한 상태가 만들어지는 걸 막는다 |
| 4 | #2 모델·공정 RLS + 쓰기 경계 | 지금은 주체가 없지만, 계정 하나 비활성화하는 순간 열린다 |
| 5 | #6 + #9 Realtime 세 훅 통일 | 패턴이 이미 있어 적용만 하면 된다 |
| 6 | #4 마감 하향 정책 | **먼저 결정**이 필요하다(가/나) |
| 7 | #8 · #11 · #12 | 사용자에게 보이는 오해를 없앤다 |
| 8 | #7 · #10 · #13 · 문서 정정 | 정기 갱신에 묶는다 |

`CLAUDE.md` 수치 정정은 어느 커밋에 묶어도 되지만 **먼저** 하는 편이 좋다 —
다음 감사가 또 같은 전제로 오판할 수 있다.

---

## 검증 방법과 한계

**수행함**

- `origin/main`(`2f927d6`) 의 소스를 `git show` 로 직접 읽어 12건 전부 코드 위치 확인
- 운영 DB 읽기 전용 조회: `pg_policies`, `information_schema.role_table_grants`, `pg_class`
  (RLS·security_invoker·owner), `pg_proc`(SECURITY DEFINER·search_path·EXECUTE 권한),
  주요 테이블 행 수, Supabase security advisor
- API 라우트 62곳의 `requireUser` 허용 역할 전수 확인 → UI 등급(`pageAccess.ts`)과 대조
- `model-processes`/`product-models` 의 `[id]` 라우트가 GET 전용이며 쓰기 API 는
  admin/engineer 임을 확인(운영자 쓰기 구멍 **없음**)

**하지 않음**

- 자동 검증 재실행(lint/tsc/jest/build). codex 결과를 그대로 인용하지 않고 **판단 근거로도 쓰지
  않았다** — 이 보고서의 모든 결론은 코드와 DB 실측에서 나온다.
- 실제 동시 쓰기 재현(#1·#3). 운영 데이터를 바꾸게 되므로 하지 않았다.
  이 둘은 코드·함수 정의상 상호 배제가 없다는 **구조적 근거**로 판정했다.
- 비활성 계정 JWT 로 실제 mutation 시도(#2). 계정을 비활성화해야 하므로 하지 않았다.
- 브라우저에서의 Realtime 유실·broadcast 위조 재현(#6·#10).
- 역할별 브라우저 UI 검증.

**따라서 이 보고서의 신뢰 수준은 항목마다 다르다.** #1·#2·#3·#4·#5·#8·#9·#11·#12·#13 은
코드/DB 를 직접 읽어 확인했다. #6·#10 은 코드 구조로 판정했고 브라우저 재현은 남아 있다.
#7 은 버전 대조다.
