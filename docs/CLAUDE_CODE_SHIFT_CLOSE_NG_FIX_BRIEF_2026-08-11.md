# Claude Code 실행 지시서: 교대 종료 수량·다음날 NG 입력 워크플로우 개선

- 작성일: 2026-08-11
- 기준 브랜치: `main`
- 기준 커밋: `39bad7d80465f63b78c24550157eb581cf1e976d`
- 대상 앱: CNC OEE Monitoring System
- 운영 Supabase 프로젝트: `wmtkkefsorrdlzprhlpr` (`CNC_OEE`)
- 문서 목적: Claude Code가 분석 보고에 머물지 않고 수정·테스트·검증까지 완료하도록 하는 구현 인계서

> 이 문서의 운영 데이터 건수는 2026-08-11 조회 시점의 스냅샷이다. 구현을 시작할 때 다시 조회한다.
> 코드·테스트·배포 상태가 이 문서와 다르면 현재 저장소와 운영 상태를 우선한다.

---

## 1. Claude Code에 전달할 최상위 지시

이 문서를 작업 계약으로 사용한다.

1. 먼저 루트 `AGENTS.md`와 관련 코드를 다시 읽고 현재 상태가 이 문서와 일치하는지 확인한다.
2. 기존 동작을 회귀 테스트로 고정한 뒤 수정한다.
3. 아래 P0 → P1 → P2 순서로 문제를 해결한다.
4. 단순 UI 표시 수정에 그치지 말고 브라우저 → API Route → Supabase RPC/테이블까지 전체 흐름을 검증한다.
5. 운영 DB 마이그레이션 적용이나 프로덕션 배포는 로컬 검증 완료 후 별도 승인을 받고 수행한다.
6. 기존 사용자 변경을 되돌리지 않는다. `.omc/`, `.omx/`, 비밀 파일은 작업 범위에서 제외한다.
7. 새 의존성을 추가하지 않는다.
8. 적용된 기존 migration 파일은 수정하지 않는다. DB 변경이 필요하면 새 타임스탬프 migration을 추가한다.
9. 완료 보고에서 lint, typecheck, Jest, build, migration, 브라우저 검증을 각각 분리해 제시한다.

완료 조건은 “코드가 작성됨”이 아니라 아래 인수 시나리오가 모두 통과하는 것이다.

---

## 2. 현재 확인된 결론

### 2.1 교대 종료 후 생산수량 입력

현재 기능은 조건부로 가능하다.

- 교대 중 상단 입력은 `POST /api/production-progress`로 누적 생산량을 보고한다.
- 현재 운영 설정은 A조 08:00 시작, B조 20:00 시작, 교대 전환 유예 10분이다.
- 교대 종료와 유예 시간이 지나면 진행 보고는 서버에서 거부한다.
- 이후 운영자 콘솔 하단의 주황색 `지난 교대 ... 마감 대기` 카드가 `POST /api/production-records/close-shift`를 호출한다.
- `close-shift`는 입력 시각이 아니라 요청의 `date`와 `shift`에 생산량을 귀속한다.
- 운영자는 본인이 입력한 진척만이 아니라 자신에게 배정된 설비의 지난 교대를 마감할 수 있다.

관련 코드:

- `src/components/dashboard/operator-console/ProgressInputSection.tsx`
- `src/components/dashboard/operator-console/CloseShiftSection.tsx`
- `src/components/dashboard/operator-console/MachineConsole.tsx`
- `src/app/api/production-progress/route.ts`
- `src/app/api/production-records/close-shift/route.ts`
- `src/utils/shiftReportingWindow.ts`

### 2.2 다음날 NG 입력

전용 처리 경로가 이미 존재한다.

- 교대 마감 시 `production_records.output_qty`는 확정한다.
- `defect_qty`는 `NULL`로 두며, 이는 0건이 아니라 미검사 상태다.
- 다음날 `PATCH /api/production-records/[recordId]/defect`를 호출한다.
- Supabase RPC `confirm_shift_defect`가 같은 교대 잠금 아래에서 NG 검증·저장·quality/OEE 재계산을 수행한다.
- 운영자 콘솔에는 초록색 `불량 확정 대기` 카드가 존재한다.

관련 코드:

