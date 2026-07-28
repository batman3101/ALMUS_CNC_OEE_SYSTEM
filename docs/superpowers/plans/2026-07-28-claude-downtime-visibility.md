# 비가동 가시화 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영자 콘솔과 설비 상세 모달에서 현재 교대의 비가동을 "진행 중 경과 시간 + 누적 시간 + 건별 사유 목록"으로 보고, 진행 중인 비가동의 사유를 시작 시각 유지한 채 정정할 수 있게 한다.

**Architecture:** 서버가 `downtime_entries` ∪ `machine_logs`를 읽어 교대 창에 클립하고, `downtime_entries` 우선 / `machine_logs` 잔여 규칙으로 겹침을 배분해 건별 목록을 만든다(신규 순수 모듈). 누적 합계는 확정 OEE와 **동일한 기존 함수**를 그대로 호출한다. 클라이언트는 공용 카드 컴포넌트 하나를 운영자 콘솔과 설비 상세 모달 양쪽에서 재사용한다. 사유 정정은 트랜잭션 로컬 GUC로 상태 로그 트리거의 분할 동작을 억제하는 신규 RPC로 처리한다.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript 5, Ant Design 5, Supabase(PostgreSQL + RPC), Jest + Testing Library, react-i18next

**설계 문서:** `docs/superpowers/specs/2026-07-28-claude-downtime-visibility-design.md`

> **주의 — 같은 기능을 두 에이전트가 병행 작업 중이다.** Codex 는
> `feature/codex-2026-07-28-downtime-details` 에서 `2026-07-28-downtime-summary-*` 문서로
> **다른 설계**를 구현하고 있다(비가동 소스를 `downtime_entries` 로만 한정, 업무일 A+B 범위).
> 이 계획은 `feature/claude-2026-07-28-downtime-visibility` 브랜치 전용이며, 두 소스의
> 유니온과 현재 교대 범위를 쓴다. 두 산출물을 섞지 말 것.

---

## 배포 경계 (모든 태스크에 적용)

- **SQL을 운영 DB에 적용하지 않는다.** 마이그레이션은 파일로만 만들고, `supabase/applied-migrations.json`의 `intentionally_skipped`에 등록해 `npm run check:migrations`를 통과시킨다.
- **main에 병합하지 않는다.** 작업은 `feature/downtime-visibility-20260728` 브랜치에서만 한다.
- 두 작업 모두 사용자가 명시적으로 지시할 때만 진행한다.

---

## File Structure

### 신규 파일

| 경로 | 책임 |
|---|---|
| `src/utils/downtimeBreakdown.ts` | **순수**. 비가동 원천 행 → 겹침 배분된 건별 구간. 불변조건(합 = union)을 소유 |
| `src/utils/__tests__/downtimeBreakdown.test.ts` | 위 모듈의 단위 테스트 + 불변조건 테스트 |
| `src/hooks/useDowntimeBreakdown.ts` | GET 조회 훅. `useRealtimeProgress`와 동일한 요청 순번 가드 규율 |
| `src/utils/downtimeReasonLabel.ts` | 두 사유 어휘(camelCase / UPPER_SNAKE)를 라벨로 변환 |
| `src/utils/__tests__/downtimeReasonLabel.test.ts` | 라벨 해석기 테스트 |
| `src/components/downtime/DowntimeBreakdownCard.tsx` | 경과 + 누적 + 건별 목록 + 정정 UI |
| `src/components/downtime/index.ts` | 배럴 export |
| `src/components/downtime/__tests__/DowntimeBreakdownCard.test.tsx` | 컴포넌트 테스트 |
| `supabase/migrations/20260728010000_correct_open_downtime_reason.sql` | 트리거 억제 플래그 + 정정 RPC |
| `src/app/__tests__/correctDowntimeReasonMigration.test.ts` | 마이그레이션 SQL 텍스트 계약 테스트 |

### 수정 파일

| 경로 | 변경 |
|---|---|
| `src/lib/shiftDowntime.ts` | `loadDowntimeDetailRows` 추가. 기존 `loadDowntimeSourceRows`를 그 위에 재구현(드리프트 방지) |
| `src/app/api/machines/[machineId]/downtime/route.ts` | `GET`, `PATCH` 추가 |
| `src/app/api/machines/[machineId]/downtime/__tests__/route.test.ts` | GET·PATCH 테스트 추가 |
| `src/app/api/__tests__/rolePolicy.test.ts` | 정책 원장에 `GET`/`PATCH` 등록 |
| `src/components/dashboard/operator-console/MachineConsole.tsx` | 비가동 카드에 `DowntimeBreakdownCard` 렌더 |
| `src/components/machines/MachineDetailModal.tsx` | 읽기 전용으로 `DowntimeBreakdownCard` 렌더 |
| `public/locales/ko/machines.json` | `downtimeBreakdown` 키 그룹 추가 |
| `public/locales/vi/machines.json` | 동일 키 구조 추가 |
| `supabase/applied-migrations.json` | 신규 마이그레이션을 `intentionally_skipped`에 등록 |

---

## Task 1: 비가동 배분 순수 모듈

목록 계산의 심장이다. andon이 두 테이블에 같은 시간대를 쓰기 때문에, 단순히 행을 나열하면 모든 andon 비가동이 2줄로 보인다. 이 모듈이 그걸 막는다.

**Files:**
- Create: `src/utils/downtimeBreakdown.ts`
- Test: `src/utils/__tests__/downtimeBreakdown.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/utils/__tests__/downtimeBreakdown.test.ts`:

```ts
import {
  allocateDowntimeOwnership,
  buildDowntimeBreakdown,
  type DowntimeSourceRow,
} from '@/utils/downtimeBreakdown';
import { calculateDowntimeMinutesForWindow } from '@/app/api/production-records/daily/downtimeCalculation';
import type { Interval } from '@/utils/downtimeIntervals';

// A교대 2026-07-28 08:00~20:00 (Asia/Ho_Chi_Minh = UTC+7 → UTC 01:00~13:00)
const WINDOW: Interval = {
  start: Date.parse('2026-07-28T01:00:00.000Z'),
  end: Date.parse('2026-07-28T13:00:00.000Z'),
};
const NOW = Date.parse('2026-07-28T07:00:00.000Z'); // 교대 중간

const row = (over: Partial<DowntimeSourceRow> & { id: string }): DowntimeSourceRow => ({
  source: 'downtime_entry',
  reason: 'INSPECTION',
  start_time: '2026-07-28T02:00:00.000Z',
  end_time: '2026-07-28T02:30:00.000Z',
  ...over,
});

describe('buildDowntimeBreakdown', () => {
  it('andon 이중 기록(두 소스 같은 시간대)을 1행으로 접는다', () => {
    const rows = [
      row({ id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION' }),
      row({ id: 'ml-1', source: 'machine_log', reason: 'INSPECTION' }),
    ];
    const out = buildDowntimeBreakdown(rows, WINDOW, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe('de-1');
    expect(out[0].source).toBe('downtime_entry');
    expect(out[0].minutes).toBe(30);
  });

  it('machine_logs 단독 정지는 살아남는다', () => {
    const rows = [
      row({ id: 'ml-1', source: 'machine_log', reason: 'TOOL_CHANGE' }),
    ];
    const out = buildDowntimeBreakdown(rows, WINDOW, NOW);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe('machine_log');
    expect(out[0].minutes).toBe(30);
  });

  it('machine_logs 는 downtime_entries 가 덮지 않은 잔여만 소유한다', () => {
    const rows = [
      row({
        id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
        start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:30:00.000Z',
      }),
      row({
        id: 'ml-1', source: 'machine_log', reason: 'INSPECTION',
        start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:50:00.000Z',
      }),
    ];
    const out = buildDowntimeBreakdown(rows, WINDOW, NOW);
    expect(out).toHaveLength(2);
    expect(out.find(r => r.id === 'de-1')!.minutes).toBe(30);
    expect(out.find(r => r.id === 'ml-1')!.minutes).toBe(20);
  });

  it('먼저 시작한 downtime_entry 가 겹침을 소유한다', () => {
    const rows = [
      row({
        id: 'late', start_time: '2026-07-28T02:20:00.000Z', end_time: '2026-07-28T02:50:00.000Z',
      }),
      row({
        id: 'early', start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:30:00.000Z',
      }),
    ];
    const out = buildDowntimeBreakdown(rows, WINDOW, NOW);
    expect(out.find(r => r.id === 'early')!.minutes).toBe(30);
    expect(out.find(r => r.id === 'late')!.minutes).toBe(20);
  });

  it('완전히 가려진 행은 버린다 (0분 유령 행)', () => {
    const rows = [
      row({ id: 'outer', start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T03:00:00.000Z' }),
      row({ id: 'inner', start_time: '2026-07-28T02:10:00.000Z', end_time: '2026-07-28T02:20:00.000Z' }),
    ];
    const out = buildDowntimeBreakdown(rows, WINDOW, NOW);
    expect(out.map(r => r.id)).toEqual(['outer']);
  });

  it('시작 시각이 같으면 end_time = start_time 인 행은 애초에 제외된다', () => {
    const rows = [
      row({ id: 'ghost', start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:00:00.000Z' }),
    ];
    expect(buildDowntimeBreakdown(rows, WINDOW, NOW)).toEqual([]);
  });

  it('진행 중인 행은 end = null 이고 now 까지 계산한다', () => {
    const rows = [
      row({ id: 'open', start_time: '2026-07-28T06:00:00.000Z', end_time: null }),
    ];
    const out = buildDowntimeBreakdown(rows, WINDOW, NOW);
    expect(out[0].end).toBeNull();
    expect(out[0].minutes).toBe(60); // 06:00 → NOW 07:00
  });

  it('이전 교대에서 이어진 행은 교대 시작에 클립하고 clipped_start 를 세운다', () => {
    const rows = [
      row({
        id: 'carry', start_time: '2026-07-28T00:30:00.000Z', end_time: '2026-07-28T01:30:00.000Z',
      }),
    ];
    const out = buildDowntimeBreakdown(rows, WINDOW, NOW);
    expect(out[0].clipped_start).toBe(true);
    expect(out[0].start).toBe('2026-07-28T01:00:00.000Z');
    expect(out[0].minutes).toBe(30);
  });

  it('교대 창 밖의 행은 제외한다', () => {
    const rows = [
      row({ id: 'before', start_time: '2026-07-27T20:00:00.000Z', end_time: '2026-07-27T21:00:00.000Z' }),
    ];
    expect(buildDowntimeBreakdown(rows, WINDOW, NOW)).toEqual([]);
  });

  it('시작 시각 오름차순으로 정렬한다', () => {
    const rows = [
      row({ id: 'c', start_time: '2026-07-28T05:00:00.000Z', end_time: '2026-07-28T05:10:00.000Z' }),
      row({ id: 'a', start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:10:00.000Z' }),
      row({ id: 'b', start_time: '2026-07-28T03:00:00.000Z', end_time: '2026-07-28T03:10:00.000Z' }),
    ];
    expect(buildDowntimeBreakdown(rows, WINDOW, NOW).map(r => r.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('불변조건: 배분된 시간의 합 = 합집합', () => {
  const cases: Array<{ name: string; rows: DowntimeSourceRow[] }> = [
    {
      name: 'andon 이중 기록',
      rows: [
        row({ id: 'de-1', source: 'downtime_entry' }),
        row({ id: 'ml-1', source: 'machine_log' }),
      ],
    },
    {
      name: '부분 겹침 3건 + machine_log 잔여',
      rows: [
        row({ id: 'a', start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:40:00.000Z' }),
        row({ id: 'b', start_time: '2026-07-28T02:30:00.000Z', end_time: '2026-07-28T03:10:00.000Z' }),
        row({ id: 'c', start_time: '2026-07-28T04:00:00.000Z', end_time: '2026-07-28T04:15:00.000Z' }),
        row({
          id: 'ml', source: 'machine_log',
          start_time: '2026-07-28T02:50:00.000Z', end_time: '2026-07-28T03:40:00.000Z',
        }),
      ],
    },
    {
      name: '진행 중 + 이전 교대 이월',
      rows: [
        row({ id: 'carry', start_time: '2026-07-28T00:30:00.000Z', end_time: '2026-07-28T01:30:00.000Z' }),
        row({ id: 'open', start_time: '2026-07-28T06:00:00.000Z', end_time: null }),
      ],
    },
  ];

  it.each(cases)('$name — 소유 구간의 ms 합이 합집합 ms 와 정확히 같다', ({ rows }) => {
    const owned = allocateDowntimeOwnership(rows, WINDOW, NOW);
    const allocatedMs = owned.reduce(
      (sum, item) => sum + item.owned.reduce((s, i) => s + (i.end - i.start), 0),
      0
    );
    const unionMinutes = calculateDowntimeMinutesForWindow(
      rows.map(r => ({ start_time: r.start_time, end_time: r.end_time })),
      WINDOW,
      NOW
    );
    expect(allocatedMs / 60000).toBeCloseTo(unionMinutes, 6);
  });

  it('소유 구간끼리는 서로 겹치지 않는다', () => {
    const rows = cases[1].rows;
    const all = allocateDowntimeOwnership(rows, WINDOW, NOW)
      .flatMap(item => item.owned)
      .sort((l, r) => l.start - r.start);
    for (let i = 1; i < all.length; i++) {
      expect(all[i].start).toBeGreaterThanOrEqual(all[i - 1].end);
    }
  });
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run: `npm test -- src/utils/__tests__/downtimeBreakdown.test.ts`
Expected: FAIL — `Cannot find module '@/utils/downtimeBreakdown'`

- [ ] **Step 3: 모듈 구현**

`src/utils/downtimeBreakdown.ts`:

```ts
import {
  mergeIntervals,
  subtractIntervals,
  type Interval,
} from '@/utils/downtimeIntervals';

