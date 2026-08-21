# ALT/ALV 멀티테넌시 실행 계획 (P1 로컬 구현)

> 계약: `GRAPH_ALT_ALV_MULTI_FACTORY.md` + `.json`
> 인벤토리 근거: `D1_D2_INVENTORY_LEDGER.md` (2026-08-21 실측)
> 이 계획의 범위는 **P1 로컬/격리 구현과 검증까지**다. 운영 DB migration, 배포,
> ALV 데이터 생성은 각 Human Gate 승인 전에는 실행하지 않는다.

---

## 0. 이 계획이 서 있는 전제

인벤토리에서 확인된 현재 상태를 한 줄로 요약하면 이렇다.

> **공장이라는 개념이 시스템 어디에도 없다.** `factory_id` 컬럼 0개, 공장을 참조하는
> RLS 정책 0개, `p_factory_id` 를 받는 함수 0개, 공장이 붙은 Realtime 채널 0개,
> 공장이 붙은 설정 cache key 0개, 복합 FK 0개.

따라서 이것은 "필터를 추가하는" 작업이 아니라 **격리 경계를 새로 만드는** 작업이다.
필터는 잊어버리면 데이터가 새고, 경계는 잊어버리면 요청이 실패한다. 계획 전체가
후자로 기울도록 설계한다(fail-closed).

## 1. D3 결정 현황

7절 P0 이 요구하는 값 중 실측으로 확정된 것과 남은 것을 구분한다.

### 실측 확정 (운영 `system_settings`)

| 항목 | 값 | 출처 |
|---|---|---|
| ALT 표시명 | `ALMUS TECH` | `general.company_name` |
| ALT timezone | `Asia/Ho_Chi_Minh` | `general.timezone` |
| ALT 기본 언어 | `vi` | `general.default_language` |
| 교대 시작 | A `08:00` / B `20:00` | `shift.shift_a_start`, `shift.shift_b_start` |
| 날짜/시간 형식 | `DD/MM/YYYY`, `HH:mm:ss` | `general.*_format` |

### 미확정 — H1 에서 사람이 결정해야 하는 값

| 항목 | 왜 추측하면 안 되나 |
|---|---|
| ALT/ALV hostname | host 가 공장 선택자다. 틀린 바인딩은 잘못된 공장에 쓰기를 유발한다 |
| ALV timezone / 기본 언어 | 집계 business date 가 여기서 갈린다 |
| membership 명단 (auth 사용자 15명) | 배정 오류 = 데이터 접근 오류 |
| Global Admin 명단 | 계약 1절이 "기존 ALT 관리자 자동 승격 금지"를 명시 |
| cutover 방식 | 무중단 stamp trigger vs maintenance window |

**이 값들이 없어도 P1 구현은 가능하다.** factory code·hostname·membership 은 코드가
아니라 **데이터**이기 때문이다. P1 은 스키마·경계·계약을 만들고, 로컬 fixture 로
ALT/ALV 두 공장을 세워 검증한다. 실제 값 바인딩은 P2 이후 게이트에서 이뤄진다.

계획상 placeholder: `ALT`, `ALV` (계약 문서가 쓰는 이름 그대로).

## 2. 로컬 검증 환경

| 요소 | 상태 |
|---|---|
| Supabase CLI | 2.115.0 |
| Docker | 29.6.1 |
| `supabase/config.toml` | 존재 (`db.major_version = 15`, api `max_rows = 1000`) |
| 기존 migration | 58개 |

로컬 스택(`supabase start`)에 58개 migration 을 적용한 뒤 새 migration 을 얹고,
그 위에서 실제 JWT 로 RLS negative test 를 돌린다. 이것이 V1·V2 의 증거가 된다.

> 로컬 `max_rows` 가 1000 이라 운영(100,000)과 다르다. 페이징 회귀는 로컬에서 **더 빨리**
> 드러난다 — 유리한 차이이므로 맞추지 않는다. 다만 parity 쿼리는 두 값 모두에서
> 안전하도록 명시적으로 페이징한다.

## 3. 작업 순서 (P1)

계약 7절 P1 의 8단계를 이 저장소의 실제 표면에 대응시킨다.

### P1-1. negative test 를 먼저 쓴다

구현 전에 실패하는 테스트를 세운다. 순서를 바꾸면 "통과했다"가 무엇을 뜻하는지 알 수 없다.

- 교차 공장 읽기/쓰기 deny (RLS, 실제 JWT)
- membership 없음 / 비활성 membership / 비활성 factory → deny
- body 의 `factory_id` 위조 → 서버 해석값과 불일치 시 거부
- 같은 이름의 설비·모델이 두 공장에 공존 가능
- ALT parity: PK·행수·checksum

### P1-2. 글로벌 테이블 신설

`factories`, `factory_domains`, `factory_memberships`,
`user_machine_assignments`, `global_admins`(선택).

### P1-3. 공장 소유 테이블에 `factory_id` 추가 (nullable, expand)