- `src/components/dashboard/operator-console/DefectPendingSection.tsx`
- `src/app/api/production-records/[recordId]/defect/route.ts`
- `src/app/api/production-records/pending/route.ts`
- `supabase/migrations/20260720010000_shift_write_atomicity.sql`

### 2.3 생산 기록 관리 페이지

모든 역할이 `/production-records`에 접근할 수 있다. 운영자는 배정 설비 기록만 조회·수정할 수 있다.

현재 수정 모달은 `output_qty`와 `defect_qty`를 함께 `PUT /api/production-records/[recordId]`로 전송한다. 이 경로는 일반 정정용으로는 필요하지만, 다음날 NG 확정의 주 경로로 쓰기에는 의미와 UI가 맞지 않는다.

관련 코드:

- `src/app/production-records/page.tsx`
- `src/components/production/ProductionRecordList.tsx`
- `src/app/api/production-records/route.ts`
- `src/app/api/production-records/[recordId]/route.ts`
- `src/lib/pageAccess.ts`
- `src/lib/apiAuth.ts`

---

## 3. 실제 운영 상태 증거

### 3.1 배포와 코드 일치

- Vercel 프로덕션 배포 상태: `READY`
- 배포 Git SHA: `39bad7d80465f63b78c24550157eb581cf1e976d`
- 로컬 `main` HEAD: 같은 SHA
- Supabase 프로젝트 상태: `ACTIVE_HEALTHY`

### 3.2 배포된 Supabase 계약

운영 DB에 아래 함수가 존재하며 `service_role`만 실행할 수 있다.

- `report_shift_progress`
- `close_shift_upsert_v3`
- `confirm_shift_defect`
- `downtime_window_digest`

`production_records.defect_qty`는 nullable이다.

### 3.3 2026-08-11 운영 백로그 스냅샷

| 종류 | 업무일 | 교대 | 건수 | 수량 범위 |
|---|---:|:---:|---:|---:|
| 마감 대기 | 2026-08-10 | A | 3 | 29~68 |
| 마감 대기 | 2026-08-10 | B | 757 | 10~578 |
| NG 확정 대기 | 2026-08-10 | B | 11 | 생산량 28~106 |

전체 마감 대기는 760건이다. 이 숫자는 전사 운영 DB 기준이며 특정 운영자 한 명의 담당 건수는 아니다.

실제 예시:

| 설비 | 업무일 | 교대 | 생산량 | NG | quality | OEE |
|---|---:|:---:|---:|---:|---:|---:|
| CNC-683 | 2026-08-10 | B | 56 | `NULL` | `NULL` | `NULL` |

CNC-683은 실제로 NG 미입력 상태다. 하지만 현재 생산 기록 화면은 이를 `0개`로 표시한다.

---

## 4. 현재 워크플로우

```text
현재 교대
  운영자 누적수량 입력
    -> POST /api/production-progress
    -> report_shift_progress RPC
    -> production_progress_reports append-only 저장

교대 종료 + 유예 10분
  지난 교대 최종수량 입력
    -> POST /api/production-records/close-shift
    -> close_shift_upsert_v3 RPC
    -> production_records.output_qty 확정
    -> production_records.defect_qty = NULL

다음날 검사 결과 확인
  NG 수량 입력
    -> PATCH /api/production-records/[recordId]/defect
    -> confirm_shift_defect RPC
    -> defect_qty 확정
    -> quality/OEE 재계산
```

이 2단계 확정 모델은 유지한다. 교대 마감 시 NG를 임의로 0으로 확정하면 안 된다.

---

## 5. 현재 걸림돌 우선순위

### P0-1. NG 미입력 `NULL`이 `0개`로 표시된다

