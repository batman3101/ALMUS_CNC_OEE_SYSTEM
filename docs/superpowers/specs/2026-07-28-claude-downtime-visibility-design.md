# 비가동 가시화 — 1회 경과·누적·사유별 내역

- 날짜: 2026-07-28
- 브랜치: `feature/downtime-visibility-20260728`
- 상태: 설계 확정, 구현 전

## 문제

운영자 콘솔의 비가동 카드는 "비가동 중 · 점검중"과 "가동 재개" 버튼만 보여준다. 작업자와
관리자가 알 수 없는 것이 셋이다.

1. 지금 이 비가동이 **몇 분째**인가
2. 이번 교대에 비가동이 **총 몇 분**인가
3. 각 비가동이 **무슨 사유**였는가

2번은 이미 서버가 계산해 클라이언트로 보내고 있으나(`useRealtimeProgress.downtimeMinutes`)
화면에 렌더되지 않는다. 1번은 `downtimeSince` prop으로 계산 가능하다. 3번만 새 데이터가
필요하다.

## 확정된 결정

| 항목 | 결정 |
|---|---|
| 표시 형태 | 진행 중 경과는 크게, 건별 목록은 접힘(collapse) 안에 |
| 노출 화면 | 운영자 콘솔 + 설비 상세 모달 (공용 컴포넌트) |
| 조회 기간 | ~~두 화면 모두 현재 교대만~~ → **업무일 A+B** (2026-07-28 변경, 아래 개정 이력 참조) |
| 사유 라벨 | 원본 코드를 각각 번역. 어휘 통합 안 함 |
| 사유 정정 | **진행 중인 비가동만**, 시작 시각을 유지한 채 사유를 덮어씀 |
| 구현 접근 | 신규 `GET /api/machines/[machineId]/downtime` |
| 분 반올림 | 단순 반올림. 최대잉여법 배분은 **하지 않음** |

## 배경 사실 (2026-07-28 실측)

### 비가동은 두 테이블에 기록되고, 입력 경로마다 다르다

| 입력 경로 | `downtime_entries` | `machine_logs` |
|---|---|---|
| andon 콘솔 | O | O (트리거) |
| 설비 상태 입력 화면 | X | O (트리거) |
| 교대 데이터 입력 폼 | O | X |

andon 한 번이 **두 테이블에 같은 시간대로** 기록되므로, `machine_downtime_intervals` 뷰의
행을 그대로 나열하면 모든 andon 비가동이 2줄로 보인다. 뷰 자신의 주석도 "겹치는 구간은
소비 측에서 병합해야 한다"고 경고한다.

### 사유 어휘가 두 벌이며 둘 다 현역이다

| 어휘 | 출처 | 값 | 최근 기록 |
|---|---|---|---|
| camelCase | 교대 데이터 입력 폼 | `equipmentFailure`(556) `endmillChange`(412) `plannedStop`(216) `other`(67) `productionModelChange`(58) `pm`(23) `qualityDefect`(5) `materialShortage`(4) | 2026-07-26 |
| UPPER_SNAKE | andon 콘솔 | `INSPECTION`(3) `BREAKDOWN_REPAIR`(1) `PLANNED_STOP`(1) | 2026-07-28 |

"구/신"이 아니라 **동시 사용**이다. 의미가 겹치는 쌍이 있다(`pm`/`PM_MAINTENANCE`,
`plannedStop`/`PLANNED_STOP`, `equipmentFailure`/`BREAKDOWN_REPAIR`,
`endmillChange`/`TOOL_CHANGE`). 통합하지 않기로 했으므로 화면에는 원본이 각각 번역되어
나타난다.

번역 키 경로:

- UPPER_SNAKE → `machines:states.<CODE>` (9개)
- camelCase → `dataInput:downtime.reasons.<code>` (9개)

두 집합의 **교집합은 없다**. 어느 쪽에도 없는 코드는 반드시 폴백이 필요하다.

### 페이로드 크기 — lazy fetch가 불필요하다

최근 10일, (설비 x 날짜 x 교대) 1,298 버킷 기준 비가동 건수는 **평균 1.03건, 최대 3건,
p95 1건**이다. 목록 전체를 매 폴링에 실어도 무의미한 크기이므로 "펼칠 때 조회"라는 상태를
만들지 않는다. 접힘/펼침은 순수 표시 문제로 남는다.

### `description` 컬럼은 비어 있다

`downtime_entries` 1,914건 전부 `description`이 NULL이다. 메모 표시는 지금 데이터로는
가치가 없으므로 범위에서 제외한다.

