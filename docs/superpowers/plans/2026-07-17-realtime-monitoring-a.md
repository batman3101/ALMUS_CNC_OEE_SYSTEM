# 실시간 감시 (A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 작업자가 교대 중 태블릿으로 생산 수량을 입력하면, 경과 시간 기준 가동×성능과 CAPA 대비 진척을 실시간으로 본다.

**Architecture:** 진행 보고를 신규 append-only 테이블(`production_progress_reports`)에 쌓고, 확정 데이터(`production_records`)는 손대지 않는다. 계산은 `now`를 주입받는 순수 함수로 분리해 결정론적으로 테스트한다. 비가동은 기존 `downtime_entries`를 읽는다.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Supabase(PostgreSQL/RLS), Jest, Ant Design 5

**Spec:** `docs/superpowers/specs/2026-07-17-realtime-production-monitoring-design.md`

---

## File Structure

| 파일 | 책임 |
|---|---|
| `supabase/migrations/20260718000000_production_progress_reports.sql` | 신규 테이블 + 인덱스 + RLS |
| `src/utils/shiftBreaks.ts` | 휴식 시간대 상수 + 경과 휴식 계산 (순수) |
| `src/utils/realtimeProgress.ts` | 경과 계획시간·가동×성능·진척 계산 (순수) |
| `src/app/api/production-progress/route.ts` | POST(보고 저장) · GET(현재 상태) |
| `src/hooks/useRealtimeProgress.ts` | 클라이언트 조회 훅 |
| `src/components/production/ProgressInputModal.tsx` | 태블릿 입력 모달 |
| `src/components/dashboard/OperatorDashboard.tsx` | 진행 상태 표시 + 입력 버튼 (수정) |

**분리 이유:** `shiftBreaks`와 `realtimeProgress`는 DB·React·시계를 모르는 순수 모듈이다. 이 프로젝트에서 시각 의존 테스트가 flaky를 만든 전례가 있어(2026-07-16, `Date` 고정으로 결정론화), `now`를 인자로 받는다.

---

## Task 1: 휴식 시간대 (순수 함수)

**Files:**
- Create: `src/utils/shiftBreaks.ts`
- Test: `src/utils/__tests__/shiftBreaks.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/utils/__tests__/shiftBreaks.test.ts`:

```ts
import {
  SHIFT_BREAK_WINDOWS,
  TOTAL_BREAK_MINUTES,
  elapsedBreakMinutes,
} from '../shiftBreaks';

// 교대 시작 시각. B 교대는 date 당일 20:00 에 시작해 다음날 08:00 에 끝난다.
const shiftAStart = (d = '2026-07-17') => new Date(`${d}T08:00:00+07:00`);
const shiftBStart = (d = '2026-07-17') => new Date(`${d}T20:00:00+07:00`);
const at = (iso: string) => new Date(iso);

describe('shiftBreaks', () => {
  // system_settings(category='shift').break_time_minutes = 110 (운영 실측).
  // 시간대 합계가 이 값과 어긋나면 실시간 화면과 확정 OEE 가 서로 다른 말을 한다.
  it('A/B 교대 휴식 합계가 총량 110분과 일치한다', () => {
    expect(TOTAL_BREAK_MINUTES).toBe(110);
    for (const shift of ['A', 'B'] as const) {
      const sum = SHIFT_BREAK_WINDOWS[shift].reduce((n, w) => n + w.minutes, 0);
      expect(sum).toBe(TOTAL_BREAK_MINUTES);
    }
  });

  it('A 교대: 10:00 시점에 09:50~10:00 만 지났다', () => {
    expect(elapsedBreakMinutes('A', shiftAStart(), at('2026-07-17T10:00:00+07:00'))).toBe(10);
  });

  it('A 교대: 09:55 시점에는 휴식이 절반만 지났다', () => {
    expect(elapsedBreakMinutes('A', shiftAStart(), at('2026-07-17T09:55:00+07:00'))).toBe(5);
  });

  it('A 교대: 교대 시작 직후엔 0분', () => {
    expect(elapsedBreakMinutes('A', shiftAStart(), at('2026-07-17T08:00:00+07:00'))).toBe(0);
  });

  it('A 교대: 종료 시각엔 총량이 모두 지났다', () => {
    expect(elapsedBreakMinutes('A', shiftAStart(), at('2026-07-17T20:00:00+07:00'))).toBe(110);
  });

  // B 교대의 23:20~00:20 은 자정을 넘는다. 이 프로젝트에서 자정 경계는 반복된 함정이다.
  it('B 교대: 자정을 넘는 휴식(23:20~00:20)을 절반만 지난 시점', () => {
    expect(elapsedBreakMinutes('B', shiftBStart(), at('2026-07-17T23:50:00+07:00'))).toBe(10 + 30);
  });

  it('B 교대: 자정 넘긴 00:20 에 그 구간이 끝난다', () => {
    expect(elapsedBreakMinutes('B', shiftBStart(), at('2026-07-18T00:20:00+07:00'))).toBe(10 + 60);
  });

  it('B 교대: 다음날 08:00 종료 시 총량이 모두 지났다', () => {
    expect(elapsedBreakMinutes('B', shiftBStart(), at('2026-07-18T08:00:00+07:00'))).toBe(110);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test -- --testPathPatterns="shiftBreaks"`
Expected: FAIL — `Cannot find module '../shiftBreaks'`

- [ ] **Step 3: 최소 구현**

`src/utils/shiftBreaks.ts`:

```ts
/**
 * 교대별 휴식 시간대.
 *
 * system_settings(category='shift') 는 총량(break_time_minutes = 110)만 알고 시각은 모른다.
 * 실시간 가동률을 계산하려면 "지금까지 휴식이 얼마나 지났나"가 필요하므로 시각을 여기 둔다.
 *
 * 같은 사실의 출처가 둘이 되는 것을 경계한다 — 합계는 반드시 break_time_minutes 와 같아야
 * 하고, 테스트가 이를 고정한다. 기존 plannedRuntime.ts 는 총량을 계속 쓰며 건드리지 않는다.
 *
 * 중식·석식 시각이 가끔 바뀌어도 고정값으로 둔다(현장 결정). 4개 구간이 모두 교대 안에
 * 있으므로 교대가 끝나면 110분이 다 지나가고, 배치는 교대 *중* 정밀도에만 영향을 준다.
 */

/** 교대 시작으로부터의 분 단위 오프셋. B 교대의 23:20~00:20 은 자정을 넘지만 오프셋으로
 *  표현하면 경계가 사라진다 (20:00 시작 → 200분~260분). */
export interface BreakWindow {
  /** 교대 시작 이후 경과 분 */
  startOffsetMinutes: number;
  minutes: number;
}

export const TOTAL_BREAK_MINUTES = 110;

const window = (startOffsetMinutes: number, minutes: number): BreakWindow => ({
  startOffsetMinutes,
  minutes,
});

/**
 * A: 08:00 시작 → 09:50(110분), 11:20(200분), 14:50(410분), 17:30(570분)
 * B: 20:00 시작 → 21:50(110분), 23:20(200분), 02:50(410분), 05:30(570분)
 * 두 교대의 오프셋이 같다 (야간조는 주간조에 대응하는 시각).
 */
const WINDOWS_BY_OFFSET: BreakWindow[] = [
  window(110, 10),  // A 09:50~10:00 / B 21:50~22:00
  window(200, 60),  // A 11:20~12:20 / B 23:20~00:20 (자정 넘음)
  window(410, 10),  // A 14:50~15:00 / B 02:50~03:00
  window(570, 30),  // A 17:30~18:00 / B 05:30~06:00
];

export const SHIFT_BREAK_WINDOWS: Record<'A' | 'B', BreakWindow[]> = {
  A: WINDOWS_BY_OFFSET,
  B: WINDOWS_BY_OFFSET,
};

/**
 * 교대 시작부터 now 까지 지나간 휴식(분). 진행 중인 휴식은 지난 만큼만 센다.
 * now 를 인자로 받아 결정론적으로 테스트한다 — 시각 의존은 flaky 의 원흉이다.
 */
export function elapsedBreakMinutes(shift: 'A' | 'B', shiftStart: Date, now: Date): number {
  const elapsed = (now.getTime() - shiftStart.getTime()) / 60_000;
  if (!Number.isFinite(elapsed) || elapsed <= 0) return 0;

  return SHIFT_BREAK_WINDOWS[shift].reduce((total, w) => {
    const consumed = Math.min(Math.max(elapsed - w.startOffsetMinutes, 0), w.minutes);
    return total + consumed;
  }, 0);
}
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm test -- --testPathPatterns="shiftBreaks"`
Expected: PASS — 8 tests