> **2026-08-11 감사 정정 (Claude Code).** 이 항목의 성격과 근본 원인이 아래 서술과 다르다.
>
> 1. **근본 원인은 프런트가 아니라 서버다.** `src/app/api/production-records/route.ts` 의
>    `defect_qty: record.defect_qty || 0` 이 NULL 을 응답 직렬화 시점에 0 으로 바꾼다.
>    프런트 타입만 `number | null` 로 고쳐도 **null 이 브라우저에 도달하지 않으므로** 소용이
>    없다. 아래 "우선 확인할 파일" 목록에 이 라우트가 빠져 있었다.
> 2. **표시 버그가 아니라 데이터 훼손이다.** 목록이 0 을 받아 수정 모달에 prefill 하므로,
>    미검사 행에서 생산량만 고쳐 저장해도 `defect_qty: 0` 이 함께 전송되고 서버는 이를
>    명시적 0 확정으로 해석해 quality/OEE 까지 계산한다. 검사하지 않은 교대가 "불량 0건,
>    품질 100%"로 조용히 확정된다. (서버 `PUT/PATCH` 자체의 NULL 보존은 이미 올바르다 —
>    클라이언트가 0 을 **명시적으로** 보내서 무력화되던 것이다.)
> 3. **집계 경로도 접고 있었다**: `api/oee-data/route.ts`, `api/quality-analysis/route.ts`,
>    `api/productivity-analysis/route.ts`. 미검사 교대가 전량 양품·불량률 0% 로 집계됐다.
>    반면 SQL 쪽(`analytics_*` RPC)은 `sum(output_qty - defect_qty)` 라 NULL 이 전파되어
>    **이미 올바르다** — DB 마이그레이션은 필요 없다.
>
> **실측 노출**: close-shift 경로를 거친 기록은 전체 13건뿐이고 11건이 아직 NULL 이다.
> 훼손 후보는 1건(`CNC-002 / 2026-07-29 A / defect=0`)이며 판별 불가. `audit_log` 에
> `production_records` 행이 없어 귀속은 불가능하나 **백필이 필요한 규모가 아니다.**
>
> **인과**: 피해가 작은 이유가 곧 P0-2 다 — 마감 UI 가 막혀 NULL 행이 13건밖에 생기지
> 않았다. P0-2 를 먼저 고쳤다면 하루 760건이 훼손 가능 상태로 노출됐을 것이다.
> **두 P0 는 반드시 함께 나가야 한다.**

#### 문제

`ProductionRecordList`는 `defect_qty`를 `number`로 선언하고 표시 시 falsy 값을 0으로 접는다.

결과:

- `NULL` 미검사와 실제 NG 0건을 구분할 수 없다.
- 양품수량도 `output_qty - 0`으로 계산되어 전체 생산량이 양품으로 보인다.
- 사용자는 이미 NG 확인이 끝난 것으로 오해할 수 있다.
- 일반 수정 모달은 NG 필드를 required로 취급해, 미검사 상태에서 생산량만 정정하기 어렵다.

#### 반드시 수정할 방향

1. 프런트 타입을 실제 DB 계약과 맞춘다.

   ```ts
   defect_qty: number | null;
   ```

2. 목록 표시를 세 상태로 구분한다.

   - `NULL`: `미검사` 또는 `NG 입력 대기`
   - `0`: `0개`
   - `1 이상`: 위험 색상과 실제 개수

3. `defect_qty === null`이면 양품수량을 숫자로 확정하지 않는다. `미확정` 또는 `—`로 표시한다.
4. 일반 수정 모달에서 생산량만 정정할 때 `NULL`을 강제로 0으로 바꾸지 않는다.
5. `defect_qty || 0`, `defect_qty ?? 0` 사용처를 전역 검색한다.
6. 표현용 0 대체와 계산용 0 대체를 구분한다. 미검사 데이터를 품질 100%로 집계하지 않는다.
7. 한국어·베트남어 번역 키를 함께 추가한다.

#### 우선 확인할 파일

- `src/components/production/ProductionRecordList.tsx`
- `src/types/index.ts`
- `src/types/database.types.ts`
- `src/components/reports/`
- `src/components/quality/`
- `src/components/oee/`
- `public/locales/ko/`
- `public/locales/vi/`

---

### P0-2. 진행 보고가 한 번도 없으면 시프트 후 마감 입력창이 나타나지 않는다

#### 문제

`GET /api/production-records/pending`은 `production_progress_reports`에 행이 있는 교대만 `close_pending`으로 만든다.

따라서 아래 상황은 현재 운영자 대시보드에서 처리할 수 없다.

1. 작업자가 교대 중 누적수량을 한 번도 저장하지 않았다.
2. 교대가 끝난 뒤 종이 카운터를 보고 처음으로 최종수량을 입력하려 한다.
3. `production_progress_reports`가 없으므로 주황색 마감 카드가 생성되지 않는다.