export type DowntimeSource = 'downtime_entry' | 'machine_log';

/** 비가동 원천 행. downtime_entries 와 machine_logs 를 같은 모양으로 정규화한 것. */
export interface DowntimeSourceRow {
  id: string;
  source: DowntimeSource;
  /** 원본 코드 그대로(camelCase 또는 UPPER_SNAKE). 이 모듈은 번역하지 않는다. */
  reason: string;
  start_time: string;
  /** null = 진행 중 */
  end_time: string | null;
}

/** 화면에 그릴 한 줄. */
export interface DowntimeBreakdownRow {
  id: string;
  source: DowntimeSource;
  reason: string;
  /** 교대 창에 클립된 시작(ISO) */
  start: string;
  /** null = 이 교대 안에서 아직 진행 중. 그 외에는 클립된 종료(ISO) */
  end: string | null;
  /** 겹침 배분 후 소유 시간(정수 분) */
  minutes: number;
  /** 이전 교대에서 이어져 시작이 잘렸는가 */
  clipped_start: boolean;
}

/** 창에 클립된 한 행. allocateDowntimeOwnership 의 반환 타입에 나타나므로 export 한다. */
export interface PreparedDowntimeSpan {
  row: DowntimeSourceRow;
  /** 교대 창에 클립된 표시용 구간 */
  span: Interval;
  clippedStart: boolean;
  ongoing: boolean;
}

const prepare = (
  row: DowntimeSourceRow,
  window: Interval,
  nowMs: number
): PreparedDowntimeSpan | null => {
  const rawStart = Date.parse(row.start_time);
  const rawEnd = row.end_time === null ? nowMs : Date.parse(row.end_time);
  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd)) return null;

  const start = Math.max(rawStart, window.start);
  const end = Math.min(rawEnd, window.end);
  // 길이 0 이하는 구간이 아니다. andon 이중 로그 사고의 end_time = start_time 유령 행이
  // 여기서 걸러진다.
  if (end <= start) return null;

  return {
    row,
    span: { start, end },
    clippedStart: rawStart < window.start,
    ongoing: row.end_time === null && nowMs < window.end,
  };
};

/**
 * 각 행이 **배타적으로 소유하는** 구간을 계산한다.
 *
 * 비가동은 두 테이블에 기록되고 andon 은 **양쪽에 같은 시간대를** 쓴다. 그대로 나열하면
 * 모든 andon 비가동이 두 줄이 된다. 그래서 소유 규칙을 둔다:
 *
 *   1. `downtime_entries` 가 우선한다 — 작업자가 고른 사유를 담고 있다.
 *   2. 같은 소스 안에서는 **먼저 시작한 쪽이 겹침을 소유**한다(안정적인 귀속 규칙).
 *   3. `machine_logs` 는 `downtime_entries` 가 덮지 않은 **잔여만** 소유한다.
 *      andon 쌍둥이는 잔여가 0 이 되어 사라지고, 설비 상태 입력 화면으로만 내려간
 *      정지는 그대로 살아남는다.
 *
 * 결과의 소유 구간들은 서로 겹치지 않고, 그 합은 전체 합집합과 정확히 같다.
 * 이 불변조건이 "건별 시간의 합이 누적과 다르다"를 구조적으로 불가능하게 만든다.
 */
export function allocateDowntimeOwnership(
  rows: DowntimeSourceRow[],
  window: Interval,
  nowMs: number
): Array<{ prepared: PreparedDowntimeSpan; owned: Interval[] }> {
  const prepared = rows
    .map(row => prepare(row, window, nowMs))
    .filter((item): item is PreparedDowntimeSpan => item !== null);

  const byStart = (left: PreparedDowntimeSpan, right: PreparedDowntimeSpan) =>
    left.span.start - right.span.start;
  const ordered = [
    ...prepared.filter(item => item.row.source === 'downtime_entry').sort(byStart),
    ...prepared.filter(item => item.row.source === 'machine_log').sort(byStart),
  ];

  let claimed: Interval[] = [];
  return ordered.map(item => {
    const owned = subtractIntervals([item.span], claimed);
    claimed = mergeIntervals([...claimed, item.span]);
    return { prepared: item, owned };
  });
}

/**
 * 화면용 건별 목록. 소유 시간이 전혀 없는 행(다른 행에 완전히 가려진 andon 쌍둥이)은
 * 버린다 — 그 행은 총합에 0 을 기여하므로 숨겨지는 시간은 없다. 표시 노이즈 제거이지
 * 데이터 절삭이 아니다.
 */
export function buildDowntimeBreakdown(
  rows: DowntimeSourceRow[],
  window: Interval,
  nowMs: number
): DowntimeBreakdownRow[] {
  return allocateDowntimeOwnership(rows, window, nowMs)
    .filter(({ owned }) => owned.length > 0)
    .map(({ prepared, owned }) => ({
      id: prepared.row.id,
      source: prepared.row.source,
      reason: prepared.row.reason,
      start: new Date(prepared.span.start).toISOString(),
      end: prepared.ongoing ? null : new Date(prepared.span.end).toISOString(),
      minutes: Math.round(
        owned.reduce((sum, interval) => sum + (interval.end - interval.start), 0) / 60000
      ),
      clipped_start: prepared.clippedStart,
    }))
    .sort((left, right) => Date.parse(left.start) - Date.parse(right.start));
}
```

- [ ] **Step 4: 테스트를 실행해 통과를 확인**

Run: `npm test -- src/utils/__tests__/downtimeBreakdown.test.ts`
Expected: PASS — 14 tests

- [ ] **Step 5: 커밋**

```bash
git add src/utils/downtimeBreakdown.ts src/utils/__tests__/downtimeBreakdown.test.ts
git commit -m "feat(downtime): 비가동 건별 배분 순수 모듈 — andon 이중 기록 접기

downtime_entries 우선 + machine_logs 잔여 규칙으로 andon 쌍둥이 행을 접고
설비 상태 입력 경로의 단독 정지는 살린다. 소유 구간의 합이 합집합과 정확히
같다는 불변조건을 테스트로 고정한다."
```

---

## Task 2: 원천 행 로더 확장

기존 `loadDowntimeSourceRows`는 `{start_time, end_time, is_planned}`만 돌려준다. 목록에는 `id`/`source`/`reason`이 필요하다. **쿼리를 복제하지 않는다** — 풍부한 로더를 만들고 기존 함수를 그 위에 재구현해 두 경로가 갈라질 수 없게 한다.

**Files:**
- Modify: `src/lib/shiftDowntime.ts:18-64`
- Test: `src/lib/__tests__/shiftDowntime.test.ts` (기존 테스트가 회귀 신호가 된다)

- [ ] **Step 1: 기존 테스트가 통과하는지 먼저 확인 (기준선)**

Run: `npm test -- src/lib/__tests__/shiftDowntime.test.ts`
Expected: PASS — 이 테스트는 리팩터 후에도 **변경 없이** 통과해야 한다

- [ ] **Step 2: `loadDowntimeDetailRows` 추가하고 기존 함수를 그 위에 재구현**

`src/lib/shiftDowntime.ts`의 `loadDowntimeSourceRows` 함수(18~64행)를 아래로 **통째 교체**한다. 파일 상단의 import와 `PLANNED_REASONS` 상수, 그리고 `getShiftWindow` 함수는 그대로 둔다.

```ts
/** 원천 행에 신원(id·source·reason)을 붙인 모양. 건별 목록 화면이 이걸 쓴다. */
export interface DowntimeDetailRow {
  id: string;
  source: 'downtime_entry' | 'machine_log';
  reason: string;
  start_time: string;
  end_time: string | null;
  is_planned: boolean;
}

/**
 * 한 설비의 비가동 원천 행을 [rangeStart, rangeEnd) 구간에 대해 **신원과 함께** 로드한다.
 *
 * 비가동은 **두 곳**에서 온다: 작업자가 이벤트로 남긴 `downtime_entries`, 그리고 설비의
 * 비정상 상태 이력 `machine_logs`(NORMAL_OPERATION 이 아닌 구간). 둘을 하나로 합쳐 돌려주는
 * 이 함수가 확정 OEE(daily/route)와 실시간(production-progress)의 **단일 비가동 소스**다.
 * 예전엔 실시간 경로가 downtime_entries 만 봐서, machine_logs 로만 잡히는 정지가 실시간
 * 가동률에서 사라지고 확정 OEE 와 어긋났다(그리고 같은 화면의 입력 잠금은 machine_logs 를
 * 봤다 — 잠긴 설비가 가동률 100% 로 보이는 모순).
 */
export async function loadDowntimeDetailRows(
  machineId: string,
  rangeStartISO: string,
  rangeEndISO: string,
): Promise<DowntimeDetailRow[]> {
  const pageSize = 1000;
  const rows: DowntimeDetailRow[] = [];

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('downtime_entries')
      .select('id, start_time, end_time, reason')
      .eq('machine_id', machineId)
      .lt('start_time', rangeEndISO)
      .or(`end_time.is.null,end_time.gt.${rangeStartISO}`)
      .order('start_time', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []).map(row => ({
      id: String(row.id),
      source: 'downtime_entry' as const,
      reason: String(row.reason),
      start_time: row.start_time,
      end_time: row.end_time,
      is_planned: PLANNED_REASONS.includes(String(row.reason)),
    })));
    if (!data || data.length < pageSize) break;
  }

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabaseAdmin
      .from('machine_logs')
      .select('log_id, start_time, end_time, state')
      .eq('machine_id', machineId)
      .neq('state', 'NORMAL_OPERATION')
      .lt('start_time', rangeEndISO)
      .or(`end_time.is.null,end_time.gt.${rangeStartISO}`)
      .order('start_time', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []).map(row => ({
      id: String(row.log_id),
      source: 'machine_log' as const,
      reason: String(row.state),
      start_time: row.start_time,
      end_time: row.end_time,
      is_planned: row.state === 'PLANNED_STOP',
    })));
    if (!data || data.length < pageSize) break;
  }

  return rows;
}

/**
 * 합계 계산용 축약 모양. 확정 OEE·실시간 경로가 쓰는 기존 계약을 그대로 유지한다.
 * loadDowntimeDetailRows 위에 재구현해 **쿼리가 한 벌만 존재하게** 한다 — 두 로더가
 * 따로 있으면 한쪽만 고쳐져 합계와 목록이 다른 말을 하게 된다.
 */