- [ ] **Step 5: 커밋**

```bash
git add src/utils/shiftBreaks.ts src/utils/__tests__/shiftBreaks.test.ts
git commit -m "feat(realtime): 교대별 휴식 시간대와 경과 휴식 계산"
```

---

## Task 2: 실시간 진행 계산 (순수 함수)

**Files:**
- Create: `src/utils/realtimeProgress.ts`
- Test: `src/utils/__tests__/realtimeProgress.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/utils/__tests__/realtimeProgress.test.ts`:

```ts
import { calculateRealtimeProgress } from '../realtimeProgress';

// 스펙 §6.1 의 실측 기준값. CNC-001: tact 72초/개.
// 가동 720분 − 휴식 110분 = 계획 610분. CAPA = 610 / (72/60) = 508개.
const base = {
  shift: 'A' as const,
  shiftStart: new Date('2026-07-17T08:00:00+07:00'),
  operatingMinutes: 720,
  tactTimeSeconds: 72,
  downtimeMinutes: 0,
  shiftOutputQty: 60,
};

describe('calculateRealtimeProgress', () => {
  it('스펙 §6.1 예시를 그대로 재현한다 (10:00, 60개, 비가동 0)', () => {
    const r = calculateRealtimeProgress({ ...base, now: new Date('2026-07-17T10:00:00+07:00') });

    expect(r.elapsedPlannedMinutes).toBe(110);   // 120 경과 − 10 휴식
    expect(r.actualRuntimeMinutes).toBe(110);
    expect(r.idealRuntimeMinutes).toBeCloseTo(72, 5);
    expect(r.availability).toBeCloseTo(1, 5);
    expect(r.performance).toBeCloseTo(72 / 110, 5);
    expect(r.availabilityTimesPerformance).toBeCloseTo(72 / 110, 5);
    expect(r.capaQty).toBe(508);
    expect(r.progressRatio).toBeCloseTo(60 / 508, 5);
    expect(r.elapsedRatio).toBeCloseTo(110 / 610, 5);
  });

  // 품질은 검사 전이라 모른다. 0% 로 단정하면 멀쩡한 설비가 죽은 것처럼 보인다
  // (2026-07-17 PR #18 에서 고친 버그를 새 기능으로 재생산하는 셈).
  it('OEE 와 품질을 계산하지 않는다 (필드 자체가 없다)', () => {
    const r = calculateRealtimeProgress({ ...base, now: new Date('2026-07-17T10:00:00+07:00') });
    expect(r).not.toHaveProperty('oee');
    expect(r).not.toHaveProperty('quality');
  });

  it('보고가 없으면 성능·진척은 null 이고 가동률은 계산된다', () => {
    const r = calculateRealtimeProgress({
      ...base,
      shiftOutputQty: null,
      now: new Date('2026-07-17T10:00:00+07:00'),
    });

    expect(r.availability).toBeCloseTo(1, 5);
    expect(r.performance).toBeNull();
    expect(r.availabilityTimesPerformance).toBeNull();
    expect(r.progressQty).toBeNull();
    expect(r.progressRatio).toBeNull();
  });

  it('비가동이 있으면 가동률이 내려간다', () => {
    const r = calculateRealtimeProgress({
      ...base,
      downtimeMinutes: 11,
      now: new Date('2026-07-17T10:00:00+07:00'),
    });

    expect(r.actualRuntimeMinutes).toBe(99);          // 110 − 11
    expect(r.availability).toBeCloseTo(99 / 110, 5);
  });

  it('교대 시작 직후 경과 계획시간이 0 이면 비율을 만들지 않는다', () => {
    const r = calculateRealtimeProgress({ ...base, now: new Date('2026-07-17T08:00:00+07:00') });

    expect(r.elapsedPlannedMinutes).toBe(0);
    expect(r.availability).toBeNull();
    expect(r.performance).toBeNull();
    expect(r.availabilityTimesPerformance).toBeNull();
  });

  it('교대 종료 시 경과 계획시간이 610분이 된다', () => {
    const r = calculateRealtimeProgress({ ...base, now: new Date('2026-07-17T20:00:00+07:00') });
    expect(r.elapsedPlannedMinutes).toBe(610);
  });

  // 기존 OEECalculator 와 같은 규칙: 비율은 0..1 로 자른다.
  it('성능률이 1 을 넘지 않는다', () => {
    const r = calculateRealtimeProgress({
      ...base,
      shiftOutputQty: 500,
      now: new Date('2026-07-17T10:00:00+07:00'),
    });
    expect(r.performance).toBe(1);
  });

  // tact 는 개당(1 piece) 이며 cavity 로 나누지 않는다 (CLAUDE.md 의 도메인 규칙).
  it('tact 가 0 이하면 성능을 계산하지 않는다', () => {
    const r = calculateRealtimeProgress({
      ...base,
      tactTimeSeconds: 0,
      now: new Date('2026-07-17T10:00:00+07:00'),
    });
    expect(r.performance).toBeNull();
    expect(r.capaQty).toBeNull();
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test -- --testPathPatterns="realtimeProgress"`
Expected: FAIL — `Cannot find module '../realtimeProgress'`

- [ ] **Step 3: 최소 구현**

`src/utils/realtimeProgress.ts`:

```ts
import { elapsedBreakMinutes, TOTAL_BREAK_MINUTES } from './shiftBreaks';

/**
 * 교대 중 실시간 진행 계산.
 *
 * OEE 는 만들지 않는다. 불량은 다음날 검사하므로 교대 중 품질은 "모른다". 품질을 100% 로
 * 가정해 OEE 를 띄우면 미보고를 0% 로 단정하던 버그(2026-07-17 PR #18)를 방향만 바꿔
 * 재생산하는 것이고, 게다가 항상 낙관적으로 틀린다.
 *
 * 대신 가동×성능은 검사와 무관한 확정값이다. 현장이 실시간으로 알고 싶은 것도 이것이다 —
 * 설비가 지금 잘 돌고 있나.
 */
export interface RealtimeProgressInput {
  shift: 'A' | 'B';
  shiftStart: Date;
  /** 현재 시각. 인자로 받아 결정론적으로 테스트한다. */
  now: Date;
  /** 교대 가동시간(분). 기본 720. */
  operatingMinutes: number;
  /** 개당 가공시간(초). cavity 로 나누지 않는다. */
  tactTimeSeconds: number;
  /** 지금까지의 비가동(분). */
  downtimeMinutes: number;
  /** 마지막 진행 보고의 "이 교대 누적 생산 수량". 보고가 없으면 null. */
  shiftOutputQty: number | null;
}

export interface RealtimeProgress {
  elapsedPlannedMinutes: number;
  actualRuntimeMinutes: number;
  idealRuntimeMinutes: number | null;
  /** null = 계산 불가. 0 과 구분해야 한다. */
  availability: number | null;
  performance: number | null;
  availabilityTimesPerformance: number | null;
  plannedRuntimeMinutes: number;
  capaQty: number | null;
  progressQty: number | null;
  progressRatio: number | null;
  elapsedRatio: number;
}

const clampRatio = (numerator: number, denominator: number): number | null => {
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return null;
  }
  return Math.min(1, Math.max(0, numerator / denominator));
};

export function calculateRealtimeProgress(input: RealtimeProgressInput): RealtimeProgress {
  const { shift, shiftStart, now, operatingMinutes, tactTimeSeconds, downtimeMinutes } = input;

  const elapsedTotal = Math.max(0, (now.getTime() - shiftStart.getTime()) / 60_000);
  const cappedElapsed = Math.min(elapsedTotal, operatingMinutes);
  const breaksSoFar = elapsedBreakMinutes(shift, shiftStart, now);
  const elapsedPlannedMinutes = Math.max(0, cappedElapsed - breaksSoFar);

  const plannedRuntimeMinutes = Math.max(0, operatingMinutes - TOTAL_BREAK_MINUTES);
  const actualRuntimeMinutes = Math.max(0, elapsedPlannedMinutes - Math.max(0, downtimeMinutes));

  const minutesPerUnit = tactTimeSeconds > 0 ? tactTimeSeconds / 60 : null;

  const idealRuntimeMinutes =
    minutesPerUnit !== null && input.shiftOutputQty !== null
      ? input.shiftOutputQty * minutesPerUnit
      : null;

  const availability = clampRatio(actualRuntimeMinutes, elapsedPlannedMinutes);
  const performance =
    idealRuntimeMinutes === null ? null : clampRatio(idealRuntimeMinutes, actualRuntimeMinutes);

  const availabilityTimesPerformance =
    availability !== null && performance !== null ? availability * performance : null;

  const capaQty = minutesPerUnit !== null ? Math.floor(plannedRuntimeMinutes / minutesPerUnit) : null;

  return {
    elapsedPlannedMinutes,
    actualRuntimeMinutes,
    idealRuntimeMinutes,
    availability,
    performance,
    availabilityTimesPerformance,
    plannedRuntimeMinutes,
    capaQty,
    progressQty: input.shiftOutputQty,
    progressRatio:
      capaQty !== null && capaQty > 0 && input.shiftOutputQty !== null
        ? input.shiftOutputQty / capaQty
        : null,
    elapsedRatio: plannedRuntimeMinutes > 0 ? elapsedPlannedMinutes / plannedRuntimeMinutes : 0,
  };
}
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm test -- --testPathPatterns="realtimeProgress"`
Expected: PASS — 8 tests

- [ ] **Step 5: 커밋**

```bash
git add src/utils/realtimeProgress.ts src/utils/__tests__/realtimeProgress.test.ts
git commit -m "feat(realtime): 경과 시간 기준 가동×성능·진척 계산"
```

---

## Task 3: 신규 테이블 + RLS

**Files:**
- Create: `supabase/migrations/20260718000000_production_progress_reports.sql`
- Test: `src/app/__tests__/progressReportsMigration.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/app/__tests__/progressReportsMigration.test.ts`:

```ts
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const PATH = 'supabase/migrations/20260718000000_production_progress_reports.sql';

describe('production_progress_reports 마이그레이션', () => {
  it('마이그레이션 파일이 존재한다', () => {
    expect(existsSync(resolve(process.cwd(), PATH))).toBe(true);
  });

  const sql = () => readFileSync(resolve(process.cwd(), PATH), 'utf8');

  it('append-only 를 위해 UPDATE/DELETE 정책을 만들지 않는다', () => {
    const s = sql().toLowerCase();
    expect(s).toContain('for insert');
    expect(s).toContain('for select');
    expect(s).not.toContain('for update');
    expect(s).not.toContain('for delete');
  });

  it('RLS 를 켠다', () => {
    expect(sql().toLowerCase()).toContain('enable row level security');
  });

  // 조회는 항상 (machine_id, date, shift) 로 최신 보고를 찾는다.
  it('조회 패턴에 맞는 인덱스를 만든다', () => {
    expect(sql()).toMatch(/create index[\s\S]*machine_id[\s\S]*date[\s\S]*shift/i);
  });

  it('production_records 를 건드리지 않는다', () => {
    expect(sql()).not.toMatch(/alter table\s+(public\.)?production_records/i);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test -- --testPathPatterns="progressReportsMigration"`
Expected: FAIL — `expect(existsSync(...)).toBe(true)` 가 false

- [ ] **Step 3: 최소 구현**

`supabase/migrations/20260718000000_production_progress_reports.sql`:

```sql
-- 교대 중 진행 보고 (append-only).
--
-- 진행 중 데이터와 확정 데이터(production_records)를 물리적으로 분리한다. 그래야 진행 중
-- 교대(2시간, 60%)가 완료 교대(12시간, 96%)와 같이 평균나는 사고가 일어날 수 없다.
-- production_records 는 손대지 않으므로 기존 분석 RPC 는 그대로 동작한다.
--
-- shift_output_qty 의 의미는 하나다: "이 교대에서 지금까지 만든 총 개수".
-- 작업자가 그 숫자를 어떻게 얻는지(카운터 판독/뺄셈/수기 집계)는 규정하지 않는다.

CREATE TABLE IF NOT EXISTS public.production_progress_reports (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id        uuid        NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  date              date        NOT NULL,
  shift             text        NOT NULL CHECK (shift IN ('A', 'B')),
  reported_at       timestamptz NOT NULL DEFAULT now(),
  shift_output_qty  integer     NOT NULL CHECK (shift_output_qty >= 0),
  operator_id       uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

COMMENT ON COLUMN public.production_progress_reports.shift_output_qty IS
  '이 교대에서 지금까지 만든 총 개수 (누적). 파악 방법은 규정하지 않는다.';
COMMENT ON COLUMN public.production_progress_reports.date IS
  '교대 귀속일. B 교대는 시작일 (자정을 넘겨도 시작일로 귀속).';

-- 조회는 항상 "이 설비, 이 날짜, 이 교대의 최신 보고"를 찾는다.
CREATE INDEX IF NOT EXISTS idx_progress_reports_machine_shift
  ON public.production_progress_reports (machine_id, date, shift, reported_at DESC);

ALTER TABLE public.production_progress_reports ENABLE ROW LEVEL SECURITY;

-- append-only: UPDATE/DELETE 정책을 만들지 않는다. 오타는 수정이 아니라 새 보고로 덮는다.
-- "13:00 에 150개였다"는 불변 사실이고, 사실은 고쳐 쓰는 게 아니라 다음 사실로 갱신한다.

CREATE POLICY progress_reports_select ON public.production_progress_reports
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY progress_reports_insert ON public.production_progress_reports
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = operator_id);
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm test -- --testPathPatterns="progressReportsMigration"`
Expected: PASS — 5 tests

- [ ] **Step 5: 운영 DB 에 적용**

`supabase db push` 는 이 프로젝트에서 안전하지 않다 (버전 불일치). MCP `apply_migration` 을 쓴다.

적용 후 확인:

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'production_progress_reports' ORDER BY ordinal_position;
```
Expected: 8개 컬럼

```sql
SELECT policyname, cmd FROM pg_policies WHERE tablename = 'production_progress_reports';
```
Expected: `progress_reports_select`(SELECT), `progress_reports_insert`(INSERT) 만. UPDATE/DELETE 없음.

- [ ] **Step 6: 커밋**

```bash
git add supabase/migrations/20260718000000_production_progress_reports.sql src/app/__tests__/progressReportsMigration.test.ts
git commit -m "feat(realtime): 진행 보고 테이블 (append-only) + RLS"
```

---

## Task 4: API — 보고 저장 (POST)

**Files:**
- Create: `src/app/api/production-progress/route.ts`
- Test: `src/app/api/production-progress/__tests__/route.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/app/api/production-progress/__tests__/route.test.ts`:

```ts
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockRequireUser = jest.fn();
const mockAssertMachineAccess = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: (...a: unknown[]) => mockAssertMachineAccess(...a),
  apiAuthErrorResponse: () => null,
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a) },
}));