서버 `close-shift` API는 `final_qty`가 있으면 진행 보고 없이도 마감할 수 있다. 현재 결함은 주로 UI 진입 경로다.

#### 반드시 수정할 방향

1. 운영자에게 명시적인 `지난 교대 직접 마감` 진입점을 제공한다.
2. 설비, 업무일, 교대, 최종수량을 선택·입력할 수 있어야 한다.
3. 기본값은 해당 설비의 직전 교대로 잡되, 서버가 최종 허용 여부를 판정한다.
4. 현재·미래 교대는 기존 `isShiftCloseAllowed` 계약으로 거부한다.
5. 이미 확정된 기록이 있으면 조용히 재마감하지 않는다. 기존 기록과 선택 값을 보여주고 일반 정정 경로로 안내하거나 명시적 확인을 받는다.
6. B교대의 업무일은 자정 이후에도 교대 시작일이어야 한다.
7. 운영자는 배정 설비만 처리할 수 있어야 한다.
8. 임의의 클라이언트 날짜 계산만 믿지 말고 서버의 교대 설정·시간대를 최종 기준으로 사용한다.

#### 구현 선택 원칙

- 기존 `close-shift` API와 `close_shift_upsert_v3` RPC를 재사용한다.
- 별도 DB 쓰기 경로를 만들지 않는다.
- `pending` API를 억지로 모든 날짜×교대 조합 생성기로 만들지 않는다.
- 최근 직전 교대 입력 UI 또는 서버가 계산한 마감 가능 후보 API가 더 명확하다.

#### 우선 확인할 파일

- `src/components/dashboard/operator-console/CloseShiftSection.tsx`
- `src/components/dashboard/operator-console/MachineConsole.tsx`
- `src/hooks/useShiftBacklog.ts`
- `src/app/api/production-records/pending/route.ts`
- `src/app/api/production-records/close-shift/route.ts`
- `src/lib/shiftDowntime.ts`
- `src/utils/shiftReportingWindow.ts`
- `src/utils/shiftUtils.ts`

---

### P1-1. 다음날 NG 업무의 주 화면이 없다

#### 문제

운영자 콘솔에는 NG 전용 입력이 있지만 다음 한계가 있다.

- 설비를 하나씩 선택해야 한다.
- 한 설비에서 가장 오래된 NG 대기 1건만 보인다.
- 검색·필터·전체 대기 건수 확인이 어렵다.
- 생산 기록 페이지의 일반 수정 모달은 NG 확정 전용 의미를 갖지 않는다.

#### 제품 방향

`/production-records`를 다음날 NG 업무의 기준 화면으로 만든다.

운영자 콘솔의 초록색 카드는 현장용 빠른 입력 수단으로 유지한다. 두 화면은 같은 전용 API를 사용해야 한다.

#### 반드시 수정할 방향

1. 생산 기록 목록에 `NG 상태` 필터를 추가한다.

   - 전체
   - 미검사/입력 대기 (`defect_qty IS NULL`)
   - 확인 완료 (`defect_qty IS NOT NULL`)

2. 미검사 행에 `NG 확정` 전용 버튼을 제공한다.
3. 전용 버튼은 기존 `PATCH /api/production-records/[recordId]/defect`를 호출한다.
4. 일반 `PUT` 수정 모달을 NG 확정의 기본 경로로 사용하지 않는다.
5. NG는 0 이상 정수이고 생산량을 초과할 수 없다.
6. 저장 후 quality/OEE와 행 상태를 다시 불러온다.
7. 여러 사용자가 동시에 수정하면 409 또는 RPC 결과를 명확한 사용자 문구로 보여준다.
8. 운영자 조회·수정 범위는 배정 설비로 제한한다.
9. 관리자와 엔지니어는 전체 설비를 처리할 수 있다.

#### API 변경 후보

`GET /api/production-records`에 nullable 상태 필터를 추가한다.

예시:

```text
GET /api/production-records?defect_status=pending
GET /api/production-records?defect_status=confirmed
```

허용값이 아니면 400을 반환한다. 운영자 스코프 청크·페이지네이션과 함께 동작해야 한다.