### 현재 정합성은 깨끗하다

비가동 설비 2대 = 열린 `downtime_entries` 2건 = 열린 비정상 `machine_logs` 2건, 그리고
"설비는 정상인데 열린 비가동 항목이 남은" 유령은 0건이다. 아래 정정 RPC의 "가장 최근 열린
항목 하나만" 제약은 관측된 문제의 수정이 아니라 값싼 보험이다.

## 서버 설계

### 엔드포인트

기존 POST 라우트 파일(`src/app/api/machines/[machineId]/downtime/route.ts`)에 GET을 추가한다.

```
GET /api/machines/[machineId]/downtime?date=YYYY-MM-DD&shift=A|B
```

인증은 같은 파일의 POST 및 `production-progress` GET과 동일하다:
`requireUser(['admin','engineer','operator'])` + `assertMachineAccess`.
교대 창은 `getShiftWindow(date, shift)` — 확정 OEE와 같은 `buildShiftWindows` 산출물이다.

응답:

```ts
{
  shift_start: string;                 // ISO
  shift_end: string;                   // ISO
  // 이 교대 누적. null = 계산 보류(계획정지·휴식 겹침). 0과 구분한다.
  total_minutes: number | null;
  // 진행 중 비가동의 **클립되지 않은** 시작(ISO). null = 진행 중인 비가동 없음.
  ongoing_since: string | null;
  intervals: Array<{
    id: string;                        // source_id — 안정 React key
    source: 'downtime_entry' | 'machine_log';
    reason: string;                    // 원본 코드 그대로. 서버는 번역하지 않는다.
    start: string;                     // ISO, 교대 창에 클립됨
    end: string | null;                // null = 진행 중
    minutes: number;                   // 겹침 배분 후 정수 분
    clipped_start: boolean;            // 교대 시작 경계에서 잘림
  }>;
}
```

`clipped_start`만 있고 `clipped_end`는 없다. 현재 교대만 조회하므로 종료 쪽이 창을 넘는
경우는 "아직 진행 중"(`end === null`)으로 이미 표현되고, 이전 교대에서 넘어온 비가동만
시작이 잘린다. 조회 기간이 확장되면 그때 `clipped_end`를 추가한다.

`total_minutes`는 **기존 `calculateVerifiedDowntimeMinutesForWindow`를 그대로 호출**한다.
새 합계 계산을 만들지 않으므로 확정 OEE·실시간 가동률과 어긋날 수 없다.

### 중복 제거 — `downtime_entries` 우선, `machine_logs`는 잔여만

신규 순수 모듈 `src/utils/downtimeBreakdown.ts`:

1. 각 행을 `[start, min(end ?? now, window.end))`로 만들고 교대 창에 클립한다
2. `downtime_entries`를 시작 시각 오름차순으로 배분한다 — 먼저 시작한 쪽이 겹침을 소유
3. `machine_logs`는 `downtime_entries` union을 뺀 **잔여 구간만** 소유한다 (`subtractIntervals`)
4. 배분 결과가 0분인 행은 버린다 — 버려진 행은 총합에 0을 기여하므로 숨겨지는 시간은
   없다. 이는 표시 노이즈 제거이지 데이터 절삭이 아니다
5. 불변조건: **배분된 ms의 합 === union ms**

3번이 andon 쌍둥이 행을 자동으로 없애면서 설비 상태 입력 경로의 정지는 그대로 살린다.
4번은 andon 이중 로그 사고(2026-07-20)의 잔여 0분 유령 행에 대한 방어를 겸한다.

`mergeIntervals` / `subtractIntervals` / `clipInterval`은 `src/utils/downtimeIntervals.ts`에
이미 있고 테스트도 있으므로 조합만 한다.

행별 `minutes`는 단순 반올림한다. 표시된 정수의 합이 `total_minutes`와 최대 1분 어긋날 수
있음을 알고 수용한 결정이다(최대잉여법 배분은 채택하지 않음).

### 사유 정정

`PATCH /api/machines/[machineId]/downtime`, body `{ reason }`.
같은 파일의 `DOWNTIME_REASONS` 8개로 검증한다.

신규 RPC `correct_open_downtime_reason(p_machine_id uuid, p_reason text, p_operator_id uuid)`:
`toggle_machine_downtime`과 **같은 advisory lock 키**를 잡아 정정과 토글이 경쟁하지 않게 한다.