import { POST } from '../route';

const MACHINE = '11111111-1111-4111-8111-111111111111';

const request = (body: unknown) => ({
  url: 'http://localhost/api/production-progress',
  json: async () => body,
}) as never;

/** 마지막 보고 조회 → insert 를 순서대로 흉내낸다. */
const mockChain = (lastReport: { shift_output_qty: number } | null) => {
  const insert = jest.fn().mockResolvedValue({ error: null });
  mockFrom.mockImplementation((table: string) => {
    if (table === 'production_progress_reports') {
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              eq: () => ({
                order: () => ({
                  limit: () => ({ maybeSingle: async () => ({ data: lastReport, error: null }) }),
                }),
              }),
            }),
          }),
        }),
        insert,
      };
    }
    throw new Error(`unexpected table ${table}`);
  });
  return { insert };
};

describe('POST /api/production-progress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssertMachineAccess.mockReturnValue(undefined);
  });

  it('보고를 저장한다', async () => {
    const { insert } = mockChain({ shift_output_qty: 60 });

    const res = await POST(request({
      machine_id: MACHINE, date: '2026-07-17', shift: 'A', shift_output_qty: 150,
    }));

    expect(res.status).toBe(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      machine_id: MACHINE, date: '2026-07-17', shift: 'A',
      shift_output_qty: 150, operator_id: 'op-1',
    }));
  });

  // 값의 의미가 "교대 누적"이므로 감소는 불가능하다. 조용히 받으면 90개가 증발한다.
  it('보고값이 줄어들면 거부하고 되묻는다', async () => {
    const { insert } = mockChain({ shift_output_qty: 150 });

    const res = await POST(request({
      machine_id: MACHINE, date: '2026-07-17', shift: 'A', shift_output_qty: 60,
    }));

    expect(res.status).toBe(409);
    expect(insert).not.toHaveBeenCalled();
    const body = await res.json() as { error: string; last_reported_qty: number };
    expect(body.last_reported_qty).toBe(150);
  });

  it('같은 값 재보고는 허용한다 (변화 없음은 감소가 아니다)', async () => {
    const { insert } = mockChain({ shift_output_qty: 150 });

    const res = await POST(request({
      machine_id: MACHINE, date: '2026-07-17', shift: 'A', shift_output_qty: 150,
    }));

    expect(res.status).toBe(201);
    expect(insert).toHaveBeenCalled();
  });

  it('첫 보고는 이전 값이 없어도 저장된다', async () => {
    const { insert } = mockChain(null);

    const res = await POST(request({
      machine_id: MACHINE, date: '2026-07-17', shift: 'A', shift_output_qty: 30,
    }));

    expect(res.status).toBe(201);
    expect(insert).toHaveBeenCalled();
  });

  it('담당이 아닌 설비는 거부한다', async () => {
    mockChain(null);
    mockAssertMachineAccess.mockImplementation(() => { throw new Error('forbidden'); });

    await expect(POST(request({
      machine_id: MACHINE, date: '2026-07-17', shift: 'A', shift_output_qty: 30,
    }))).rejects.toThrow();
  });

  it('음수는 400 으로 거부한다', async () => {
    mockChain(null);
    const res = await POST(request({
      machine_id: MACHINE, date: '2026-07-17', shift: 'A', shift_output_qty: -1,
    }));
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test -- --testPathPatterns="production-progress"`
Expected: FAIL — `Cannot find module '../route'`

- [ ] **Step 3: 최소 구현**

`src/app/api/production-progress/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ProgressBody {
  machine_id?: unknown;
  date?: unknown;
  shift?: unknown;
  shift_output_qty?: unknown;
}

/**
 * POST /api/production-progress — 교대 중 진행 보고 저장 (append-only).
 *
 * shift_output_qty 의 의미는 "이 교대에서 지금까지 만든 총 개수"다. 누적이므로 줄어들 수
 * 없고, 줄어든 값이 오면 오타이거나 예기치 못한 상황이다. 조용히 받으면 그 차이만큼
 * 생산량이 증발하므로 409 로 되묻는다.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const body = (await request.json()) as ProgressBody;

    const machineId = typeof body.machine_id === 'string' ? body.machine_id : '';
    const date = typeof body.date === 'string' ? body.date : '';
    const shift = body.shift === 'A' || body.shift === 'B' ? body.shift : null;
    const qty = typeof body.shift_output_qty === 'number' ? body.shift_output_qty : Number.NaN;

    if (!UUID.test(machineId)) {
      return NextResponse.json({ error: 'machine_id must be a UUID' }, { status: 400 });
    }
    if (!DATE.test(date)) {
      return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    }
    if (shift === null) {
      return NextResponse.json({ error: "shift must be 'A' or 'B'" }, { status: 400 });
    }
    if (!Number.isInteger(qty) || qty < 0) {
      return NextResponse.json({ error: 'shift_output_qty must be a non-negative integer' }, { status: 400 });
    }

    assertMachineAccess(user, machineId);

    const { data: last, error: lastError } = await supabaseAdmin
      .from('production_progress_reports')
      .select('shift_output_qty')
      .eq('machine_id', machineId)
      .eq('date', date)
      .eq('shift', shift)
      .order('reported_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lastError) {
      console.error('진행 보고 조회 오류:', lastError);
      return NextResponse.json({ error: 'Failed to read last report' }, { status: 500 });
    }

    if (last && qty < last.shift_output_qty) {
      return NextResponse.json(
        {
          error: 'shift_output_qty decreased',
          last_reported_qty: last.shift_output_qty,
          submitted_qty: qty,
        },
        { status: 409 }
      );
    }

    const { error: insertError } = await supabaseAdmin
      .from('production_progress_reports')
      .insert({
        machine_id: machineId,
        date,
        shift,
        shift_output_qty: qty,
        operator_id: user.userId,
      });

    if (insertError) {
      console.error('진행 보고 저장 오류:', insertError);
      return NextResponse.json({ error: 'Failed to save report' }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm test -- --testPathPatterns="production-progress"`
Expected: PASS — 6 tests

- [ ] **Step 5: 변이 테스트로 감소 감지가 진짜인지 확인**

`route.ts` 에서 감소 검사를 잠시 지운다:

```ts
    // if (last && qty < last.shift_output_qty) { ... }
```

Run: `npm test -- --testPathPatterns="production-progress"`
Expected: FAIL — "보고값이 줄어들면 거부하고 되묻는다" 만 실패, 나머지 5건 통과

확인 후 되돌린다. (이 프로젝트에서 통과하는데 버그를 못 잡는 가짜 테스트를 만든 전례가 있다.)

- [ ] **Step 6: 커밋**

```bash
git add src/app/api/production-progress/route.ts src/app/api/production-progress/__tests__/route.test.ts
git commit -m "feat(realtime): 진행 보고 저장 API + 감소 감지"
```

---

## Task 5: API — 현재 상태 조회 (GET)

**Files:**
- Modify: `src/app/api/production-progress/route.ts` (POST 아래에 GET 추가)
- Test: `src/app/api/production-progress/__tests__/getRoute.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/app/api/production-progress/__tests__/getRoute.test.ts`:

```ts
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
}));

const mockRequireUser = jest.fn();
const mockFrom = jest.fn();

jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: jest.fn(),
  apiAuthErrorResponse: () => null,
}));
jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a) },
}));

import { GET } from '../route';

const MACHINE = '11111111-1111-4111-8111-111111111111';

describe('GET /api/production-progress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });

    mockFrom.mockImplementation((table: string) => {
      if (table === 'production_progress_reports') {
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({
              order: () => ({ limit: () => ({ maybeSingle: async () => ({
                data: { shift_output_qty: 60, reported_at: '2026-07-17T09:30:00+07:00' }, error: null,
              }) }) }),
            }) }) }),
          }),
        };
      }
      if (table === 'downtime_entries') {
        return {
          select: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({
            data: [{ start_time: '2026-07-17T09:00:00+07:00', end_time: '2026-07-17T09:11:00+07:00', duration_minutes: 11 }],
            error: null,
          }) }) }) }),
        };
      }
      // tact 는 machines 테이블이 아니라 이 뷰에 있다 (machines 에는 tact 컬럼이 없다).
      if (table === 'machines_with_production_info') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({
            data: { current_tact_time: 72 }, error: null,
          }) }) }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    });
  });

  const call = (qs: string) => GET({ url: `http://localhost/api/production-progress?${qs}` } as never);

  it('마지막 보고·비가동 합계·tact 를 함께 돌려준다', async () => {
    const res = await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    expect(res.status).toBe(200);

    const body = await res.json() as {
      last_report: { shift_output_qty: number } | null;
      downtime_minutes: number;
      tact_time_seconds: number | null;
    };
    expect(body.last_report?.shift_output_qty).toBe(60);
    expect(body.downtime_minutes).toBe(11);
    // 클라이언트가 tact 의 출처(뷰)를 알 필요가 없도록 서버가 해결해 실어준다.
    expect(body.tact_time_seconds).toBe(72);
  });

  it('필수 파라미터가 없으면 400', async () => {
    const res = await call('date=2026-07-17&shift=A');
    expect(res.status).toBe(400);
  });

  // tact 를 모르면 성능률을 계산할 수 없다. 0 이나 임의값으로 채우지 않는다.
  it('tact 가 없으면 null 로 돌려준다', async () => {
    mockFrom.mockImplementation((table: string) => {
      if (table === 'production_progress_reports') {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({
          order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        }) }) }) }) };
      }
      if (table === 'downtime_entries') {
        return { select: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ data: [], error: null }) }) }) }) };
      }
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) };
    });

    const res = await call(`machine_id=${MACHINE}&date=2026-07-17&shift=A`);
    const body = await res.json() as { tact_time_seconds: number | null };
    expect(body.tact_time_seconds).toBeNull();
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test -- --testPathPatterns="getRoute"`
Expected: FAIL — `GET is not a function`

- [ ] **Step 3: 최소 구현** — `route.ts` 하단에 추가

```ts
interface DowntimeRow {
  start_time: string;
  end_time: string | null;
  duration_minutes: number | null;
}

/**
 * GET /api/production-progress?machine_id=&date=&shift=
 * 마지막 진행 보고 + 지금까지의 비가동 합계 + 개당 tact.
 *
 * 열린 비가동(end_time IS NULL)은 now() 까지로 센다 — 지금 이 순간에도 멈춰 있기 때문이다.
 *
 * tact 는 machines 테이블이 아니라 machines_with_production_info 뷰에 있다. 그 사실을
 * 서버가 흡수해 클라이언트는 출처를 몰라도 되게 한다 (기존 getMachineTactInfo 와 동일한 출처).
 */
export async function GET(request: NextRequest) {
  try {
    await requireUser(request, ['admin', 'engineer', 'operator']);
    const { searchParams } = new URL(request.url);

    const machineId = searchParams.get('machine_id') ?? '';
    const date = searchParams.get('date') ?? '';
    const shift = searchParams.get('shift');

    if (!UUID.test(machineId) || !DATE.test(date) || (shift !== 'A' && shift !== 'B')) {
      return NextResponse.json({ error: 'machine_id, date, shift are required' }, { status: 400 });
    }

    const { data: lastReport, error: reportError } = await supabaseAdmin
      .from('production_progress_reports')
      .select('shift_output_qty, reported_at')
      .eq('machine_id', machineId)
      .eq('date', date)
      .eq('shift', shift)
      .order('reported_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reportError) {
      console.error('진행 보고 조회 오류:', reportError);
      return NextResponse.json({ error: 'Failed to read progress' }, { status: 500 });
    }

    const { data: downtimes, error: downtimeError } = await supabaseAdmin
      .from('downtime_entries')
      .select('start_time, end_time, duration_minutes')
      .eq('machine_id', machineId)
      .eq('date', date)
      .eq('shift', shift);

    if (downtimeError) {
      console.error('비가동 조회 오류:', downtimeError);
      return NextResponse.json({ error: 'Failed to read downtime' }, { status: 500 });
    }

    const now = Date.now();
    const downtimeMinutes = ((downtimes ?? []) as DowntimeRow[]).reduce((total, row) => {
      if (row.end_time !== null) {
        return total + (row.duration_minutes ?? 0);
      }
      const openMinutes = (now - new Date(row.start_time).getTime()) / 60_000;
      return total + Math.max(0, openMinutes);
    }, 0);

    // tact 가 없으면 성능률을 계산할 수 없다. 0 이나 임의값으로 채우지 않고 null 로 알린다.
    const { data: tactRow } = await supabaseAdmin
      .from('machines_with_production_info')
      .select('current_tact_time')
      .eq('id', machineId)
      .maybeSingle();

    const tactTimeSeconds =
      tactRow?.current_tact_time && tactRow.current_tact_time > 0 ? tactRow.current_tact_time : null;

    return NextResponse.json({
      last_report: lastReport ?? null,
      downtime_minutes: Math.round(downtimeMinutes),
      tact_time_seconds: tactTimeSeconds,
    });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm test -- --testPathPatterns="production-progress|getRoute"`
Expected: PASS — 8 tests

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/production-progress/route.ts src/app/api/production-progress/__tests__/getRoute.test.ts
git commit -m "feat(realtime): 진행 상태 조회 API (마지막 보고 + 비가동 합계)"
```

---

## Task 6: 태블릿 입력 모달

**Files:**
- Create: `src/components/production/ProgressInputModal.tsx`
- Test: `src/components/production/__tests__/ProgressInputModal.test.tsx`
- Modify: `public/locales/ko/production.json`, `public/locales/vi/production.json`

- [ ] **Step 1: i18n 키 추가**

`public/locales/ko/production.json` 의 최상위 객체에 추가:

```json
  "progressInput": {
    "title": "생산 수량 입력",
    "label": "이 교대에서 지금까지 만든 총 개수",
    "hint": "카운터를 읽든 직접 세든, 교대 시작 이후 누적 개수를 넣으세요",
    "lastReported": "마지막 보고: {{qty}}개 ({{ago}})",
    "decreasedError": "이전 보고({{last}}개)보다 적습니다. 누적 개수가 줄어들 수는 없습니다. 확인해 주세요.",
    "downtimeLocked": "{{since}}부터 현재까지 비가동 중입니다. 정상 가동으로 전환 후 입력하세요.",
    "submit": "저장"
  }
```

`public/locales/vi/production.json` 에 같은 구조로:

```json
  "progressInput": {
    "title": "Nhập số lượng sản xuất",
    "label": "Tổng số đã sản xuất trong ca này",
    "hint": "Đọc bộ đếm hay tự đếm đều được — nhập tổng lũy kế từ đầu ca",
    "lastReported": "Báo cáo cuối: {{qty}} cái ({{ago}})",
    "decreasedError": "Nhỏ hơn báo cáo trước ({{last}} cái). Số lũy kế không thể giảm. Vui lòng kiểm tra.",
    "downtimeLocked": "Đang dừng máy từ {{since}} đến hiện tại. Hãy chuyển sang vận hành bình thường trước khi nhập.",
    "submit": "Lưu"
  }
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/components/production/__tests__/ProgressInputModal.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ProgressInputModal } from '../ProgressInputModal';

jest.mock('@/hooks/useTranslation', () => ({
  useProductionTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}(${JSON.stringify(vars)})` : key,
  }),
}));