#### 우선 확인할 파일

- `src/components/production/ProductionRecordList.tsx`
- `src/app/api/production-records/route.ts`
- `src/app/api/production-records/[recordId]/defect/route.ts`
- `src/components/dashboard/operator-console/DefectPendingSection.tsx`
- `src/hooks/useShiftBacklog.ts`

---

### P1-2. 760건 마감 대기를 설비별 콘솔에서 하나씩 처리해야 한다

#### 문제

현재 마감 대기 목록은 선택한 설비 한 대에만 로드된다. 전사 기준 760건을 처리하려면 설비를 계속 바꿔야 한다.

무분별한 일괄 자동 마감은 금지한다. 각 설비의 최종 수량이 다르고 종이 카운터를 확인해야 하기 때문이다.

#### 반드시 수정할 방향

1. 생산 기록 관리 또는 별도 관리 화면에 `교대 마감 대기` 큐를 제공한다.
2. 설비명, 업무일, 교대, 마지막 진척, 최종수량 입력, 상태를 한 표에서 처리한다.
3. 서버 페이지네이션과 설비·날짜·교대 필터를 제공한다.
4. 각 행은 개별 확인 후 마감한다.
5. 저장 성공한 행만 목록에서 제거한다.
6. 실패한 행은 입력값을 보존하고 구체적인 실패 사유를 표시한다.
7. 진행 보고가 없는 직전 교대도 명시적으로 추가해 마감할 수 있어야 한다.
8. 다건 처리 중 선택 대상이 폴링으로 바뀌지 않도록 `(machine_id, date, shift)`를 안정 키로 사용한다.

---

### P2-1. 90일 조회 창과 장기 미처리 건

#### 현재 상태

`pending` API는 최근 90일만 조회한다. 현재 운영 DB에는 90일보다 오래된 NG 미입력 건이 없었지만, 코드상 오래된 미마감·미검사 건은 콘솔에서 사라질 수 있다.

#### 수정 방향

1. 현장 콘솔은 최근 90일 제한을 유지해도 된다.
2. 관리자·엔지니어용 대기 큐에서는 날짜 범위를 선택할 수 있어야 한다.
3. 90일 이전 미처리 건이 존재하면 별도 경고 또는 건수를 표시한다.
4. 대규모 전량 Node 집계를 금지하고 DB 필터·페이지네이션을 사용한다.

---

### P2-2. “본인 시프트”의 의미를 명확히 한다

현재 인가 기준은 작업자 소유가 아니라 설비 배정이다.

- 운영자: `assigned_machines`에 포함된 설비만 처리
- 관리자·엔지니어: 전체 설비 처리
- `production_progress_reports.operator_id`는 기록 주체이지 마감 독점권이 아니다.

이번 수정에서 임의로 “최초 입력자만 마감 가능” 규칙을 추가하지 않는다. 교대 인수인계, 결근, 다음날 NG 확인을 막을 수 있기 때문이다.

소유권 제한이 실제 업무 요구라면 별도 제품 결정을 받고 추가한다. 기본 방향은 배정 설비 기반 권한을 유지하고 수정 주체를 감사 기록으로 남기는 것이다.

---

## 6. 반드시 유지할 불변조건

1. `defect_qty = NULL`은 미검사다. 0건과 다르다.
2. quality와 OEE는 NG 미검사 상태에서 계산 완료로 표시하지 않는다.
3. 현재·미래 교대는 마감할 수 없다.
4. 진행 보고 허용 창과 마감 허용 창은 겹치지 않는다.
5. B교대는 자정을 넘지만 업무일은 시작일이다.
6. 누적 진행 수량은 감소할 수 없다.
7. 재마감 시 이미 확정된 NG를 유실하지 않는다.
8. `output_qty < defect_qty` 상태를 만들 수 없다.
9. 운영자는 배정되지 않은 설비를 조회·수정할 수 없다.
10. Service Role을 사용하는 Route Handler는 `requireUser`와 `assertMachineAccess`를 유지한다.
11. 브라우저에서 `production_records`를 직접 수정하지 않는다.
12. 동시 수정은 조용히 덮어쓰지 않고 409 또는 명시적 RPC 결과로 처리한다.
13. 기존 가동률·성능 스냅샷은 다음날 NG 입력 때문에 현재 공정값으로 다시 계산하지 않는다.