export async function loadDowntimeSourceRows(
  machineId: string,
  rangeStartISO: string,
  rangeEndISO: string,
): Promise<DowntimeSourceInterval[]> {
  const rows = await loadDowntimeDetailRows(machineId, rangeStartISO, rangeEndISO);
  return rows.map(({ start_time, end_time, is_planned }) => ({
    start_time,
    end_time,
    is_planned,
  }));
}
```

- [ ] **Step 3: 기존 테스트가 여전히 통과하는지 확인 (회귀 없음)**

Run: `npm test -- src/lib/__tests__/shiftDowntime.test.ts`
Expected: PASS — Step 1과 동일한 결과. 실패하면 select 컬럼 추가가 mock 기대와 어긋난 것이므로 mock을 새 select 문자열에 맞춘다.

- [ ] **Step 4: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 이 파일 관련 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add src/lib/shiftDowntime.ts src/lib/__tests__/shiftDowntime.test.ts
git commit -m "refactor(downtime): 원천 행 로더에 id·source·reason 추가

목록 화면이 신원을 필요로 한다. 쿼리를 복제하는 대신 풍부한 로더를 만들고
기존 loadDowntimeSourceRows 를 그 위에 재구현해, 합계와 목록이 갈라질 수
없게 한다."
```

---

## Task 3: GET 엔드포인트

**Files:**
- Modify: `src/app/api/machines/[machineId]/downtime/route.ts`
- Modify: `src/app/api/machines/[machineId]/downtime/__tests__/route.test.ts`
- Modify: `src/app/api/__tests__/rolePolicy.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/app/api/machines/[machineId]/downtime/__tests__/route.test.ts`의 **파일 맨 아래**에 아래를 덧붙인다. 파일 상단의 기존 mock 블록은 GET에 필요한 모듈을 아직 mock하지 않으므로, 상단 mock 블록의 마지막 `jest.mock(...)` 줄 **바로 다음**에 아래 세 줄을 추가한다.

```ts
const mockLoadDetail = jest.fn();
const mockGetShiftWindow = jest.fn();
const mockGetBreakMinutes = jest.fn();
jest.mock('@/lib/shiftDowntime', () => ({
  loadDowntimeDetailRows: (...a: unknown[]) => mockLoadDetail(...a),
  getShiftWindow: (...a: unknown[]) => mockGetShiftWindow(...a),
}));
jest.mock('@/lib/plannedRuntime', () => ({
  getBreakTimeMinutes: (...a: unknown[]) => mockGetBreakMinutes(...a),
}));
```

그리고 상단 `import { POST } from '../route';`를 아래로 바꾼다.

```ts
import { GET, POST } from '../route';
```

파일 맨 아래에 테스트를 덧붙인다.