const mockAuthFetch = jest.fn();
jest.mock('@/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => mockAuthFetch(...a) }));

const baseProps = {
  open: true,
  machineId: '11111111-1111-4111-8111-111111111111',
  machineName: 'CNC-001',
  date: '2026-07-17',
  shift: 'A' as const,
  lastReportedQty: 60,
  downtimeSince: null,
  onClose: jest.fn(),
  onSaved: jest.fn(),
};

describe('ProgressInputModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthFetch.mockResolvedValue({ ok: true, status: 201, json: async () => ({ success: true }) });
  });

  it('입력값을 저장한다', async () => {
    render(<ProgressInputModal {...baseProps} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '150' } });
    fireEvent.click(screen.getByText('progressInput.submit'));

    await waitFor(() => expect(mockAuthFetch).toHaveBeenCalled());
    const [, init] = mockAuthFetch.mock.calls[0];
    expect(JSON.parse((init as { body: string }).body)).toEqual(
      expect.objectContaining({ shift_output_qty: 150, shift: 'A' })
    );
  });

  // 비가동 중인 설비는 생산하지 않는다. 정상 전환 전까지 입력을 막는다.
  it('비가동 중이면 입력을 잠그고 경과를 알린다', () => {
    render(<ProgressInputModal {...baseProps} downtimeSince="2026-07-14T09:00:00+07:00" />);

    expect(screen.queryByRole('spinbutton')).toBeNull();
    expect(document.body.textContent).toContain('progressInput.downtimeLocked');
  });

  it('서버가 감소를 거부하면 그 사실을 보여준다', async () => {
    mockAuthFetch.mockResolvedValue({
      ok: false, status: 409,
      json: async () => ({ error: 'shift_output_qty decreased', last_reported_qty: 150 }),
    });

    render(<ProgressInputModal {...baseProps} lastReportedQty={150} />);
    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '60' } });
    fireEvent.click(screen.getByText('progressInput.submit'));

    await waitFor(() => expect(document.body.textContent).toContain('progressInput.decreasedError'));
    expect(baseProps.onSaved).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: 실행해서 실패 확인**