대상은 인벤토리 5절의 공장 소유 13개 테이블. 이 단계에서는 **NOT NULL 을 걸지 않는다**
(contract 는 P4). index, `(factory_id, id)` UNIQUE, `NOT VALID` 복합 FK 를 함께 만든다.

판정 보류 2개는 H1 에서 확정한다.

- `audit_log` — 공장 소유로 볼지 글로벌 감사로 볼지
- `machine_status_descriptions` — 수정 가능하면 공장 소유(계약 4.2)

### P1-4. ALT backfill

부모 → 자식 순서로 채운다. 부모에서 파생할 수 없는 orphan 은 **ALT 로 귀속하지 않고**
quarantine 후 보고한다(계약 4.3).

순서: `product_models` → `model_processes` → `machines` → 나머지 사실 테이블.

### P1-5. parity 검증

행수·PK 집합·canonical checksum 을 backfill 전후로 비교한다. `production_records` 가
5만행이므로 **반드시 페이징**한다(인벤토리 11절).

### P1-6. RLS helper 와 정책 교체

계약 5.2 의 helper 5종을 만들고, 기존 20개 정책을 **같은 트랜잭션에서** 교체한다.
permissive 정책이 OR 로 남으면 격리가 무너진다.

정책 0개인 4개 테이블(`production_shift_states`, `production_progress_reports`,
`audit_log`, `alert_acknowledgements`)은 **새로 작성**한다.

### P1-7. 서버 인가 계약 전환

`requireUser` → `requireFactoryUser`. Route 44개 / method 77개 전부가 대상이다.
Service Role 사용 40개 Route 는 모든 query 에 `.eq('factory_id', factoryId)` 를 적용하고
단건 조회를 `(factory_id, id)` 로 바꾼다(IDOR 차단).

### P1-8. 클라이언트 컨텍스트

`FactoryProvider` 를 `AuthProvider` 바로 아래에 넣는다(계약 5.1). 공장 전환·로그아웃 시
채널·캐시·스냅샷·pending request 를 먼저 제거한다.

### P1-9. Realtime / 설정 / Storage / OEE

- 채널 7종 전부 이름에 factory 포함, snapshot 과 subscription 에 같은 조건
- 설정 cache key 를 `factoryId:category:settingKey` 로, 토픽을 `factory:{id}:settings` 로
- Storage 경로를 `factories/{code}/...` 로, 버킷 public 해제
- 집계·분석 RPC 에 `p_factory_id` 필수화 (**새 이름 + 구버전 유지 3단계**)

### P1-10. V1~V9

계약 8절 9개 레인을 같은 artifact version 에서 실행한다.

## 4. 이 저장소 고유의 함정 (계획에 미리 반영)

인벤토리와 CLAUDE.md 에서 확인된, 이 작업에서 실제로 밟기 쉬운 지뢰다.

1. **RPC 인자 추가는 오버로드를 만든다.** `create or replace` 는 인자 목록이 다르면
   덮어쓰지 않는다. `p_factory_id` 를 추가하는 모든 함수는 새 이름 + 구버전 유지의
   3단계 배포가 필요하다. 기존 `close_shift_upsert_v3` 라는 이름이 이 교훈의 흔적이다.

2. **Supabase 는 새 함수에 `PUBLIC EXECUTE` 를 되돌려 부여한다.** 함수를 만들 때마다
   명시적 revoke 가 필요하다. 권한은 열거하지 말고 전수 회수한다.

3. **advisory lock 과 행 잠금은 서로를 차단하지 않는다.** 설비 상태를 쓰는 함수는
   `pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0))` 를 **같은 키로** 먼저
   잡는다. factory 를 lock key 에 넣을 때 이 규약을 깨지 않도록 주의한다
   (`machineStateLockProtocol.test.ts` 가 마이그레이션 전체를 훑어 강제한다).

4. **PostgREST 는 조용히 자른다.** 무제한 `select()` 로 parity 를 계산하면 잘린 값을
   비교하게 된다. 5만행 테이블에서 이는 가설이 아니라 확정 사건이다.

5. **`NULL factory_id = ALT` 규칙은 금지**(계약 1절). expand 단계의 nullable 은 임시이며
   P4 contract 에서 NOT NULL 로 닫는다. 임시 stamp trigger 는 영구 default 로 대체하지 않는다.

6. **dev 는 Turbopack, build 는 webpack.** 타입·lint·테스트·프로덕션 빌드가 전부 통과해도
   dev 화면만 죽는 회귀가 이 저장소에서 실제로 있었다. 브라우저 확인이 검증의 일부다.

## 5. 중지 조건

- H1 승인 없이 운영 스키마를 바꾸지 않는다.
- H2 승인 없이 `LOCAL` 을 넘어가지 않는다.
- 실제 Supabase/Realtime/브라우저 검증을 실행하지 못한 항목은 **미검증으로 명시**하고
  통과라고 쓰지 않는다(계약 8절).