```ts
describe('GET .../[machineId]/downtime', () => {
  const WINDOW = {
    start: Date.parse('2026-07-28T01:00:00.000Z'),
    end: Date.parse('2026-07-28T13:00:00.000Z'),
  };
  const getReq = (qs: string) =>
    ({ url: `http://localhost/api/machines/${MACHINE}/downtime?${qs}` }) as never;

  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssert.mockReturnValue(undefined);
    mockGetShiftWindow.mockResolvedValue(WINDOW);
    mockGetBreakMinutes.mockResolvedValue(60);
    mockLoadDetail.mockResolvedValue([]);
  });

  it('date·shift 가 없으면 400 (조회하지 않음)', async () => {
    const res = await GET(getReq('date=2026-07-28'), ctx);
    expect(res.status).toBe(400);
    expect(mockLoadDetail).not.toHaveBeenCalled();
  });

  it('잘못된 date 형식은 400', async () => {
    const res = await GET(getReq('date=07-28-2026&shift=A'), ctx);
    expect(res.status).toBe(400);
  });

  it('담당 설비가 아니면 403 (assertMachineAccess 가 던진다)', async () => {
    mockAssert.mockImplementation(() => { throw new Error('forbidden'); });
    await expect(GET(getReq('date=2026-07-28&shift=A'), ctx)).rejects.toThrow();
  });

  it('교대 창과 누적·건별 목록을 함께 돌려준다', async () => {
    mockLoadDetail.mockResolvedValue([
      {
        id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
        start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:30:00.000Z',
        is_planned: false,
      },
      {
        id: 'ml-1', source: 'machine_log', reason: 'INSPECTION',
        start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:30:00.000Z',
        is_planned: false,
      },
    ]);
    const res = await GET(getReq('date=2026-07-28&shift=A'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.shift_start).toBe('2026-07-28T01:00:00.000Z');
    expect(body.shift_end).toBe('2026-07-28T13:00:00.000Z');
    expect(body.total_minutes).toBe(30);
    expect(body.ongoing_since).toBeNull();
    // andon 이중 기록은 1행으로 접힌다
    expect(body.intervals).toHaveLength(1);
    expect(body.intervals[0]).toMatchObject({ id: 'de-1', reason: 'INSPECTION', minutes: 30 });
  });

  it('진행 중 비가동의 ongoing_since 는 교대 시작으로 클립되지 않은 원본 시각이다', async () => {
    // 이전 교대(00:30)에 시작해 아직 진행 중. 목록의 start 는 교대 시작(01:00)으로 클립되지만
    // 경과 시간은 실제 시작부터 재야 하므로 ongoing_since 는 원본을 준다.
    mockLoadDetail.mockResolvedValue([
      {
        id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
        start_time: '2026-07-28T00:30:00.000Z', end_time: null, is_planned: false,
      },
    ]);
    const res = await GET(getReq('date=2026-07-28&shift=A'), ctx);
    const body = await res.json();
    expect(body.ongoing_since).toBe('2026-07-28T00:30:00.000Z');
    expect(body.intervals[0].start).toBe('2026-07-28T01:00:00.000Z');
    expect(body.intervals[0].clipped_start).toBe(true);
  });

  it('열린 행이 둘이면(andon 이중 기록) 가장 이른 시작을 쓴다', async () => {
    mockLoadDetail.mockResolvedValue([
      {
        id: 'ml-1', source: 'machine_log', reason: 'INSPECTION',
        start_time: '2026-07-28T06:00:05.000Z', end_time: null, is_planned: false,
      },
      {
        id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
        start_time: '2026-07-28T06:00:00.000Z', end_time: null, is_planned: false,
      },
    ]);
    const res = await GET(getReq('date=2026-07-28&shift=A'), ctx);
    const body = await res.json();
    expect(body.ongoing_since).toBe('2026-07-28T06:00:00.000Z');
  });

  it('계획정지가 휴식과 겹치면 total_minutes 는 null 이지만 목록은 그대로 준다', async () => {
    mockLoadDetail.mockResolvedValue([
      {
        id: 'de-1', source: 'downtime_entry', reason: 'PLANNED_STOP',
        start_time: '2026-07-28T02:00:00.000Z', end_time: '2026-07-28T02:30:00.000Z',
        is_planned: true,
      },
    ]);
    const res = await GET(getReq('date=2026-07-28&shift=A'), ctx);
    const body = await res.json();
    expect(body.total_minutes).toBeNull();
    expect(body.intervals).toHaveLength(1);
  });

  it('비가동이 없으면 total_minutes 는 0 이고 목록은 빈 배열', async () => {
    const res = await GET(getReq('date=2026-07-28&shift=A'), ctx);
    const body = await res.json();
    expect(body.total_minutes).toBe(0);
    expect(body.intervals).toEqual([]);
  });

  it('교대 설정이 유효하지 않으면 500', async () => {
    mockGetShiftWindow.mockResolvedValue(null);
    const res = await GET(getReq('date=2026-07-28&shift=A'), ctx);
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run: `npm test -- "src/app/api/machines/[machineId]/downtime"`
Expected: FAIL — `GET is not a function`

- [ ] **Step 3: GET 구현**

`src/app/api/machines/[machineId]/downtime/route.ts`의 import 블록을 아래로 교체한다.

```ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';
import { getBusinessTimeConfig } from '@/lib/shiftConfig';
import { getBusinessDateAt } from '@/utils/downtimeIntervals';
import { getShiftWindow, loadDowntimeDetailRows } from '@/lib/shiftDowntime';
import { getBreakTimeMinutes } from '@/lib/plannedRuntime';
import { calculateVerifiedDowntimeMinutesForWindow } from '@/app/api/production-records/daily/downtimeCalculation';
import { buildDowntimeBreakdown } from '@/utils/downtimeBreakdown';
```

`DOWNTIME_REASONS` 상수 바로 아래에 날짜 정규식을 추가한다.

```ts
const DATE = /^\d{4}-\d{2}-\d{2}$/;
```

파일 맨 아래에 GET을 추가한다.

```ts
/**
 * GET /api/machines/[machineId]/downtime?date=&shift= — 이 교대의 비가동 누적 + 건별 내역.
 *
 * `total_minutes` 는 확정 OEE 와 **같은 함수**(calculateVerifiedDowntimeMinutesForWindow)로
 * 계산한다. 새 합계 로직을 만들면 화면마다 다른 숫자가 나온다.
 *
 * 건별 목록은 buildDowntimeBreakdown 이 겹침을 배분해 만든다. andon 은 downtime_entries 와
 * machine_logs 양쪽에 같은 시간대를 쓰므로, 배분 없이 나열하면 모든 andon 비가동이 두 줄이
 * 된다.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ machineId: string }> }) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { machineId } = await ctx.params;
    const { searchParams } = new URL(request.url);
    const date = searchParams.get('date') ?? '';
    const shift = searchParams.get('shift');

    if (!DATE.test(date) || (shift !== 'A' && shift !== 'B')) {
      return NextResponse.json(
        { error: 'date must be YYYY-MM-DD and shift must be A or B' },
        { status: 400 }
      );
    }

    // 읽기에도 담당 설비 검사를 건다 — 같은 파일의 POST 및 production-progress GET 과 동일.
    assertMachineAccess(user, machineId);

    // 확정 OEE 와 같은 buildShiftWindows 산출물. 프런트가 창을 따로 계산하지 않게 서버가 준다.
    const window = await getShiftWindow(date, shift);
    if (!window) {
      return NextResponse.json({ error: 'Shift time configuration is invalid' }, { status: 500 });
    }

    const shiftStartIso = new Date(window.start).toISOString();
    const shiftEndIso = new Date(window.end).toISOString();

    const rows = await loadDowntimeDetailRows(machineId, shiftStartIso, shiftEndIso);
    const breakMinutes = await getBreakTimeMinutes();
    const nowMs = Date.now();

    // null = 계획정지·휴식 겹침으로 계산 보류. 0 으로 뭉개지 않고 그대로 전달한다.
    const totalMinutes = calculateVerifiedDowntimeMinutesForWindow(
      rows.map(({ start_time, end_time, is_planned }) => ({ start_time, end_time, is_planned })),
      window,
      breakMinutes,
      nowMs
    );

    // 진행 중 비가동의 **클립되지 않은** 시작 시각. 목록의 start 는 교대 창에 클립되므로
    // 이전 교대에서 이어진 비가동의 경과 시간을 그걸로 재면 실제보다 짧게 나온다.
    // andon 은 두 소스에 함께 기록하므로 열린 행이 둘일 수 있다 — 가장 이른 시작을 쓴다.
    const openStarts = rows
      .filter(row => row.end_time === null)
      .map(row => Date.parse(row.start_time))
      .filter(value => Number.isFinite(value));
    const ongoingSince = openStarts.length > 0
      ? new Date(Math.min(...openStarts)).toISOString()
      : null;

    return NextResponse.json({
      shift_start: shiftStartIso,
      shift_end: shiftEndIso,
      total_minutes: totalMinutes,
      ongoing_since: ongoingSince,
      intervals: buildDowntimeBreakdown(rows, window, nowMs),
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
```

- [ ] **Step 4: 테스트를 실행해 통과를 확인**

Run: `npm test -- "src/app/api/machines/[machineId]/downtime"`
Expected: PASS — 기존 POST 테스트 + 신규 GET 테스트 9건

- [ ] **Step 5: 권한 정책 원장 갱신**

`src/app/api/__tests__/rolePolicy.test.ts`에서 아래 줄을 찾는다.

```ts
  'machines/[machineId]/downtime': { POST: AEO },
```

아래로 바꾼다.

```ts
  'machines/[machineId]/downtime': { GET: AEO, POST: AEO },
```

- [ ] **Step 6: 원장 테스트 통과 확인**

Run: `npm test -- src/app/api/__tests__/rolePolicy.test.ts`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add "src/app/api/machines/[machineId]/downtime/route.ts" "src/app/api/machines/[machineId]/downtime/__tests__/route.test.ts" src/app/api/__tests__/rolePolicy.test.ts
git commit -m "feat(api): 교대 비가동 누적·건별 내역 GET 추가

total_minutes 는 확정 OEE 와 동일한 calculateVerifiedDowntimeMinutesForWindow
를 그대로 호출한다. 계산 보류(null)는 0 으로 뭉개지 않고 전달한다."
```

---

## Task 4: 사유 라벨 해석기

사유 어휘가 두 벌이고 두 사전의 교집합이 없다. 어느 쪽에도 없는 코드가 오면 빈 문자열이나 키 원문(`states.foo`)이 화면에 나가면 안 된다.

**Files:**
- Create: `src/utils/downtimeReasonLabel.ts`
- Test: `src/utils/__tests__/downtimeReasonLabel.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/utils/__tests__/downtimeReasonLabel.test.ts`:

```ts
import { resolveDowntimeReasonLabel } from '@/utils/downtimeReasonLabel';

// i18next 의 t 를 흉내낸다. 사전에 있으면 번역을, 없으면 defaultValue 를 돌려준다.
const makeT = (dict: Record<string, string>) =>
  ((key: string, options?: { defaultValue?: string }) =>
    dict[key] ?? options?.defaultValue ?? key) as never;

const DICT = {
  'machines:states.INSPECTION': '점검중',
  'machines:states.BREAKDOWN_REPAIR': '고장수리',
  'dataInput:downtime.reasons.equipmentFailure': '설비 고장',
  'dataInput:downtime.reasons.endmillChange': 'ENDMILL 교체',
};

describe('resolveDowntimeReasonLabel', () => {
  it('andon 어휘(UPPER_SNAKE)를 machines:states 에서 찾는다', () => {
    expect(resolveDowntimeReasonLabel('INSPECTION', makeT(DICT))).toBe('점검중');
  });

  it('입력폼 어휘(camelCase)를 dataInput:downtime.reasons 에서 찾는다', () => {
    expect(resolveDowntimeReasonLabel('endmillChange', makeT(DICT))).toBe('ENDMILL 교체');
  });

  it('두 사전 어디에도 없으면 원본 코드를 그대로 노출한다', () => {
    expect(resolveDowntimeReasonLabel('someNewCode', makeT(DICT))).toBe('someNewCode');
  });

  it('빈 사유는 원본을 그대로 돌려준다(빈 라벨을 만들지 않는다)', () => {
    expect(resolveDowntimeReasonLabel('', makeT(DICT))).toBe('');
  });

  it('번역 키 원문이 화면으로 새지 않는다', () => {
    const label = resolveDowntimeReasonLabel('unknownThing', makeT(DICT));
    expect(label).not.toContain('machines:');
    expect(label).not.toContain('dataInput:');
    expect(label).not.toContain('states.');
  });
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run: `npm test -- src/utils/__tests__/downtimeReasonLabel.test.ts`
Expected: FAIL — `Cannot find module '@/utils/downtimeReasonLabel'`

- [ ] **Step 3: 뼈대를 만들고 폴백은 비워 둔다 — 이 부분은 사용자가 작성한다**

`src/utils/downtimeReasonLabel.ts`:

```ts
/**
 * 비가동 사유 코드를 사람이 읽는 라벨로 바꾼다.
 *
 * 사유 어휘가 **두 벌 동시에 현역**이며 두 사전의 교집합이 없다(2026-07-28 실측):
 *   - andon 콘솔     → UPPER_SNAKE (`INSPECTION`)      → `machines:states.*`
 *   - 교대 입력 폼   → camelCase   (`equipmentFailure`) → `dataInput:downtime.reasons.*`
 *
 * 어휘 통합은 범위 밖이다(설계 결정). 따라서 두 사전을 차례로 조회한다.
 */

type TranslateFn = (key: string, options?: { defaultValue?: string }) => string;

// 사전에 키가 없음을 감지하기 위한 감시값. 실제 번역문과 절대 겹치지 않는 문자열.
const MISSING = '\u0000__missing__';

export function resolveDowntimeReasonLabel(reason: string, t: TranslateFn): string {
  const fromMachineStates = t(`machines:states.${reason}`, { defaultValue: MISSING });
  if (fromMachineStates !== MISSING) return fromMachineStates;

  const fromFormReasons = t(`dataInput:downtime.reasons.${reason}`, { defaultValue: MISSING });
  if (fromFormReasons !== MISSING) return fromFormReasons;

  // TODO(사용자 작성): 두 사전 어디에도 없는 코드의 폴백.
  // 아래 return 을 지우고 원하는 동작을 구현하세요.
  return reason;
}
```

**이 함수의 마지막 폴백은 사용자에게 요청할 부분이다.** 구현 에이전트는 위 상태 그대로 두고, 사용자가 직접 작성하도록 남긴다. 사용자가 다른 동작을 지정하면 Step 1의 세 번째·다섯 번째 테스트를 그에 맞게 고친다.

- [ ] **Step 4: 테스트를 실행해 통과를 확인**

Run: `npm test -- src/utils/__tests__/downtimeReasonLabel.test.ts`
Expected: PASS — 5 tests

- [ ] **Step 5: 커밋**

```bash
git add src/utils/downtimeReasonLabel.ts src/utils/__tests__/downtimeReasonLabel.test.ts
git commit -m "feat(downtime): 두 사유 어휘를 라벨로 바꾸는 해석기

andon(UPPER_SNAKE)과 교대 입력폼(camelCase)이 동시에 현역이고 두 사전의
교집합이 없다. 양쪽을 차례로 조회하고, 어디에도 없으면 원본 코드를 노출해
데이터 문제가 화면에서 사라지지 않게 한다."
```

---

## Task 5: 번역 키 추가

**Files:**
- Modify: `public/locales/ko/machines.json`
- Modify: `public/locales/vi/machines.json`

- [ ] **Step 1: 한국어 키 추가**

`public/locales/ko/machines.json`에서 `"detail": {` 블록이 끝나는 `},` 바로 **다음 줄**에 아래 블록을 추가한다(`"fields": {` 앞).

```json
  "downtimeBreakdown": {
    "sectionTitle": "비가동",
    "elapsedNow": "{{reason}} · {{duration}} 경과",
    "since": "{{time}}~",
    "cumulative": "누적 {{count}}건 · {{minutes}}분",
    "cumulativeUnknown": "누적 —",
    "cumulativeUnknownHint": "계획정지와 휴식이 겹쳐 계산을 보류했습니다",
    "toggle": "비가동 내역 보기 ({{count}}건)",
    "empty": "이번 교대 비가동 없음",
    "loadFailed": "비가동 내역을 불러오지 못했습니다",
    "retry": "다시 불러오기",
    "ongoing": "진행중",
    "carriedOver": "이전 교대에서 이어짐",
    "minutesShort": "{{minutes}}분",
    "correct": "정정",
    "correctTitle": "사유 정정",
    "correctHint": "시작 시각은 그대로 두고 사유만 바꿉니다",
    "correctFailed": "사유 정정에 실패했습니다",
    "correctNotInDowntime": "이미 가동 중이라 정정할 수 없습니다"
  },
```

- [ ] **Step 2: 베트남어 키 추가**

`public/locales/vi/machines.json`의 같은 위치에 동일한 키 구조로 추가한다.

```json
  "downtimeBreakdown": {
    "sectionTitle": "Dừng máy",
    "elapsedNow": "{{reason}} · đã {{duration}}",
    "since": "Từ {{time}}",
    "cumulative": "Tổng {{count}} lần · {{minutes}} phút",
    "cumulativeUnknown": "Tổng —",
    "cumulativeUnknownHint": "Tạm hoãn tính toán do dừng theo kế hoạch trùng giờ nghỉ",
    "toggle": "Xem chi tiết dừng máy ({{count}})",
    "empty": "Ca này không có dừng máy",
    "loadFailed": "Không tải được chi tiết dừng máy",
    "retry": "Tải lại",
    "ongoing": "Đang diễn ra",
    "carriedOver": "Tiếp nối từ ca trước",
    "minutesShort": "{{minutes}} phút",
    "correct": "Sửa",
    "correctTitle": "Sửa lý do",
    "correctHint": "Giữ nguyên thời điểm bắt đầu, chỉ đổi lý do",
    "correctFailed": "Sửa lý do thất bại",
    "correctNotInDowntime": "Máy đã chạy lại nên không thể sửa"
  },
```

- [ ] **Step 3: 두 파일의 키 구조가 같은지 확인**

Run:
```bash
node -e "
const ko=require('./public/locales/ko/machines.json').downtimeBreakdown;
const vi=require('./public/locales/vi/machines.json').downtimeBreakdown;
const a=Object.keys(ko).sort(), b=Object.keys(vi).sort();
if(JSON.stringify(a)!==JSON.stringify(b)){console.error('키 불일치');process.exit(1)}
console.log('OK', a.length, '키 일치');
"
```
Expected: `OK 18 키 일치`

- [ ] **Step 4: 커밋**

```bash
git add public/locales/ko/machines.json public/locales/vi/machines.json
git commit -m "i18n(machines): 비가동 내역 문구 추가 (ko/vi)"
```

---

## Task 6: 조회 훅

`useRealtimeProgress`와 동일한 규율을 따른다: 요청 순번 가드로 늦게 도착한 응답이 최신 상태를 덮지 않게 하고, 언마운트 후에는 어떤 setState도 하지 않는다.

**Files:**
- Create: `src/hooks/useDowntimeBreakdown.ts`

- [ ] **Step 1: 훅 구현**

`src/hooks/useDowntimeBreakdown.ts`:

```ts
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authFetch';
import type { DowntimeBreakdownRow } from '@/utils/downtimeBreakdown';

interface Args {
  machineId: string | null;
  date: string;
  shift: 'A' | 'B';
}

interface Result {
  /** null = 계산 보류(계획정지·휴식 겹침) 또는 아직 조회 전. 0 과 구분한다. */
  totalMinutes: number | null;
  /** 진행 중 비가동의 클립되지 않은 시작(ISO). null = 진행 중인 비가동 없음. */
  ongoingSince: string | null;
  intervals: DowntimeBreakdownRow[];
  /** 조회를 한 번이라도 성공했는가. "0건"과 "아직 모름"을 구분하는 데 쓴다. */
  loaded: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * 이 교대의 비가동 누적 + 건별 내역 조회.
 *
 * 실패를 0 이나 빈 배열로 채우지 않는다. "비가동 0건"과 "조회 실패"는 다르고, 섞으면
 * 멈춰 있는 설비가 멀쩡해 보인다. loaded 플래그로 둘을 구분한다.
 *
 * 요청 순번(reqRef) 가드는 useRealtimeProgress 와 같은 이유로 둔다: 설비를 빠르게 바꾸면
 * 옛 설비의 응답이 늦게 도착해 새 화면을 덮을 수 있고, refresh 가 폴링과 겹쳐 불려
 * 조회 도중 언마운트가 실제로 일어난다.
 */
export function useDowntimeBreakdown({ machineId, date, shift }: Args): Result {
  const [totalMinutes, setTotalMinutes] = useState<number | null>(null);
  const [ongoingSince, setOngoingSince] = useState<string | null>(null);
  const [intervals, setIntervals] = useState<DowntimeBreakdownRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqRef = useRef(0);

  const fetchBreakdown = useCallback(async () => {
    if (!machineId) return;
    const reqId = ++reqRef.current;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ date, shift });
      const res = await authFetch(
        `/api/machines/${machineId}/downtime?${params}`,
        { cache: 'no-store' }
      );
      if (reqId !== reqRef.current) return;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = await res.json() as {
        total_minutes: number | null;
        ongoing_since: string | null;
        intervals: DowntimeBreakdownRow[];
      };
      if (reqId !== reqRef.current) return;

      setTotalMinutes(body.total_minutes);
      setOngoingSince(body.ongoing_since);
      setIntervals(body.intervals ?? []);
      setLoaded(true);
    } catch (e) {
      if (reqId !== reqRef.current) return;
      setError(e instanceof Error ? e.message : 'Unknown error');
      // 실패한 조회의 결과가 "현재 상태"처럼 남지 않게 비운다. loaded 를 내려
      // 화면이 "0건"이 아니라 오류를 보여주게 한다.
      setTotalMinutes(null);
      setOngoingSince(null);
      setIntervals([]);
      setLoaded(false);
    } finally {
      if (reqId === reqRef.current) setLoading(false);
    }
  }, [machineId, date, shift]);

  useEffect(() => { void fetchBreakdown(); }, [fetchBreakdown]);

  // 설비·일자·교대가 바뀌면 이전 값이 새 응답 도착 전까지 남지 않게 즉시 비운다.
  // deps 를 좁혀 폴링 refresh(같은 인자)에는 걸리지 않게 한다 — 안 그러면 매 틱 깜빡인다.
  useEffect(() => {
    setTotalMinutes(null);
    setOngoingSince(null);
    setIntervals([]);
    setLoaded(false);
    setError(null);
  }, [machineId, date, shift]);

  // 언마운트 시 진행 중 요청을 모두 무효화한다 (마운트 해제 후 setState 금지).
  useEffect(() => () => { reqRef.current++; }, []);

  return { totalMinutes, ongoingSince, intervals, loaded, loading, error, refresh: fetchBreakdown };
}
```

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 3: 커밋**

```bash
git add src/hooks/useDowntimeBreakdown.ts
git commit -m "feat(downtime): 교대 비가동 내역 조회 훅

조회 실패를 0건으로 채우지 않는다(loaded 플래그로 구분). 요청 순번 가드는
useRealtimeProgress 와 동일한 규율."
```

---

## Task 7: 표시 카드 컴포넌트 (읽기 전용)

정정 UI는 Task 10에서 붙인다. 먼저 읽기만 되는 컴포넌트로 동작하는 소프트웨어를 만든다.

**Files:**
- Create: `src/components/downtime/DowntimeBreakdownCard.tsx`
- Create: `src/components/downtime/index.ts`
- Test: `src/components/downtime/__tests__/DowntimeBreakdownCard.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/downtime/__tests__/DowntimeBreakdownCard.test.tsx`:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import { DowntimeBreakdownCard } from '../DowntimeBreakdownCard';
import type { DowntimeBreakdownRow } from '@/utils/downtimeBreakdown';

const mockUseBreakdown = jest.fn();
jest.mock('@/hooks/useDowntimeBreakdown', () => ({
  useDowntimeBreakdown: (...a: unknown[]) => mockUseBreakdown(...a),
}));
jest.mock('@/hooks/useTranslation', () => ({
  useMultipleTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      // 실제 i18next 처럼 defaultValue 를 존중해야 한다. resolveDowntimeReasonLabel 이
      // 바로 그 값으로 "사전에 키가 없음"을 감지하기 때문이다. 무시하면 라벨이 항상
      // 'machines:states.X|...' 로 나와, 사유 관련 단언이 거짓 통과/실패한다.
      if (opts && 'defaultValue' in opts) return opts.defaultValue as string;
      if (!opts) return key;
      // 보간값을 뒤에 이어 붙여 어떤 값으로 렌더됐는지 확인할 수 있게 한다.
      return `${key}(${Object.entries(opts).map(([k, v]) => `${k}=${v}`).join(',')})`;
    },
    i18n: { language: 'ko' },
    language: 'ko',
    changeLanguage: () => {},
  }),
}));
```

이 모의에서는 두 사전 모두 비어 있는 셈이므로 `resolveDowntimeReasonLabel` 이 **원본 코드를
그대로** 돌려준다(`INSPECTION`, `endmillChange`). 사유 관련 단언은 그 원본 코드를 정확히
비교하면 된다.

```tsx

const MACHINE = '11111111-1111-4111-8111-111111111111';
const base = {
  machineId: MACHINE,
  date: '2026-07-28',
  shift: 'A' as const,
  onCorrected: () => {},
};

const rows: DowntimeBreakdownRow[] = [
  {
    id: 'de-1', source: 'downtime_entry', reason: 'endmillChange',
    start: '2026-07-28T02:12:00.000Z', end: '2026-07-28T02:30:00.000Z',
    minutes: 18, clipped_start: false,
  },
];

const state = (over: Record<string, unknown> = {}) => ({
  totalMinutes: 18, ongoingSince: null, intervals: rows,
  loaded: true, loading: false, error: null,
  refresh: jest.fn(), ...over,
});

describe('DowntimeBreakdownCard', () => {
  beforeEach(() => jest.clearAllMocks());

  it('누적 분이 null 이면 0 이 아니라 계산 보류로 표시한다', () => {
    mockUseBreakdown.mockReturnValue(state({ totalMinutes: null }));
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.getByText(/cumulativeUnknown/)).toBeInTheDocument();
    expect(screen.queryByText(/cumulative\(/)).not.toBeInTheDocument();
  });

  it('조회에 실패하면 "0건"이 아니라 오류를 보여준다', () => {
    mockUseBreakdown.mockReturnValue(
      state({ loaded: false, error: 'HTTP 500', intervals: [], totalMinutes: null })
    );
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.getByText(/loadFailed/)).toBeInTheDocument();
    expect(screen.queryByText(/downtimeBreakdown\.empty/)).not.toBeInTheDocument();
  });

  it('조회에 성공했고 0건이면 비가동 없음을 보여준다', () => {
    mockUseBreakdown.mockReturnValue(state({ intervals: [], totalMinutes: 0 }));
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.getByText(/downtimeBreakdown\.empty/)).toBeInTheDocument();
  });

  it('진행 중이면 경과 시간을 보여준다', () => {
    mockUseBreakdown.mockReturnValue(state({
      ongoingSince: '2026-07-28T06:00:00.000Z',
      intervals: [{
        id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
        start: '2026-07-28T06:00:00.000Z', end: null,
        minutes: 23, clipped_start: false,
      }],
    }));
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.getByText(/elapsedNow/)).toBeInTheDocument();
  });

  it('진행 중인 비가동이 없으면 경과 배너를 그리지 않는다', () => {
    mockUseBreakdown.mockReturnValue(state());  // ongoingSince: null
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.queryByText(/elapsedNow/)).not.toBeInTheDocument();
  });

  it('이전 교대에서 이어진 비가동은 클립된 start 가 아니라 ongoingSince 로 경과를 잰다', () => {
    jest.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-28T02:00:00.000Z'));
    mockUseBreakdown.mockReturnValue(state({
      // 실제 시작 00:30, 목록의 start 는 교대 시작 01:00 으로 클립됨
      ongoingSince: '2026-07-28T00:30:00.000Z',
      intervals: [{
        id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
        start: '2026-07-28T01:00:00.000Z', end: null,
        minutes: 60, clipped_start: true,
      }],
    }));
    render(<DowntimeBreakdownCard {...base} />);
    // 00:30 → 02:00 = 90분. 클립된 01:00 기준이면 60분(hours=1,minutes=0)이 나온다.
    expect(screen.getByText(/hours=1,minutes=30/)).toBeInTheDocument();
    (Date.now as jest.Mock).mockRestore();
  });

  it('건별 목록에 사유 라벨을 그린다', () => {
    mockUseBreakdown.mockReturnValue(state());
    render(<DowntimeBreakdownCard {...base} />);
    // 모의 사전이 비어 있으므로 resolveDowntimeReasonLabel 은 원본 코드를 돌려준다
    expect(screen.getByText('endmillChange')).toBeInTheDocument();
  });

  it('교대 창을 훅에 그대로 넘긴다 (스스로 추측하지 않는다)', () => {
    mockUseBreakdown.mockReturnValue(state());
    render(<DowntimeBreakdownCard {...base} />);
    expect(mockUseBreakdown).toHaveBeenCalledWith({
      machineId: MACHINE, date: '2026-07-28', shift: 'A',
    });
  });
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run: `npm test -- src/components/downtime`
Expected: FAIL — `Cannot find module '../DowntimeBreakdownCard'`