Run: `npm test -- --testPathPatterns="ProgressInputModal"`
Expected: FAIL — `Cannot find module '../ProgressInputModal'`

- [ ] **Step 4: 최소 구현**

`src/components/production/ProgressInputModal.tsx`:

```tsx
'use client';

import React, { useState } from 'react';
import { Modal, InputNumber, Alert, Typography, Space } from 'antd';
import { authFetch } from '@/lib/authFetch';
import { useProductionTranslation } from '@/hooks/useTranslation';

const { Text } = Typography;

interface ProgressInputModalProps {
  open: boolean;
  machineId: string;
  machineName: string;
  date: string;
  shift: 'A' | 'B';
  /** 마지막 보고값. 없으면 null. */
  lastReportedQty: number | null;
  /** 열린 비가동의 시작 시각(ISO). 비가동 중이 아니면 null. */
  downtimeSince: string | null;
  onClose: () => void;
  onSaved: () => void;
}

/**
 * 교대 중 진행 보고 입력.
 *
 * 입력값의 의미는 "이 교대에서 지금까지 만든 총 개수"다. 작업자가 그 숫자를 어떻게 얻는지는
 * 규정하지 않는다 — 카운터를 읽든, 뺄셈을 하든, 직접 세든 결과값만 받는다.
 *
 * 비가동 중이면 입력을 잠근다. 안 도는 설비에 생산량을 넣을 수는 없다.
 */
export const ProgressInputModal: React.FC<ProgressInputModalProps> = ({
  open, machineId, machineName, date, shift, lastReportedQty, downtimeSince, onClose, onSaved,
}) => {
  const { t } = useProductionTranslation();
  const [qty, setQty] = useState<number | null>(lastReportedQty);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const locked = downtimeSince !== null;

  const submit = async () => {
    if (qty === null) return;
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch('/api/production-progress', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ machine_id: machineId, date, shift, shift_output_qty: qty }),
      });

      if (res.status === 409) {
        const body = await res.json() as { last_reported_qty: number };
        setError(t('progressInput.decreasedError', { last: body.last_reported_qty }));
        return;
      }
      if (!res.ok) {
        setError(t('progressInput.decreasedError', { last: lastReportedQty ?? 0 }));
        return;
      }
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`${machineName} — ${t('progressInput.title')}`}
      onCancel={onClose}
      onOk={submit}
      okText={t('progressInput.submit')}
      okButtonProps={{ disabled: locked || qty === null, loading: saving }}
    >
      {locked ? (
        <Alert
          type="warning"
          showIcon
          message={t('progressInput.downtimeLocked', {
            since: new Date(downtimeSince).toLocaleString(),
          })}
        />
      ) : (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Text>{t('progressInput.label')}</Text>
          <InputNumber
            value={qty}
            onChange={setQty}
            min={0}
            step={1}
            style={{ width: '100%', fontSize: 24 }}
            size="large"
          />
          <Text type="secondary" style={{ fontSize: 12 }}>{t('progressInput.hint')}</Text>
          {error && <Alert type="error" showIcon message={error} />}
        </Space>
      )}
    </Modal>
  );
};
```

- [ ] **Step 5: 실행해서 통과 확인**

Run: `npm test -- --testPathPatterns="ProgressInputModal"`
Expected: PASS — 3 tests

- [ ] **Step 6: 커밋**

```bash
git add src/components/production/ProgressInputModal.tsx src/components/production/__tests__/ProgressInputModal.test.tsx public/locales/ko/production.json public/locales/vi/production.json
git commit -m "feat(realtime): 태블릿 진행 보고 입력 모달 (비가동 중 잠금)"
```

---

## Task 7: 조회 훅

**Files:**
- Create: `src/hooks/useRealtimeProgress.ts`
- Test: `src/hooks/__tests__/useRealtimeProgress.test.tsx`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/hooks/__tests__/useRealtimeProgress.test.tsx`:

```tsx
import { renderHook, waitFor } from '@testing-library/react';
import { useRealtimeProgress } from '../useRealtimeProgress';