```
current_state = 'NORMAL_OPERATION'  ->  { ok:false, reason:'not_in_downtime' }
current_state = p_reason            ->  { ok:true,  noop:true }
그 외:
  set_config('app.suppress_status_log', '1', true)     -- 트랜잭션 로컬
  machine_logs.state      := p_reason   (end_time is null 인 행)
  downtime_entries.reason := p_reason   (열린 행 중 start_time 최신 1건만)
  machines.current_state  := p_reason
  audit_log 기록: action='correct_downtime_reason', old_values/new_values/changed_by
```

`audit_log` 스키마는 확인됨: `table_name, record_id, action, old_values, new_values,
changed_by, created_at`.

열린 `downtime_entries`가 0건인 경우(설비 상태 입력 화면으로만 내려간 설비)에는
`machine_logs`만 정정된다. 이는 올바른 동작이며, 응답에 어느 소스가 갱신됐는지 싣는다.

### 트리거 변경 — 이 설계에서 가장 위험한 부분

`machines.current_state`를 UPDATE하면 `log_machine_status_change()`가 **무조건** 열린 로그를
닫고 새 로그를 연다. 즉 트리거가 분할을 강제한다. 정정을 하려면 트리거에게 "이건 전환이
아니라 정정"이라고 알려야 한다. 함수 맨 앞에 추가:

```sql
if coalesce(nullif(current_setting('app.suppress_status_log', true), ''), '0') = '1' then
  return new;   -- 정정: 전환이 아니므로 로그를 분할하지 않는다
end if;
```

이 트리거는 `machine_logs`의 **유일한 writer**다(2026-07-14 일원화 원칙). 플래그가 잘못
켜지면 상태 변경이 조용히 기록되지 않는다. 방어 세 가지:

1. `set_config(..., true)`는 트랜잭션 로컬이므로 다른 트랜잭션으로 새지 못한다
2. 정정 RPC 외에는 아무도 설정하지 않는다
3. **마이그레이션 테스트로 회귀를 고정한다**: 일반 상태 전환은 여전히 로그를 남긴다

`app.status_operator_id`가 이미 같은 GUC 방식으로 쓰이고 있으므로 선례는 있다
(`20260718000004`).

## 클라이언트 설계

### 컴포넌트 경계 — 읽기와 상태 전이 쓰기를 분리한다

```
src/components/downtime/
  DowntimeBreakdownCard.tsx   신규: 경과 + 누적 + 건별 목록 (+ 정정)
  index.ts
```

기존 `DowntimeAndonSection`은 상태 전이 버튼(비가동 시작 / 가동 재개)만 유지한다.

```ts
interface Props {
  machineId: string;
  date: string;            // 교대 창은 반드시 주입 — 컴포넌트가 "지금 교대"를 추측하지 않는다
  shift: 'A' | 'B';
  onCorrected: () => void;
  allowCorrection?: boolean;      // 기본 false. 운영자 콘솔만 true
}
```

**설비 상태와 비가동 시작 시각은 prop 으로 받지 않는다.** 계획 작성 중에 드러난 사실:
`Machine` 타입에는 비가동 시작 시각을 담는 필드가 아예 없다(`id, name, current_state?,
updated_at?` 뿐). 즉 설비 상세 모달은 그 값을 넘길 방법이 없다.

카드가 조회하는 데이터에 이미 답이 있으므로(`end === null` 인 행 + `ongoing_since`) 두 prop
을 제거한다. 부수 효과로 "두 화면이 서로 다른 소스에서 비가동 상태를 읽는" 위험도 사라진다.
경과 시간은 목록의 `start`(교대 창에 클립됨)가 아니라 `ongoing_since`(원본)로 재야 이전
교대에서 이어진 비가동이 실제보다 짧게 표시되지 않는다.

- **운영자 콘솔**: `MachineConsole`의 비가동 카드 안에 `DowntimeBreakdownCard`
  (`allowCorrection`) + `DowntimeAndonSection`을 함께 렌더한다
- **설비 상세 모달**: `MachineDetailModal`은 `machine` prop만 받아 날짜·교대 컨텍스트가
  없다. `getCurrentShiftInfo()`로 `date`/`shift`를 해결해 주입하고 `allowCorrection`은
  생략한다(읽기 전용)

누적 분은 **새 엔드포인트의 `total_minutes`만** 쓴다. `production-progress`의 값을 prop으로
받아 섞지 않는다. 같은 함수·같은 창이라 값은 동일하지만, 두 경로를 한 화면에 두면 나중에
한쪽만 바뀌었을 때 어긋난다.

### 표시 규칙