- [ ] **Step 3: 컴포넌트 구현**

`src/components/downtime/DowntimeBreakdownCard.tsx`:

```tsx
'use client';

import React, { useEffect, useState } from 'react';
import { Alert, Button, Collapse, Space, Typography } from 'antd';
import { useDowntimeBreakdown } from '@/hooks/useDowntimeBreakdown';
import { useMultipleTranslation } from '@/hooks/useTranslation';
import { resolveDowntimeReasonLabel } from '@/utils/downtimeReasonLabel';
import type { DowntimeBreakdownRow } from '@/utils/downtimeBreakdown';

const { Text } = Typography;

/** 진행 중 경과 표시 갱신 주기. 분 단위 표시라 10초면 충분하고 렌더도 아깝지 않다. */
const TICK_MS = 10_000;

export interface DowntimeBreakdownCardProps {
  machineId: string;
  /**
   * 교대 창은 **반드시 주입한다**. 컴포넌트가 "지금 교대"를 스스로 추측하면 두 화면이
   * 서로 다른 창을 볼 수 있다 — 이 프로젝트가 이미 겪은 실패 유형이다.
   */
  date: string;
  shift: 'A' | 'B';
  onCorrected: () => void;
  /** 기본 false. 운영자 콘솔만 true. */
  allowCorrection?: boolean;
}

const formatClock = (iso: string): string =>
  new Date(iso).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });

const formatDuration = (
  minutesTotal: number,
  t: (key: string, options?: Record<string, unknown>) => string
): string => {
  const hours = Math.floor(minutesTotal / 60);
  const minutes = minutesTotal % 60;
  if (hours > 0) return t('detail.durationHM', { hours, minutes });
  return t('downtimeBreakdown.minutesShort', { minutes });
};

/**
 * 이 교대의 비가동을 한 자리에 보여준다: 진행 중 경과 + 누적 + 건별 사유 목록.
 *
 * 상태 전이 쓰기(비가동 시작 / 가동 재개)는 이 컴포넌트의 책임이 아니다 —
 * DowntimeAndonSection 이 담당한다. 여기는 읽기와 사유 정정만 한다.
 */
export const DowntimeBreakdownCard: React.FC<DowntimeBreakdownCardProps> = ({
  machineId, date, shift, onCorrected, allowCorrection = false,
}) => {
  const { t } = useMultipleTranslation(['machines', 'dataInput']);
  const { totalMinutes, ongoingSince, intervals, loaded, error, refresh } =
    useDowntimeBreakdown({ machineId, date, shift });

  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // 진행 중 비가동은 조회한 데이터가 알려준다 — 설비 상태를 prop 으로 따로 받지 않는다.
  // (Machine 타입에는 비가동 시작 시각 필드가 없고, 두 소스를 두면 화면끼리 어긋난다.)
  const ongoingRow = intervals.find(row => row.end === null) ?? null;
  // 경과는 **클립되지 않은** ongoingSince 로 잰다. ongoingRow.start 는 교대 시작으로
  // 잘려 있어서, 이전 교대에서 이어진 비가동의 경과가 실제보다 짧게 나온다.
  const elapsedMinutes = ongoingSince
    ? Math.max(0, Math.floor((now - Date.parse(ongoingSince)) / 60000))
    : null;

  const renderRow = (row: DowntimeBreakdownRow) => (
    <div
      key={row.id}
      style={{ display: 'flex', gap: 8, alignItems: 'baseline', padding: '4px 0' }}
    >
      <Text type="secondary" style={{ minWidth: 108, fontVariantNumeric: 'tabular-nums' }}>
        {row.clipped_start ? '‹' : ''}{formatClock(row.start)}
        {'~'}
        {row.end === null ? t('downtimeBreakdown.ongoing') : formatClock(row.end)}
      </Text>
      <Text strong style={{ minWidth: 56, fontVariantNumeric: 'tabular-nums' }}>
        {t('downtimeBreakdown.minutesShort', { minutes: row.minutes })}
      </Text>
      <Text>{resolveDowntimeReasonLabel(row.reason, t)}</Text>
    </div>
  );

  return (
    <Space direction="vertical" style={{ width: '100%' }} size={8}>
      {ongoingSince !== null && elapsedMinutes !== null && (
        <Alert
          type="warning"
          showIcon
          message={t('downtimeBreakdown.elapsedNow', {
            reason: resolveDowntimeReasonLabel(ongoingRow?.reason ?? '', t),
            duration: formatDuration(elapsedMinutes, t),
          })}
          description={t('downtimeBreakdown.since', { time: formatClock(ongoingSince) })}
        />
      )}

      {/* 누적. null 은 "0분"이 아니라 "계산 보류"다 — 섞으면 멈춘 설비가 멀쩡해 보인다. */}
      {totalMinutes === null ? (
        <Text type="secondary">
          {t('downtimeBreakdown.cumulativeUnknown')}
          {' · '}
          {t('downtimeBreakdown.cumulativeUnknownHint')}
        </Text>
      ) : (
        <Text>
          {t('downtimeBreakdown.cumulative', {
            count: intervals.length,
            minutes: totalMinutes,
          })}
        </Text>
      )}

      {/* 조회 실패는 "0건"과 다르다. loaded 로 구분한다. */}
      {!loaded && error && (
        <Alert
          type="error"
          showIcon
          message={t('downtimeBreakdown.loadFailed')}
          action={<Button size="small" onClick={refresh}>{t('downtimeBreakdown.retry')}</Button>}
        />
      )}

      {loaded && intervals.length === 0 && (
        <Text type="secondary">{t('downtimeBreakdown.empty')}</Text>
      )}

      {loaded && intervals.length > 0 && (
        <Collapse
          ghost
          size="small"
          items={[{
            key: 'list',
            label: t('downtimeBreakdown.toggle', { count: intervals.length }),
            children: <div>{intervals.map(renderRow)}</div>,
          }]}
        />
      )}
    </Space>
  );
};
```