const mockAuthFetch = jest.fn();
jest.mock('@/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => mockAuthFetch(...a) }));

describe('useRealtimeProgress', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockAuthFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        last_report: { shift_output_qty: 60, reported_at: '2026-07-17T09:30:00+07:00' },
        downtime_minutes: 0,
        tact_time_seconds: 72,
      }),
    });
  });

  it('마지막 보고·비가동·tact 를 가져온다', async () => {
    const { result } = renderHook(() =>
      useRealtimeProgress({ machineId: 'm1', date: '2026-07-17', shift: 'A' })
    );

    await waitFor(() => expect(result.current.lastReportedQty).toBe(60));
    expect(result.current.downtimeMinutes).toBe(0);
    expect(result.current.tactTimeSeconds).toBe(72);
    expect(result.current.error).toBeNull();
  });

  // 조회 실패를 0 으로 채우면 "비가동 없음"으로 읽힌다. 모르는 것은 null 로 둔다.
  it('조회에 실패하면 0 이 아니라 null 을 남긴다', async () => {
    mockAuthFetch.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const { result } = renderHook(() =>
      useRealtimeProgress({ machineId: 'm1', date: '2026-07-17', shift: 'A' })
    );

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.lastReportedQty).toBeNull();
    expect(result.current.downtimeMinutes).toBeNull();
    expect(result.current.tactTimeSeconds).toBeNull();
  });

  it('machineId 가 없으면 조회하지 않는다', () => {
    renderHook(() => useRealtimeProgress({ machineId: null, date: '2026-07-17', shift: 'A' }));
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test -- --testPathPatterns="useRealtimeProgress"`
Expected: FAIL — `Cannot find module '../useRealtimeProgress'`

- [ ] **Step 3: 최소 구현**

`src/hooks/useRealtimeProgress.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '@/lib/authFetch';

interface UseRealtimeProgressArgs {
  machineId: string | null;
  date: string;
  shift: 'A' | 'B';
}

interface UseRealtimeProgressResult {
  /** null = 아직 모름(조회 전/실패) 또는 보고 없음. 0 과 구분한다. */
  lastReportedQty: number | null;
  lastReportedAt: string | null;
  /** null = 조회 실패. "비가동 0분"과 구분해야 한다. */
  downtimeMinutes: number | null;
  /** 개당 가공시간(초). null 이면 성능률을 계산할 수 없다. 서버가 뷰에서 해결해 준다. */
  tactTimeSeconds: number | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
}

/**
 * 교대 중 진행 상태 조회.
 *
 * 실패를 0 으로 채우지 않는다. "비가동 0분"과 "비가동을 못 읽었다"는 다르고, 섞으면
 * 가동률이 100% 인 것처럼 보인다.
 */
export function useRealtimeProgress({ machineId, date, shift }: UseRealtimeProgressArgs): UseRealtimeProgressResult {
  const [lastReportedQty, setLastReportedQty] = useState<number | null>(null);
  const [lastReportedAt, setLastReportedAt] = useState<string | null>(null);
  const [downtimeMinutes, setDowntimeMinutes] = useState<number | null>(null);
  const [tactTimeSeconds, setTactTimeSeconds] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchProgress = useCallback(async () => {
    if (!machineId) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ machine_id: machineId, date, shift });
      const res = await authFetch(`/api/production-progress?${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const body = await res.json() as {
        last_report: { shift_output_qty: number; reported_at: string } | null;
        downtime_minutes: number;
        tact_time_seconds: number | null;
      };

      setLastReportedQty(body.last_report?.shift_output_qty ?? null);
      setLastReportedAt(body.last_report?.reported_at ?? null);
      setDowntimeMinutes(body.downtime_minutes);
      setTactTimeSeconds(body.tact_time_seconds);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
      setLastReportedQty(null);
      setLastReportedAt(null);
      setDowntimeMinutes(null);
      setTactTimeSeconds(null);
    } finally {
      setLoading(false);
    }
  }, [machineId, date, shift]);

  useEffect(() => { void fetchProgress(); }, [fetchProgress]);

  return {
    lastReportedQty, lastReportedAt, downtimeMinutes, tactTimeSeconds,
    loading, error, refresh: fetchProgress,
  };
}
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm test -- --testPathPatterns="useRealtimeProgress"`
Expected: PASS — 3 tests

- [ ] **Step 5: 커밋**

```bash
git add src/hooks/useRealtimeProgress.ts src/hooks/__tests__/useRealtimeProgress.test.tsx
git commit -m "feat(realtime): 진행 상태 조회 훅"
```

---

## Task 8: 태블릿 화면 연결

**Files:**
- Modify: `src/components/dashboard/OperatorDashboard.tsx`
- Test: `src/components/dashboard/__tests__/OperatorDashboard.realtimeProgress.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/components/dashboard/__tests__/OperatorDashboard.realtimeProgress.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const stripComments = (source: string): string => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('OperatorDashboard 실시간 진행 계약', () => {
  const source = stripComments(
    readFileSync(resolve(process.cwd(), 'src/components/dashboard/OperatorDashboard.tsx'), 'utf8')
  );

  it('진행 보고 입력 모달을 연결한다', () => {
    expect(source).toMatch(/ProgressInputModal/);
  });

  // 실시간 화면에 OEE 를 띄우면 안 된다. 품질은 검사 전이라 모른다.
  it('실시간 구간에서 OEE 를 계산하거나 표시하지 않는다', () => {
    expect(source).toMatch(/availabilityTimesPerformance/);
    expect(source).not.toMatch(/calculateRealtimeProgress[\s\S]{0,400}\boee\b/);
  });

  it('계산은 순수 함수에 위임한다 (컴포넌트에서 다시 만들지 않는다)', () => {
    expect(source).toMatch(/from '@\/utils\/realtimeProgress'/);
  });
});
```

- [ ] **Step 2: 실행해서 실패 확인**

Run: `npm test -- --testPathPatterns="OperatorDashboard.realtimeProgress"`
Expected: FAIL — `ProgressInputModal` 미발견

- [ ] **Step 3: 최소 구현**

`src/components/dashboard/OperatorDashboard.tsx` 상단 import 에 추가 (`getCurrentShiftInfo`·`ShiftTimeConfig`·`useSystemSettings` 는 24-26행에 **이미 import 돼 있으므로 건드리지 않는다**):

```tsx
import { ProgressInputModal } from '@/components/production/ProgressInputModal';
import { useRealtimeProgress } from '@/hooks/useRealtimeProgress';
import { calculateRealtimeProgress } from '@/utils/realtimeProgress';
```

`assignedMachines` 매핑(135-143행 부근)에 비가동 시작 시각을 추가한다. `currentLog`(열린 로그)는
**이미 130행에서 찾고 있으므로** 그 값을 쓰면 된다:

```tsx
          return {
            ...machine,
            current_state: machine.current_state as MachineState,
            oee: oeeMetrics?.[machine.id]?.oee ?? null,
            currentDuration,
            // 열린 로그가 정상가동이 아니면 그때부터 지금까지 비가동 중이다.
            // 도색처럼 며칠에 걸친 정지도 같은 방식으로 잡힌다 (machine_logs 는 여러 날을 다룬다).
            downtimeSince:
              currentLog && currentLog.state !== 'NORMAL_OPERATION' ? currentLog.start_time : null,
          };
```

`MachineRowData` 타입(237행)에도 추가:

```tsx
  type MachineRowData = { id: string; name: string; current_state: MachineState; currentDuration: number; oee: number | null; downtimeSince: string | null };
```

`selectedMachineMetrics` 선언 아래에 추가. **교대 정보는 227-228행의 `currentShiftInfo`·
`productionBusinessDate` 를 그대로 쓴다** (시간대·B조 자정 넘김이 이미 처리돼 있는 단일 소스):

```tsx
  // 교대 중 실시간 진행. OEE 는 만들지 않는다 — 불량은 다음날 검사하므로 품질을 모른다.
  const [progressModalOpen, setProgressModalOpen] = useState(false);

  const progress = useRealtimeProgress({
    machineId: selectedMachine,
    date: productionBusinessDate,
    shift: currentShiftInfo.shift,
  });

  const selectedMachineRow = processedData.assignedMachines.find(m => m.id === selectedMachine);

  const realtime = React.useMemo(() => {
    // 비가동이나 tact 를 모르면 계산하지 않는다. 0 으로 채우면 가동률 100% 로 보인다.
    if (progress.downtimeMinutes === null || progress.tactTimeSeconds === null) return null;

    return calculateRealtimeProgress({
      shift: currentShiftInfo.shift,
      shiftStart: currentShiftInfo.startTime,
      now,
      operatingMinutes: 720,
      tactTimeSeconds: progress.tactTimeSeconds,
      downtimeMinutes: progress.downtimeMinutes,
      shiftOutputQty: progress.lastReportedQty,
    });
  }, [
    progress.downtimeMinutes, progress.tactTimeSeconds, progress.lastReportedQty,
    currentShiftInfo.shift, currentShiftInfo.startTime, now,
  ]);
```

`return (` 직후, 최상위 `<div>` 안에 모달을 추가:

```tsx
      {selectedMachine && selectedMachineRow && (
        <ProgressInputModal
          open={progressModalOpen}
          machineId={selectedMachine}
          machineName={selectedMachineRow.name}
          date={productionBusinessDate}
          shift={currentShiftInfo.shift}
          lastReportedQty={progress.lastReportedQty}
          downtimeSince={selectedMachineRow.downtimeSince}
          onClose={() => setProgressModalOpen(false)}
          onSaved={progress.refresh}
        />
      )}
```

OEE 탭의 게이지 아래(`selectedMachineMetrics ? (...)` 블록 안, `<OEEGauge ... />` 다음)에 실시간 카드를 추가:

```tsx
                        {realtime && (
                          <Card size="small" style={{ marginTop: 16 }}>
                            <Space direction="vertical" style={{ width: '100%' }}>
                              <div>
                                {machinesT('operator.realtimeAvailabilityTimesPerformance')}:{' '}
                                <strong>
                                  {realtime.availabilityTimesPerformance === null
                                    ? '—'
                                    : `${(realtime.availabilityTimesPerformance * 100).toFixed(1)}%`}
                                </strong>
                              </div>
                              <div>
                                {machinesT('operator.shiftProgress')}:{' '}
                                <strong>
                                  {realtime.progressQty ?? '—'} / {realtime.capaQty ?? '—'}
                                </strong>
                              </div>
                              <Button type="primary" block onClick={() => setProgressModalOpen(true)}>
                                {machinesT('operator.inputProduction')}
                              </Button>
                            </Space>
                          </Card>
                        )}
```

`public/locales/ko/machines.json` 의 `operator` 객체에 추가:

```json
    "realtimeAvailabilityTimesPerformance": "실시간 가동×성능",
    "shiftProgress": "교대 진척"
```

`public/locales/vi/machines.json` 의 `operator` 객체에 추가:

```json
    "realtimeAvailabilityTimesPerformance": "Vận hành×Hiệu suất thời gian thực",
    "shiftProgress": "Tiến độ ca"
```

- [ ] **Step 4: 실행해서 통과 확인**

Run: `npm test -- --testPathPatterns="OperatorDashboard"`
Expected: PASS

- [ ] **Step 5: 전체 검증**

```bash
npx tsc --noEmit --incremental false
npm test -- --runInBand
npm run lint
```
Expected: tsc 무출력, 전체 테스트 통과, lint 0 errors

- [ ] **Step 6: 커밋**

```bash
git add src/components/dashboard/OperatorDashboard.tsx src/components/dashboard/__tests__/OperatorDashboard.realtimeProgress.test.ts public/locales/ko/machines.json public/locales/vi/machines.json
git commit -m "feat(realtime): 태블릿에 실시간 가동×성능·진척 표시"
```

---

## Task 9: 브라우저 검증

**Files:** 없음 (검증만)

- [ ] **Step 1: dev 서버에서 확인**

`/operator-view` (관리자 접근 경로, PR #18 에서 추가) 또는 운영자 계정으로 `/dashboard`.

확인 항목:
1. 설비 선택 → OEE 탭 → 실시간 카드가 보인다
2. 생산량 입력 → 저장 → 값이 반영된다
3. 같은 설비에 더 작은 값 입력 → **거부되고 이전 값을 알려준다**
4. 비가동 중인 설비 → 입력란이 잠기고 "현재까지 비가동 중입니다"
5. **실시간 카드에 OEE 가 없다** (가동×성능만)

- [ ] **Step 2: 값 검증**

DB 에서 방금 넣은 보고를 확인:

```sql
SELECT machine_id, date, shift, shift_output_qty, reported_at
FROM production_progress_reports ORDER BY reported_at DESC LIMIT 5;
```

- [ ] **Step 3: production_records 가 안 변했는지 확인**

```sql
SELECT count(*) FROM production_records WHERE date = CURRENT_DATE;
```
Expected: 이 기능을 쓰기 전과 동일 (진행 보고는 production_records 를 건드리지 않는다)

---

## Self-Review

**1. Spec coverage**

| 스펙 요구사항 | 담당 Task |
|---|---|
| §5.1 신규 테이블 (append-only) | Task 3 |
| §5.2 `production_records` 불변 | Task 3 (테스트), Task 9 (검증) |
| §6.1 경과 시간 기준 가동×성능 | Task 2 |
| §6.3 휴식 시간대 + 총량 일치 | Task 1 |
| 진척 (CAPA 대비) | Task 2 |
| OEE·품질 미계산 | Task 2, Task 8 (테스트) |
| §7 보고값 감소 거부 | Task 4 (+ 변이 테스트) |
| §7 비가동 중 입력 잠금 | Task 6 |
| §7 열린 비가동을 now 까지 | Task 5 |
| §8.1 태블릿 입력·표시 | Task 6, 8 |
| §9 권한 (담당 설비만) | Task 3 (RLS), Task 4 (`assertMachineAccess`) |
| §9 B교대 자정 넘김 | Task 1 (자정 넘는 휴식 2건) |

**B 계획으로 미룬 것** (스펙 §10 의 B): 미완료 3종 분류, 관리자 요약, 다음날 자동 채움.

**2. Placeholder scan** — TBD/TODO 없음. 모든 코드 단계에 실제 코드가 있다.

**3. Type consistency**

- `shift_output_qty` — 마이그레이션·API·모달·훅 전부 동일
- `calculateRealtimeProgress` 반환 필드 — Task 2 정의, Task 8 사용 (`availabilityTimesPerformance`, `progressQty`, `capaQty`)
- `elapsedBreakMinutes(shift, shiftStart, now)` — Task 1 정의, Task 2 사용
- `tact_time_seconds` — Task 5(API) → `tactTimeSeconds` Task 7(훅) → Task 8(사용)

**4. 코드베이스 대조 (초안의 오류 3건을 여기서 잡았다)**

초안은 존재하지 않는 것을 3개 참조했다. 이 프로젝트에는 유령 컬럼(`machines.default_tact_time`
등)을 읽는 버그가 프로덕션까지 간 전례가 있어(`next.config.js` 주석) 전부 실물 대조했다:

| 초안 (틀림) | 실제 | 반영 |
|---|---|---|
| `getCurrentShiftInfo()` 무인자, `{date, shift, startTime}` 반환 | `getCurrentShiftInfo(now, config)` → `{shift, startTime, endTime, isActive, businessDate}` | Task 8 이 **이미 있는** `currentShiftInfo`(227행)·`productionBusinessDate`(228행)를 재사용 |
| `machines.current_tact_time` | `machines` 에 tact 컬럼 **없음**. 뷰 `machines_with_production_info` 에 있음 | Task 5(API)가 서버에서 해결해 응답에 실음 |
| `assignedMachines[].downtimeSince` 없음 | 열린 로그는 **이미** 130행 `currentLog` 로 찾고 있음 | Task 8 에서 그 값으로 파생 |

확인된 것:
- `ShiftInfo { shift, startTime, endTime, isActive, businessDate }` — `src/utils/shiftUtils.ts:10`
- `OperatorDashboard` 가 `getCurrentShiftInfo`·`ShiftTimeConfig`·`useSystemSettings` 를 **이미 import** — 24-26행
- `shiftConfig`/`now`/`currentShiftInfo`/`productionBusinessDate` **이미 존재** — 212-228행
- `machines_with_production_info.current_tact_time` — `[recordId]/route.ts:60-73` 의 `getMachineTactInfo` 와 동일한 출처

---

## 실행 방식

계획이 `docs/superpowers/plans/2026-07-17-realtime-monitoring-a.md` 에 저장됐다. 두 가지 실행 방식이 있다:

1. **Subagent-Driven (권장)** — Task 마다 새 서브에이전트를 띄우고 Task 사이에 리뷰. 빠른 반복.
2. **Inline Execution** — 이 세션에서 executing-plans 로 직접 실행. 체크포인트마다 검토.