```
+-- 비가동 -------------------------------+
| (!) 점검중 · 23분 경과 (14:39~)         |   <- currentState != NORMAL 일 때만
|     누적 3건 · 60분                     |
|                                         |
| > 비가동 내역 보기 (3건)                |
|   09:12~09:30   18분  ENDMILL 교체      |
|   11:05~11:24   19분  설비 고장         |
|   14:39~진행중  23분  점검중     [정정] |
|                                         |
| [ > 가동 재개 ]                         |
+-----------------------------------------+
```

| 상황 | 표시 |
|---|---|
| `total_minutes === null` | 누적을 `—` + "계획정지·휴식 겹침으로 계산 보류". 절대 0분으로 쓰지 않는다 |
| 조회 실패 | 누적 `—`, 목록 자리에 오류 + 재시도. 0건과 구분한다 |
| 0건 | "이번 교대 비가동 없음" — 이건 진짜 0분이다(현장 규칙: 비가동은 발생 시에만 기록) |
| 교대 시작 경계에서 잘린 행 | 시작 시각 앞에 잘림 표시 (B교대 자정 교차) |

경과 시간은 카드 내부 10초 인터벌로 갱신한다. 지속 시간 포맷은 담당 설비 카드의
"19시간 22분" 스타일을 재사용한다.

### 알려진 표시 특성 — 구간 길이와 분이 다를 수 있다

Task 1 코드 검토(2026-07-28)에서 확인된 사항이다. 한 행의 소유 구간은 **둘로 쪼개질 수
있다**. 예를 들어 `machine_log` 02:00~03:00 이 `downtime_entry` 02:10~02:20 을 감싸면,
로그의 소유분은 02:00~02:10 과 02:20~03:00 두 조각(합 50분)이다. 그런데 화면에는
`start`/`end` 가 전체 구간(02:00~03:00, 60분처럼 보임)으로, `minutes` 는 소유분(50분)으로
나간다.

이는 의도된 동작이다. 소유분만 세지 않으면 건별 합계가 누적을 초과한다 — 불변조건이
깨진다. 대신 사용자가 "02:00~03:00 인데 왜 50분인가"라고 물을 수 있는 지점이므로,
운영 중 실제로 혼란이 보고되면 그때 소유 구간을 그대로 표시하는 방식(한 사유가 여러 줄)을
검토한다. 지금은 줄 수가 늘어나는 비용이 더 크다고 판단해 채택하지 않는다.

### i18n

`resolveDowntimeReasonLabel(reason, t)`가 `machines:states.<CODE>` -> `dataInput:downtime.
reasons.<code>` 순으로 시도한다. 두 사전 어디에도 없는 코드의 폴백은 원문 코드를 노출하는
쪽으로 한다 — "기타"로 뭉개면 데이터 문제가 화면에서 사라진다.

새로 추가하는 문구는 `ko`/`vi` 양쪽에 동일한 키 구조로 넣는다.

## 검증

| 대상 | 확인 |
|---|---|
| `buildDowntimeBreakdown` (순수) | andon 이중 기록 -> 1행, `machine_logs` 단독 정지 -> 살아남음, 겹침 배분, B교대 자정 클립, 진행 중 행, 0분 행 제거 |
| 불변조건 | `total_minutes !== null`이면 배분 ms 합 === union ms (정확 일치) |
| GET 라우트 | 200 / 400(date·shift) / 401 / 403(담당 외 설비) |
| PATCH 라우트 | 200 / 400(사유 아님) / 409(`not_in_downtime`) / 403 |
| 마이그레이션 | 정정은 로그를 분할하지 않음 **+ 일반 전환은 여전히 로그를 남김** |
| 컴포넌트 | `total_minutes: null` -> `—` 렌더(0%가 아님), 조회 실패 != 0건 |
| 원장 | `rolePolicy.test.ts`에 `machines/[machineId]/downtime: { GET: AEO, PATCH: AEO, POST: AEO }` |

`npm run lint`, `npx tsc --noEmit`, `npm test`, `npm run check:migrations`를 모두 확인한다.

## 배포 경계

`npm run check:migrations`는 원장(`supabase/applied-migrations.json`)에 없는 로컬 `.sql`에
대해 exit 1이다. 새 마이그레이션은 승인 전까지 `intentionally_skipped`에 "사용자 승인 전 —
미적용" 사유로 등록한다. 게이트는 통과하면서 미적용 상태가 `skip` 줄로 드러난다. 적용
시점에 skip에서 빼고 `applied` + `hashes`로 옮긴다.

**이 브랜치에서 SQL을 운영에 적용하지 않고, main 병합도 하지 않는다.** 두 작업 모두
사용자가 명시적으로 지시할 때만 진행한다.