`src/components/downtime/index.ts`:

```ts
export { DowntimeBreakdownCard } from './DowntimeBreakdownCard';
export type { DowntimeBreakdownCardProps } from './DowntimeBreakdownCard';
```

- [ ] **Step 4: 테스트를 실행해 통과를 확인**

Run: `npm test -- src/components/downtime`
Expected: PASS — 8 tests

- [ ] **Step 5: 커밋**

```bash
git add src/components/downtime/
git commit -m "feat(downtime): 비가동 내역 카드 (경과·누적·건별 사유)

누적 null 은 0% 가 아니라 계산 보류로, 조회 실패는 0건과 구분해 렌더한다.
교대 창은 prop 으로만 받는다 — 컴포넌트가 '지금 교대'를 추측하지 않는다."
```

---

## Task 8: 운영자 콘솔에 연결

**Files:**
- Modify: `src/components/dashboard/operator-console/MachineConsole.tsx:118-124`

- [ ] **Step 1: import 추가**

`src/components/dashboard/operator-console/MachineConsole.tsx`의 import 블록에서 `import { DefectPendingSection } from './DefectPendingSection';` 바로 다음 줄에 추가한다.

```tsx
import { DowntimeBreakdownCard } from '@/components/downtime';
```

- [ ] **Step 2: 비가동 카드 안에 렌더**

같은 파일 118~124행의 비가동 카드 블록을 찾는다.

```tsx
      <Card size="small" title={t('operator.downtime')}>
        <DowntimeAndonSection
          machineId={machineId}
          currentState={currentState}
          onChanged={() => { progress.refresh(); backlog.refresh(); }}
        />
      </Card>
```

아래로 바꾼다.

```tsx
      <Card size="small" title={t('operator.downtime')}>
        <Space direction="vertical" style={{ width: '100%' }}>
          {/* 읽기(경과·누적·사유 목록 + 정정). 교대 창은 이 컴포넌트가 소유한 값을 그대로 넘긴다.
              진행 중 비가동은 카드가 조회한 데이터에서 스스로 알아내므로 상태를 넘기지 않는다. */}
          <DowntimeBreakdownCard
            machineId={machineId}
            date={date}
            shift={shift}
            allowCorrection
            onCorrected={() => { progress.refresh(); backlog.refresh(); }}
          />
          {/* 상태 전이 쓰기(비가동 시작 / 가동 재개)는 별개 책임으로 남긴다. */}
          <DowntimeAndonSection
            machineId={machineId}
            currentState={currentState}
            onChanged={() => { progress.refresh(); backlog.refresh(); }}
          />
        </Space>
      </Card>
```

- [ ] **Step 3: 기존 콘솔 테스트가 여전히 통과하는지 확인**

Run: `npm test -- src/components/dashboard/__tests__/OperatorDashboard.realtimeProgress.test.ts`
Expected: PASS

- [ ] **Step 4: 타입 검사와 린트**

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음

- [ ] **Step 5: 커밋**

```bash
git add src/components/dashboard/operator-console/MachineConsole.tsx
git commit -m "feat(operator-console): 비가동 카드에 경과·누적·사유 내역 표시"
```

---

## Task 9: 설비 상세 모달에 연결 (읽기 전용)

`MachineDetailModal`은 `machine` prop만 받아 날짜·교대 컨텍스트가 없다. 모달이 현재 교대를 해결해 주입한다.

**Files:**
- Modify: `src/components/machines/MachineDetailModal.tsx`

- [ ] **Step 1: import 추가**

`src/components/machines/MachineDetailModal.tsx`의 import 블록 맨 아래(`import { formatMachineLocation } from '@/utils/machineLocation';` 다음)에 추가한다.

```tsx
import { DowntimeBreakdownCard } from '@/components/downtime';
import { getCurrentShiftInfo, type ShiftTimeConfig } from '@/utils/shiftUtils';
import { useSystemSettings } from '@/hooks/useSystemSettings';
```

- [ ] **Step 2: 현재 교대 해결**

같은 파일에서 `if (!machine) return null;` 줄을 찾는다. 그 **바로 위**(hook 은 early return 앞에 있어야 한다)에 추가한다.

```tsx
  // 모달에는 날짜·교대 컨텍스트가 없다. 운영자 콘솔과 같은 단일 소스(shiftUtils)로 해결해
  // 두 화면이 같은 교대 창을 보게 한다.
  const { getShiftTimes, getCompanyInfo } = useSystemSettings();
  const shiftTimes = getShiftTimes();
  const shiftConfig: ShiftTimeConfig = {
    timezone: getCompanyInfo().timezone,
    shiftAStart: shiftTimes.shiftA.start,
    shiftAEnd: shiftTimes.shiftA.end,
    shiftBStart: shiftTimes.shiftB.start,
    shiftBEnd: shiftTimes.shiftB.end,
  };
  const currentShift = getCurrentShiftInfo(new Date(), shiftConfig);
```

- [ ] **Step 3: 상세 정보 아래에 카드 렌더**

같은 파일에서 설비 상세 정보 `Descriptions` 블록이 끝나는 지점을 찾아, 그 다음에 아래를 추가한다.

```tsx
      <Divider />
      <Card size="small" title={t('downtimeBreakdown.sectionTitle')}>
        <DowntimeBreakdownCard
          machineId={machine.id}
          date={currentShift.businessDate}
          shift={currentShift.shift}
          // 읽기 맥락이므로 정정은 열지 않는다(운영자 콘솔에서만).
          onCorrected={() => {}}
        />
      </Card>
```

`Machine` 타입에는 비가동 시작 시각을 담는 필드가 **없다**(`id, name, current_state?, updated_at?` 뿐). 그래서 카드는 상태를 prop 으로 받지 않고 조회한 데이터의 `ongoing_since` 로 진행 중 비가동을 판단한다 — 모달이 넘길 수 없는 값을 요구하지 않는 것이 이 설계의 이유 중 하나다.

- [ ] **Step 4: 타입 검사**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 5: 린트와 전체 테스트**

Run: `npm run lint && npm test`
Expected: 신규 실패 없음

- [ ] **Step 6: 커밋**

```bash
git add src/components/machines/MachineDetailModal.tsx
git commit -m "feat(machines): 설비 상세 모달에 현재 교대 비가동 내역 표시 (읽기 전용)

모달에는 교대 컨텍스트가 없어 shiftUtils 로 해결해 주입한다 — 컴포넌트가
스스로 추측하지 않게 해 두 화면이 같은 창을 보게 한다."
```

---

## Task 10: 정정 마이그레이션 (적용하지 않음)

여기서부터가 쓰기 경로다. **이 태스크는 SQL 파일과 텍스트 계약 테스트만 만든다. 운영 DB에 적용하지 않는다.**

**Files:**
- Create: `supabase/migrations/20260728010000_correct_open_downtime_reason.sql`
- Create: `src/app/__tests__/correctDowntimeReasonMigration.test.ts`
- Modify: `supabase/applied-migrations.json`

- [ ] **Step 1: 마이그레이션 SQL 작성**

`supabase/migrations/20260728010000_correct_open_downtime_reason.sql`:

```sql
-- 진행 중인 비가동의 **사유 정정**. 분할이 아니라 덮어쓰기다.
--
-- [문제] toggle_machine_downtime 은 비가동 중 다른 사유로 start 를 부르면 기존 구간을
-- now() 에 닫고 새 구간을 연다(20260718000004, 88~101행). "상황이 바뀌었다"에는 정확하지만
-- "버튼을 잘못 눌렀다"에는 틀리다 — 존재한 적 없는 구간이 이력에 남고 OEE 에 반영된다.
--
-- [걸림돌] machines.current_state 를 UPDATE 하면 log_machine_status_change() 트리거가
-- **무조건** 열린 로그를 닫고 새 로그를 연다. 즉 트리거가 분할을 강제한다.
--
-- [해결] 트랜잭션 로컬 GUC 로 트리거에 "이건 전환이 아니라 정정"이라고 알린다.
-- app.status_operator_id 가 이미 같은 방식으로 쓰이고 있다(20260718000004).
--
-- ⚠️ 이 트리거는 machine_logs 의 **유일한 writer** 다(20260714 일원화 원칙). 플래그가 잘못
-- 켜지면 상태 변경이 조용히 기록되지 않는다. 방어:
--   1) set_config(..., true) 는 트랜잭션 로컬이라 다른 트랜잭션으로 새지 못한다
--   2) 이 파일의 correct_open_downtime_reason 외에는 아무도 설정하지 않는다
--   3) 일반 전환이 여전히 로그를 남기는지 회귀 테스트로 고정한다

-- 1) 트리거 함수: 정정 플래그가 켜져 있으면 로그를 분할하지 않는다.
--    나머지 동작은 20260718000004 와 동일하다(create or replace 로 대체).
create or replace function public.log_machine_status_change()
returns trigger
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
    log_state text;
    v_operator uuid;
begin
    -- 사유 정정: 상태 전이가 아니므로 열린 로그를 닫지 않는다. 정정 RPC 가 machine_logs.state
    -- 를 직접 갱신하고, 이 트리거는 비켜선다.
    if coalesce(nullif(current_setting('app.suppress_status_log', true), ''), '0') = '1' then
        return new;
    end if;

    -- machine_status ENUM 값은 machine_logs 허용 값과 1:1 이다. 알 수 없는 값만 방어한다.
    log_state := case
        when new.current_state::text in (
            'NORMAL_OPERATION', 'INSPECTION', 'BREAKDOWN_REPAIR', 'PM_MAINTENANCE',
            'MODEL_CHANGE', 'PLANNED_STOP', 'PROGRAM_CHANGE', 'TOOL_CHANGE', 'TEMPORARY_STOP'
        ) then new.current_state::text
        else 'NORMAL_OPERATION'
    end;

    -- service_role 경유(RPC)에서는 auth.uid() 가 NULL 이므로 호출자가 심은 GUC 를 우선한다.
    v_operator := coalesce(
        nullif(current_setting('app.status_operator_id', true), '')::uuid,
        auth.uid()
    );

    update machine_logs
    set end_time = now(),
        duration = extract(epoch from (now() - start_time)) / 60
    where machine_id = new.id
      and end_time is null;

    insert into machine_logs (machine_id, state, start_time, end_time, operator_id, created_at)
    values (new.id, log_state, now(), null, v_operator, now());

    return new;
end;
$function$;

-- 2) 정정 RPC. toggle_machine_downtime 과 **같은 advisory lock 키**를 잡아 정정과 토글이
--    경쟁하지 않게 한다.
create or replace function public.correct_open_downtime_reason(
  p_machine_id uuid,
  p_reason text,           -- machine_status 의 비정상 값(INSPECTION 등)
  p_operator_id uuid
) returns jsonb language plpgsql as $$
declare
  v_state text;
  v_entry_id uuid;
  v_old_reason text;
  v_logs_updated int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
  select current_state::text into v_state from public.machines where id = p_machine_id;

  if v_state is null then
    return jsonb_build_object('ok', false, 'reason', 'machine_not_found');
  end if;
  -- 진행 중인 비가동만 정정한다. 종료된 비가동은 확정 OEE 스냅샷을 건드리게 되므로 범위 밖.
  if v_state = 'NORMAL_OPERATION' then
    return jsonb_build_object('ok', false, 'reason', 'not_in_downtime');
  end if;
  if v_state = p_reason then
    return jsonb_build_object('ok', true, 'state', v_state, 'noop', true);
  end if;

  -- 트리거에게 "전환이 아니라 정정"이라고 알린다(트랜잭션 로컬).
  perform set_config('app.suppress_status_log', '1', true);

  update public.machine_logs
    set state = p_reason
    where machine_id = p_machine_id and end_time is null and state <> 'NORMAL_OPERATION';
  get diagnostics v_logs_updated = row_count;

  -- 열린 항목 중 **가장 최근 것 하나만** 고친다. 지금 운영 데이터에 유령 열린 항목은 없지만
  -- (2026-07-28 확인), 있더라도 무관한 행의 사유를 덮지 않게 하는 값싼 보험이다.
  select id, reason into v_entry_id, v_old_reason
    from public.downtime_entries
    where machine_id = p_machine_id and end_time is null
    order by start_time desc
    limit 1;

  if v_entry_id is not null then
    update public.downtime_entries set reason = p_reason where id = v_entry_id;
  end if;

  update public.machines set current_state = p_reason::machine_status where id = p_machine_id;

  -- 정정은 이력 수정이다. 누가 무엇을 언제 바꿨는지 남긴다.
  insert into public.audit_log (table_name, record_id, action, old_values, new_values, changed_by)
  values (
    'downtime_entries',
    v_entry_id,
    'correct_downtime_reason',
    jsonb_build_object('reason', coalesce(v_old_reason, v_state), 'current_state', v_state),
    jsonb_build_object('reason', p_reason, 'current_state', p_reason),
    p_operator_id
  );

  return jsonb_build_object(
    'ok', true,
    'state', p_reason,
    'entry_updated', v_entry_id is not null,
    'logs_updated', v_logs_updated
  );
end; $$;

revoke all on function public.correct_open_downtime_reason(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.correct_open_downtime_reason(uuid, text, uuid) to service_role;
```