---

## 7. 인수 테스트 시나리오

| ID | 시나리오 | 기대 결과 |
|---|---|---|
| A1 | 현재 열린 교대에 누적수량 증가 입력 | 201, 진척 append, 최신값 갱신 |
| A2 | 현재 교대 누적수량 감소 입력 | 409, 마지막 수량 안내 |
| A3 | 교대 종료 전 마감 시도 | 400, 저장 없음 |
| A4 | 교대 종료+유예 후 진행 보고가 있는 교대 마감 | 생산 기록 생성, NG=`NULL` |
| A5 | 교대 종료+유예 후 진행 보고가 없는 교대에 최종수량 직접 입력 | 생산 기록 생성, NG=`NULL` |
| A6 | 미래 교대를 직접 마감 | 거부, 저장 없음 |
| A7 | B교대를 자정 이후 마감 | 교대 시작일에 귀속 |
| A8 | 배정되지 않은 설비를 운영자가 마감 | 403 |
| B1 | NG=`NULL` 행 목록 표시 | `미검사`, 양품수량 `미확정` |
| B2 | NG=0 확정 | `0개`, quality 계산, OEE 조건 충족 시 계산 |
| B3 | NG>0 확정 | 실제 개수 표시, quality/OEE 재계산 |
| B4 | NG가 생산량보다 큼 | 400, 기존 값 유지 |
| B5 | NG 미검사 상태에서 생산량만 정정 | NG는 계속 `NULL`, 0으로 강제되지 않음 |
| B6 | 생산 기록 페이지에서 NG 대기 필터 | `defect_qty IS NULL` 행만 정확히 표시 |
| B7 | 운영자 NG 대기 필터 | 배정 설비 행만 표시 |
| B8 | 동시 NG 확정/일반 수정 | 조용한 덮어쓰기 없음, 최신값 재조회 안내 |
| C1 | 여러 마감 대기 행을 순차 처리 | 대상 키가 바뀌지 않고 성공 행만 제거 |
| C2 | 한 행 저장 실패 | 다른 행과 입력값에 영향 없음 |
| C3 | 90일 이전 대기 조회 | 관리자 큐에서 날짜 범위로 조회 가능 |
| D1 | 한국어 화면 | 신규 상태·버튼·오류 문구 정상 |
| D2 | 베트남어 화면 | 같은 키 구조로 정상 표시 |
| D3 | 모바일 운영자 콘솔 | 입력·버튼·오류가 잘리지 않음 |

---

## 8. 테스트 요구사항

### 8.1 회귀 테스트를 먼저 추가

최소 다음 테스트를 추가하거나 보강한다.

- `ProductionRecordList`가 `defect_qty=null`을 0으로 표시하지 않는다.
- NG 미검사 행의 양품수량을 확정 숫자로 표시하지 않는다.
- 일반 수정이 NG `NULL`을 보존한다.
- `defect_status=pending|confirmed` 필터가 서버 쿼리에 정확히 반영된다.
- 운영자 스코프와 필터·페이지네이션이 함께 동작한다.
- 진행 보고가 없는 지난 교대를 직접 마감할 수 있다.
- 현재·미래 교대 직접 마감은 거부된다.
- 다건 대기 큐의 선택 대상이 갱신 중 바뀌지 않는다.
- NG 전용 버튼이 `/defect` API를 호출한다.
- ko/vi 번역 키 구조가 일치한다.

### 8.2 기존 관련 테스트

- `src/app/api/production-records/close-shift/__tests__/route.test.ts`
- `src/app/api/production-records/pending/__tests__/route.test.ts`
- `src/app/api/production-records/[recordId]/defect/__tests__/route.test.ts`
- `src/app/api/production-records/[recordId]/__tests__/concurrencyGuard.test.ts`
- `src/components/production/__tests__/ProductionRecordList.quantityEdit.test.ts`
- `src/components/production/__tests__/ProgressInputModal.test.tsx`
- `src/utils/__tests__/shiftReportingWindow.test.ts`
- `supabase/tests/shift_write_invariants.sql`

### 8.3 필수 검증 명령