## 범위 밖

- 사유 어휘 통합·정규화
- 지난 교대 / 일 단위 / 기간 조회 (기존 비가동 분석 화면이 담당)
- 종료된 비가동의 사유 수정 (확정된 OEE 스냅샷 재집계 문제로 이어진다)
- `description` 메모 표시 (데이터가 전부 비어 있다)
- 설비 목록 카드에 누적 비가동 추가 (목록 단위 집계 -> N+1 위험)
- **근무조(crew) 추적** — 아래 개정 이력 2번 참조

## 개정 이력

### 1. 업무일 A+B 로 범위 변경 (2026-07-28, 구현 후)

초판은 "현재 교대만"이었으나 사용자 판단으로 **업무일 A+B**로 바꿨다.

- 시간창은 `buildBusinessRange(date, date, tz, shiftAStart)` = `[A교대 시작, 다음날 A교대 시작)`.
  교대 창 두 개를 만들어 병합하지 않는다 — 그 함수가 곧 업무일 한 덩어리다.
- API 는 `shift` 파라미터를 받지 않는다. `date` 하나뿐이다.
- 시간대별 소계 `shift_totals.day / .night` 를 함께 내려 "야간에 뭐가 멈췄나"를 볼 수 있게 한다.
  각 소계는 **같은 total 함수를 각 교대 창에 적용한 결과**이므로 `day + night` 는 업무일
  총합과 맞는다.
- **목록은 경계에서 쪼개지 않는다.** 19:50~20:30 비가동은 주간 10분·야간 30분으로 소계에
  나뉘어 기여하지만, 목록에는 실제 시각을 가진 한 줄로 남는다. 쪼개면 하나의 물리적
  비가동이 두 줄로 보여 "고장이 두 번 났나?"가 된다. 대가로 **목록의 분 합계는 소계와
  행 단위로 맞지 않는다** — 그래서 소계를 목록 안이 아니라 누적 줄 옆에 둔다.

### 2. A/B 는 근무조가 아니라 시간대다 (2026-07-28)

현장에서 A조·B조는 **교대로 주간과 야간을 오간다**. 그런데 이 시스템의 `shift` 컬럼은
`getShiftAt()` 이 **시계 시각만으로** 정하므로 `'A'` 는 언제나 08:00~20:00 구간을 뜻한다.
근무조를 담는 컬럼은 스키마 어디에도 없다(crew/team/group 계열 0개, 2026-07-28 확인).

따라서 **데이터는 오염되지 않았다.** `'A'` 로 저장된 행은 전부 실제로 주간 구간이 맞다.
문제는 읽는 쪽이다 — 사람이 "A교대 47분"을 "우리 조"로 읽는다.

결정:
- **화면에서 A/B 글자를 뺀다.** 주간 / 야간으로 표기하고, 시각은 설정값이므로 하드코딩하지
  않고 API 가 내려준 `shift_totals.*.start/end` 를 그린다.
- **DB·API 의 `shift` 값은 그대로 둔다.** 다른 화면·리포트가 쓰고 있고, 의미를 바꾸면
  325k 행의 뜻이 소급 변경된다.
- **A/B 의 의미를 조(crew)로 바꾸지 않는다.** 그러면 `buildShiftWindows`·`getShiftAt`·확정
  OEE·모든 날짜 범위 쿼리가 회전 캘린더에 의존하게 되고, 과거 데이터의 `'A'` 가 무슨
  뜻인지 알 수 없게 된다. 시간대와 조는 직교하는 두 축이라 한 글자에 겹쳐 담으면 안 된다.
- 근무조 추적이 필요해지면 **별도 컬럼**(예: `production_records.crew`)과 회전 캘린더로
  더한다. 이번 범위 밖이다.

### 3. 응답 계약을 한 곳에 정의 (2026-07-28)

업무일 전환에서 서버 계약이 통째로 바뀌었는데(파라미터 제거, 필드 이름 변경, 의미 변경)
`tsc --noEmit` 가 **오류를 하나도 내지 않았다.** 훅이 `res.json() as { ... }` 로 응답 모양을
따로 적어 두고 단언했기 때문이다. 클라이언트는 여전히 무시되는 `shift` 를 보내면서 업무일
숫자를 교대 숫자로 알고 그리는 상태였다 — 조용히 틀린 화면.

`DowntimeBreakdownResponse` 를 `src/utils/downtimeBreakdown.ts`(라우트와 훅이 이미 둘 다
import 하는 모듈)에 정의해 양쪽이 공유한다. 다음 계약 변경은 컴파일이 막는다.