- [ ] **Step 2: SQL 텍스트 계약 테스트 작성**

`src/app/__tests__/correctDowntimeReasonMigration.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260728010000_correct_open_downtime_reason.sql'),
  'utf8'
);

// 진행 중 비가동의 사유 정정. 분할이 아니라 덮어쓰기.
// (적용은 사용자 명시 지시 대기 — applied-migrations.json 의 intentionally_skipped 참조)
describe('correct_open_downtime_reason 마이그레이션', () => {
  it('정정 RPC 를 정의한다', () =>
    expect(sql).toMatch(/create\s+or\s+replace\s+function\s+public\.correct_open_downtime_reason/i));

  it('toggle 과 같은 advisory lock 키로 직렬화한다', () =>
    expect(sql).toMatch(/pg_advisory_xact_lock\(hashtextextended\(p_machine_id::text,\s*0\)\)/));

  it('가동 중이면 정정하지 않는다', () =>
    expect(sql).toMatch(/v_state\s*=\s*'NORMAL_OPERATION'[\s\S]*?not_in_downtime/i));

  it('같은 사유면 no-op', () =>
    expect(sql).toMatch(/v_state\s*=\s*p_reason[\s\S]*?noop/i));

  it('열린 downtime_entries 는 가장 최근 1건만 고친다', () => {
    expect(sql).toMatch(/order\s+by\s+start_time\s+desc[\s\S]*?limit\s+1/i);
    expect(sql).toMatch(/update\s+public\.downtime_entries\s+set\s+reason\s*=\s*p_reason\s+where\s+id\s*=\s*v_entry_id/i);
  });

  it('시작 시각을 바꾸지 않는다 (덮어쓰기이지 분할이 아니다)', () => {
    expect(sql).not.toMatch(/update\s+public\.downtime_entries[\s\S]{0,200}set[\s\S]{0,200}start_time\s*=/i);
    expect(sql).not.toMatch(/insert\s+into\s+public\.downtime_entries/i);
  });

  it('정정을 audit_log 에 남긴다', () => {
    expect(sql).toMatch(/insert\s+into\s+public\.audit_log/i);
    expect(sql).toMatch(/'correct_downtime_reason'/);
  });

  it('service_role 에만 EXECUTE 를 준다', () => {
    expect(sql).toMatch(/revoke\s+all\s+on\s+function\s+public\.correct_open_downtime_reason[\s\S]*?anon,\s*authenticated/i);
    expect(sql).toMatch(/grant\s+execute\s+on\s+function\s+public\.correct_open_downtime_reason[\s\S]*?to\s+service_role/i);
  });
});

// 트리거는 machine_logs 의 유일한 writer 다. 억제 플래그가 일반 전환의 로깅까지 죽이면
// 상태 이력이 조용히 사라진다 — 이 describe 가 그 회귀를 막는다.
describe('log_machine_status_change 억제 플래그', () => {
  it('트랜잭션 로컬 GUC 를 읽어 정정일 때만 비켜선다', () =>
    expect(sql).toMatch(/current_setting\('app\.suppress_status_log',\s*true\)[\s\S]*?=\s*'1'[\s\S]*?return\s+new/i));

  it('RPC 는 GUC 를 트랜잭션 로컬(is_local = true)로만 심는다', () =>
    expect(sql).toMatch(/set_config\('app\.suppress_status_log',\s*'1',\s*true\)/));

  it('플래그가 꺼진 일반 전환은 여전히 열린 로그를 닫고 새 로그를 연다', () => {
    expect(sql).toMatch(/update\s+machine_logs\s+set\s+end_time\s*=\s*now\(\)/i);
    expect(sql).toMatch(/insert\s+into\s+machine_logs\s*\(machine_id,\s*state,\s*start_time/i);
  });

  it('operator GUC 우선 규칙(20260718000004)을 유지한다', () =>
    expect(sql).toMatch(/current_setting\('app\.status_operator_id',\s*true\)/));
});
```

- [ ] **Step 3: 테스트를 실행해 통과를 확인**

Run: `npm test -- src/app/__tests__/correctDowntimeReasonMigration.test.ts`
Expected: PASS — 12 tests

- [ ] **Step 4: 마이그레이션 원장에 미적용으로 등록**

`supabase/applied-migrations.json`의 `intentionally_skipped` 객체에 아래 항목을 추가한다.

```json
"20260728010000_correct_open_downtime_reason": "사용자 승인 전 — 미적용 (비가동 사유 정정 RPC + 상태 로그 트리거 억제 플래그)"
```

- [ ] **Step 5: 마이그레이션 게이트 통과 확인**

Run: `npm run check:migrations`
Expected: `⏭️  skip     20260728010000_correct_open_downtime_reason  — 사용자 승인 전 — 미적용 ...` 이 출력되고, 마지막 줄이 `✅ 로컬 마이그레이션과 운영 적용 원장이 일치합니다.` (exit 0)

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations/20260728010000_correct_open_downtime_reason.sql src/app/__tests__/correctDowntimeReasonMigration.test.ts supabase/applied-migrations.json
git commit -m "feat(db): 진행 중 비가동 사유 정정 RPC (미적용)

machines.current_state UPDATE 가 트리거를 통해 로그 분할을 강제하므로,
트랜잭션 로컬 GUC app.suppress_status_log 로 '전환 아님'을 알린다. 이 트리거는
machine_logs 의 유일한 writer 이므로 일반 전환 로깅을 회귀 테스트로 고정한다.