```bash
git diff --check
npm run lint
npx tsc --noEmit --incremental false
npm test -- --runInBand
npm run build
npm run check:migrations
```

DB 변경이 있으면 운영 적용 전 다음을 별도로 확인한다.

- 로컬 migration 파일과 적용 원장 일치
- 새 함수/RPC 권한이 `service_role`로 제한됨
- anon/authenticated 직접 쓰기 권한이 열리지 않음
- rollback 또는 보상 절차 문서화

### 8.4 브라우저 검증

실제 Chrome에서 다음을 역할별로 확인한다.

- operator: 배정 설비만 보임
- operator: 지난 교대 직접 마감
- operator: NG 미검사/0건 구분
- operator: NG 전용 확정
- engineer/admin: 전체 대기 큐 조회
- 모바일 폭: 콘솔 입력과 대기 큐 사용 가능
- loading/error/empty 상태
- ko/vi 전환

---

## 9. 권장 구현 순서

1. 관련 코드·현재 DB 상태 재확인
2. `NULL≠0` 회귀 테스트 추가
3. 생산 기록 목록의 NG 상태·양품수량 표시 수정
4. 일반 수정에서 NG `NULL` 보존
5. 생산 기록 API에 NG 상태 필터 추가
6. 생산 기록 목록에 NG 전용 확정 동작 추가
7. 진행 보고 없는 지난 교대의 직접 마감 UI 추가
8. 마감 대기 큐의 목록·필터·페이지네이션 추가
9. 장기 미처리 조회 경로 추가
10. ko/vi 및 모바일 상태 확인
11. targeted Jest
12. lint → typecheck → full Jest → build → migration check
13. 실제 브라우저 역할별 검증
14. 운영 배포가 필요하면 별도 승인 요청

---

## 10. 하지 말아야 할 수정

- 교대 마감 시 NG 기본값을 0으로 저장하지 않는다.
- 760건을 마지막 진척값으로 자동 일괄 마감하지 않는다.
- `production_records`에 브라우저가 직접 쓰게 하지 않는다.
- 기존 RPC를 우회하는 두 번째 쓰기 경로를 만들지 않는다.
- 운영자에게 전체 설비 조회 권한을 열지 않는다.
- 현재·미래 교대를 클라이언트 확인만으로 허용하지 않는다.
- 이미 적용된 migration을 다시 쓰지 않는다.
- build 성공 하나만으로 완료 처리하지 않는다.
- `defect_qty || 0` 같은 표현으로 미검사 상태를 숨기지 않는다.

---

## 11. 완료 보고 형식

Claude Code는 완료 시 다음 형식으로 보고한다.

```markdown
## 결과
- 해결한 P0/P1/P2 항목
- 사용자 화면에서 달라진 동작

## 변경 파일
- 파일: 변경 이유

## DB 변경
- 새 migration/RPC/권한 변경
- 없으면 "없음"

## 검증
- git diff --check:
- lint:
- typecheck:
- targeted tests:
- full Jest:
- build:
- migration check:
- browser operator:
- browser engineer/admin:
- ko/vi:
- mobile:

## 남은 위험
- 재현하지 못한 동시성
- 운영 적용 전 필요한 승인
- 데이터 백필 여부
```

완료 판정은 다음 조건을 모두 만족해야 한다.

- P0 두 건 해결
- NG 전용 목록·입력 흐름 작동
- 진행 보고 없는 지난 교대 마감 가능
- 배정 설비 권한 유지
- 모든 신규 회귀 테스트 통과
- lint/typecheck/test/build 결과 분리 보고
- 실제 브라우저 검증 증거 확보

---

## 12. 이번 분석의 검증 한계

- 이 문서를 작성한 Codex 세션에서는 사용자의 지시에 따라 실제 생산수량·NG 쓰기를 실행하지 않았다.
- Vercel 프로덕션 코드와 로컬 `main` SHA 일치, Supabase 함수·스키마·실데이터는 확인했다.
- 최근 6시간 close-shift 5xx 로그는 발견되지 않았다.
- 표적 Jest는 이 환경에서 출력 없이 타임아웃되어 통과 증거로 사용하지 않았다. Claude Code에서 반드시 다시 실행한다.