운영 적용은 사용자 명시 지시 대기 — applied-migrations.json 의
intentionally_skipped 에 등록해 게이트를 통과시키면서 미적용을 드러낸다."
```

---

## Task 11: PATCH 엔드포인트

**Files:**
- Modify: `src/app/api/machines/[machineId]/downtime/route.ts`
- Modify: `src/app/api/machines/[machineId]/downtime/__tests__/route.test.ts`
- Modify: `src/app/api/__tests__/rolePolicy.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/app/api/machines/[machineId]/downtime/__tests__/route.test.ts` 상단의 import 를 아래로 바꾼다.

```ts
import { GET, PATCH, POST } from '../route';
```

파일 맨 아래에 덧붙인다.

```ts
describe('PATCH .../[machineId]/downtime (사유 정정)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssert.mockReturnValue(undefined);
    mockRpc.mockResolvedValue({ data: { ok: true, state: 'BREAKDOWN_REPAIR' }, error: null });
  });

  it('사유를 정정 RPC 로 전달한다', async () => {
    const res = await PATCH(req({ reason: 'BREAKDOWN_REPAIR' }), ctx);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('correct_open_downtime_reason', {
      p_machine_id: MACHINE, p_reason: 'BREAKDOWN_REPAIR', p_operator_id: 'op-1',
    });
  });

  it('유효하지 않은 사유는 400 (RPC 호출 안 함)', async () => {
    const res = await PATCH(req({ reason: 'NOT_A_STATE' }), ctx);
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('NORMAL_OPERATION 은 정정 사유가 될 수 없다', async () => {
    const res = await PATCH(req({ reason: 'NORMAL_OPERATION' }), ctx);
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('가동 중이면 409 로 되묻는다', async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, reason: 'not_in_downtime' }, error: null });
    const res = await PATCH(req({ reason: 'INSPECTION' }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toBe('not_in_downtime');
  });

  it('RPC 오류는 500', async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const res = await PATCH(req({ reason: 'INSPECTION' }), ctx);
    expect(res.status).toBe(500);
  });
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run: `npm test -- "src/app/api/machines/[machineId]/downtime"`
Expected: FAIL — `PATCH is not a function`

- [ ] **Step 3: PATCH 구현**

`src/app/api/machines/[machineId]/downtime/route.ts` 맨 아래에 추가한다.

```ts
/**
 * PATCH /api/machines/[machineId]/downtime — 진행 중인 비가동의 사유 정정.
 *
 * 정정은 **덮어쓰기**다. 시작 시각을 유지한 채 사유만 바꾼다. 사유를 바꾸며 구간을
 * 나누고 싶다면 그건 정정이 아니라 전환이고, POST(action='start')가 이미 그렇게 동작한다.
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ machineId: string }> }) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { machineId } = await ctx.params;
    const body = await request.json() as { reason?: unknown };
    const reason = typeof body.reason === 'string' ? body.reason : '';

    // NORMAL_OPERATION 은 DOWNTIME_REASONS 에 없다 — 정정으로 가동 재개를 흉내낼 수 없다.
    // 가동 재개는 POST(action='resume') 의 책임이고, 그쪽만 구간을 닫는다.
    if (!DOWNTIME_REASONS.has(reason)) {
      return NextResponse.json(
        { error: 'reason must be a valid non-normal machine_status' },
        { status: 400 }
      );
    }

    assertMachineAccess(user, machineId);

    const { data, error } = await supabaseAdmin.rpc('correct_open_downtime_reason', {
      p_machine_id: machineId,
      p_reason: reason,
      p_operator_id: user.userId,
    });

    if (error) {
      console.error('비가동 사유 정정 오류:', error);
      return NextResponse.json({ error: 'Failed to correct downtime reason' }, { status: 500 });
    }

    const result = data as { ok: boolean; state?: string; reason?: string };
    if (!result.ok) {
      // 가동 중이라 정정 대상이 없다 — 클라이언트가 목록을 새로고침하고 안내해야 한다.
      if (result.reason === 'not_in_downtime') {
        return NextResponse.json({ error: 'not_in_downtime' }, { status: 409 });
      }
      return NextResponse.json({ error: result.reason ?? 'failed' }, { status: 400 });
    }

    return NextResponse.json({ success: true, state: result.state }, { status: 200 });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
```

- [ ] **Step 4: 테스트를 실행해 통과를 확인**

Run: `npm test -- "src/app/api/machines/[machineId]/downtime"`
Expected: PASS — POST + GET + PATCH 전체

- [ ] **Step 5: 권한 정책 원장 갱신**

`src/app/api/__tests__/rolePolicy.test.ts`에서 아래 줄을 찾는다.

```ts
  'machines/[machineId]/downtime': { GET: AEO, POST: AEO },
```

아래로 바꾼다.

```ts
  'machines/[machineId]/downtime': { GET: AEO, PATCH: AEO, POST: AEO },
```

- [ ] **Step 6: 원장 테스트 통과 확인**

Run: `npm test -- src/app/api/__tests__/rolePolicy.test.ts`
Expected: PASS

- [ ] **Step 7: 커밋**

```bash
git add "src/app/api/machines/[machineId]/downtime/route.ts" "src/app/api/machines/[machineId]/downtime/__tests__/route.test.ts" src/app/api/__tests__/rolePolicy.test.ts
git commit -m "feat(api): 진행 중 비가동 사유 정정 PATCH 추가

정정은 덮어쓰기다. NORMAL_OPERATION 은 사유가 될 수 없어 정정으로 가동 재개를
흉내낼 수 없다 — 구간을 닫는 것은 POST(resume) 의 책임이다."
```

---

## Task 12: 정정 UI

**Files:**
- Modify: `src/components/downtime/DowntimeBreakdownCard.tsx`
- Modify: `src/components/downtime/__tests__/DowntimeBreakdownCard.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/downtime/__tests__/DowntimeBreakdownCard.test.tsx` 상단 import 를 아래로 바꾼다.

```tsx
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
```

그리고 mock 블록에 `authFetch` mock 을 추가한다(`jest.mock('@/hooks/useTranslation', ...)` 다음).

```tsx
const mockAuthFetch = jest.fn();
jest.mock('@/lib/authFetch', () => ({
  authFetch: (...a: unknown[]) => mockAuthFetch(...a),
}));
```

파일 맨 아래에 덧붙인다.

```tsx
describe('DowntimeBreakdownCard 사유 정정', () => {
  const ongoing: DowntimeBreakdownRow[] = [
    {
      id: 'de-1', source: 'downtime_entry', reason: 'INSPECTION',
      start: '2026-07-28T06:00:00.000Z', end: null,
      minutes: 23, clipped_start: false,
    },
  ];
  const downState = (over: Record<string, unknown> = {}) => state({
    intervals: ongoing,
    totalMinutes: 23,
    ongoingSince: '2026-07-28T06:00:00.000Z',
    ...over,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true }) });
  });

  it('allowCorrection 이 없으면 정정 버튼을 그리지 않는다', () => {
    mockUseBreakdown.mockReturnValue(downState());
    render(<DowntimeBreakdownCard {...base} />);
    expect(screen.queryByText(/downtimeBreakdown\.correct$/)).not.toBeInTheDocument();
  });

  it('종료된 건에는 정정 버튼을 그리지 않는다', () => {
    mockUseBreakdown.mockReturnValue(state());  // rows[0].end 가 채워져 있다
    render(<DowntimeBreakdownCard {...base} allowCorrection />);
    expect(screen.queryByText(/downtimeBreakdown\.correct$/)).not.toBeInTheDocument();
  });

  it('진행 중인 건의 정정 버튼을 누르면 사유 선택이 열린다', () => {
    mockUseBreakdown.mockReturnValue(downState());
    render(<DowntimeBreakdownCard {...base} allowCorrection />);
    fireEvent.click(screen.getByText(/downtimeBreakdown\.correct$/));
    expect(screen.getByText(/downtimeBreakdown\.correctTitle/)).toBeInTheDocument();
  });

  it('현재 사유는 선택지에서 제외한다', () => {
    mockUseBreakdown.mockReturnValue(downState());
    render(<DowntimeBreakdownCard {...base} allowCorrection />);
    fireEvent.click(screen.getByText(/downtimeBreakdown\.correct$/));
    // 진행 중인 건의 사유가 INSPECTION 이므로 그 버튼은 없다.
    // 정확 문자열로 비교한다 — 경과 배너에도 reason=INSPECTION 이 들어 있어서
    // 정규식으로 찾으면 버튼이 제대로 제외됐는데도 배너를 잡는다.
    expect(screen.queryByText('INSPECTION')).not.toBeInTheDocument();
    expect(screen.getByText('BREAKDOWN_REPAIR')).toBeInTheDocument();
  });

  it('사유를 고르면 PATCH 를 보내고 상위에 알린다', async () => {
    const onCorrected = jest.fn();
    const refresh = jest.fn();
    mockUseBreakdown.mockReturnValue(downState({ refresh }));
    render(<DowntimeBreakdownCard {...base} allowCorrection onCorrected={onCorrected} />);

    fireEvent.click(screen.getByText(/downtimeBreakdown\.correct$/));
    fireEvent.click(screen.getByText('BREAKDOWN_REPAIR'));

    await waitFor(() => {
      expect(mockAuthFetch).toHaveBeenCalledWith(
        `/api/machines/${MACHINE}/downtime`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ reason: 'BREAKDOWN_REPAIR' }),
        })
      );
    });
    await waitFor(() => expect(onCorrected).toHaveBeenCalled());
    expect(refresh).toHaveBeenCalled();
  });

  it('정정에 실패하면 오류를 보여주고 상위에 성공을 알리지 않는다', async () => {
    const onCorrected = jest.fn();
    mockAuthFetch.mockResolvedValue({ ok: false, status: 409, json: async () => ({ error: 'not_in_downtime' }) });
    mockUseBreakdown.mockReturnValue(downState());
    render(<DowntimeBreakdownCard {...base} allowCorrection onCorrected={onCorrected} />);

    fireEvent.click(screen.getByText(/downtimeBreakdown\.correct$/));
    fireEvent.click(screen.getByText('BREAKDOWN_REPAIR'));

    await waitFor(() => expect(screen.getByText(/correctNotInDowntime/)).toBeInTheDocument());
    expect(onCorrected).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인**

Run: `npm test -- src/components/downtime`
Expected: FAIL — 정정 버튼을 찾지 못함

- [ ] **Step 3: 정정 UI 구현**

`src/components/downtime/DowntimeBreakdownCard.tsx`의 import 블록을 아래로 바꾼다.

```tsx
'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Collapse, Modal, Space, Tag, Typography } from 'antd';
import { useDowntimeBreakdown } from '@/hooks/useDowntimeBreakdown';
import { useMultipleTranslation } from '@/hooks/useTranslation';
import { resolveDowntimeReasonLabel } from '@/utils/downtimeReasonLabel';
import { authFetch } from '@/lib/authFetch';
import type { DowntimeBreakdownRow } from '@/utils/downtimeBreakdown';
import type { MachineState } from '@/types';
```

`TICK_MS` 상수 아래에 사유 목록을 추가한다.

```tsx
// machine_status ENUM 의 비정상 값(NORMAL 제외). DowntimeAndonSection 과 같은 8개다.
const REASONS: MachineState[] = [
  'INSPECTION', 'BREAKDOWN_REPAIR', 'PM_MAINTENANCE', 'MODEL_CHANGE',
  'PLANNED_STOP', 'PROGRAM_CHANGE', 'TOOL_CHANGE', 'TEMPORARY_STOP',
];
```

컴포넌트 본문의 `const ongoingRow = ...` 줄 **위**에 정정 상태와 핸들러를 추가한다.

```tsx
  const [correcting, setCorrecting] = useState(false);
  const [correctError, setCorrectError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submitCorrection = useCallback(async (reason: MachineState) => {
    setBusy(true);
    setCorrectError(null);
    try {
      const res = await authFetch(`/api/machines/${machineId}/downtime`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        // 409 = 이미 가동 재개됨. 일반 실패와 다른 안내가 필요하다.
        setCorrectError(
          res.status === 409
            ? t('downtimeBreakdown.correctNotInDowntime')
            : t('downtimeBreakdown.correctFailed')
        );
        return;
      }
      setCorrecting(false);
      refresh();
      onCorrected();
    } catch {
      setCorrectError(t('downtimeBreakdown.correctFailed'));
    } finally {
      setBusy(false);
    }
  }, [machineId, onCorrected, refresh, t]);
```

`renderRow` 안의 `<Text>{resolveDowntimeReasonLabel(row.reason, t)}</Text>` 바로 다음에 정정 버튼을 추가한다.

```tsx
      {row.end === null && allowCorrection && (
        <Button size="small" type="link" onClick={() => { setCorrectError(null); setCorrecting(true); }}>
          {t('downtimeBreakdown.correct')}
        </Button>
      )}
```

컴포넌트 return 문의 닫는 `</Space>` **바로 앞**에 모달을 추가한다.

```tsx
      <Modal
        open={correcting}
        title={t('downtimeBreakdown.correctTitle')}
        footer={null}
        onCancel={() => setCorrecting(false)}
      >
        <Space direction="vertical" style={{ width: '100%' }}>
          <Alert type="info" showIcon message={t('downtimeBreakdown.correctHint')} />
          {correctError && <Alert type="error" showIcon message={correctError} />}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {/* 현재 사유는 제외한다 — 같은 사유로 정정하면 RPC 가 no-op 이라 눌러도 아무 일이
                일어나지 않는다. 누를 수 없는 버튼을 보여주지 않는다. */}
            {REASONS.filter(reason => reason !== ongoingRow?.reason).map(reason => (
              <Button
                key={reason}
                size="large"
                style={{ height: 56 }}
                loading={busy}
                onClick={() => void submitCorrection(reason)}
              >
                {resolveDowntimeReasonLabel(reason, t)}
              </Button>
            ))}
          </div>
        </Space>
      </Modal>
```

- [ ] **Step 4: 테스트를 실행해 통과를 확인**

Run: `npm test -- src/components/downtime`
Expected: PASS — 14 tests

- [ ] **Step 5: 커밋**

```bash
git add src/components/downtime/
git commit -m "feat(downtime): 진행 중 비가동의 사유 정정 UI

정정은 운영자 콘솔(allowCorrection)에서 진행 중인 건에만 열린다. 409(이미 가동
재개)는 일반 실패와 다른 안내를 준다."
```

---

## Task 13: 최종 검증

- [ ] **Step 1: 전체 테스트**

Run: `npm test -- --runInBand`
Expected: 신규 실패 0건. 기존에 실패하던 테스트가 있다면 그것과 구분해 보고한다.

- [ ] **Step 2: 타입 검사**

Run: `npx tsc --noEmit --incremental false`
Expected: 오류 없음

- [ ] **Step 3: 린트**

Run: `npm run lint`
Expected: 신규 경고·오류 없음

- [ ] **Step 4: 마이그레이션 원장**

Run: `npm run check:migrations`
Expected: exit 0. `20260728010000_correct_open_downtime_reason` 이 `⏭️ skip` 로 출력된다

- [ ] **Step 5: 프로덕션 빌드**

Run: `npm run build`
Expected: 성공. Next.js 16 빌드는 TypeScript는 검사하지만 ESLint는 실행하지 않으므로 Step 3과 별개로 확인해야 한다

- [ ] **Step 6: 두 화면을 눈으로 확인**

Run: `npm run dev`

확인 항목:
1. 운영자 대시보드 → 작업 콘솔 열기 → 비가동 카드에 누적과 "비가동 내역 보기"가 보인다
2. 비가동 중인 설비(CNC-001)에서 경과 시간이 보이고 10초마다 갱신된다
3. 내역을 펼치면 각 줄에 시각·분·사유가 보인다
4. 정상 가동 중인 설비에서는 경과 배너가 없고 누적만 보인다
5. 설비 목록 → 설비 카드 클릭 → 상세 모달에 같은 내역이 보이고 **정정 버튼은 없다**
6. 언어를 베트남어로 바꿔도 모든 문구가 번역된다(키 원문이 보이면 안 된다)

정정 버튼은 마이그레이션이 미적용이므로 **500 또는 RPC 없음 오류가 정상**이다. 사용자가 마이그레이션 적용을 승인한 뒤에 다시 확인한다.

- [ ] **Step 7: 브랜치 상태 확인 (병합하지 않는다)**

Run: `git log --oneline main..HEAD && git status`
Expected: 이 계획의 커밋들이 보이고 working tree 는 깨끗하다. **main 병합과 SQL 적용은 사용자 지시 대기.**

---

## 미결 사항 (사용자 확인 필요)

1. **`resolveDowntimeReasonLabel` 의 폴백** — Task 4 Step 3. 두 사전 어디에도 없는 코드를 만났을 때의 동작을 사용자가 직접 작성한다. 현재는 원본 코드를 노출하는 안이 자리를 잡고 있다.
2. **마이그레이션 적용** — Task 10의 SQL은 파일로만 존재한다. 적용은 사용자 지시 후 별도 세션에서 진행하고, 그때 `applied-migrations.json` 의 `intentionally_skipped` 에서 빼고 `applied` + `hashes` 로 옮긴다.
3. **main 병합** — 기능이 완성되고 사용자가 지시할 때만.
