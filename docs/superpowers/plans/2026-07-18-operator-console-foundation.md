# 통합 입력 콘솔 — Plan 1: 데이터/API 기반 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 운영자 콘솔(Plan 2)이 올라탈 백엔드를 만든다 — `defect_qty` NULL(미검사) 지원, "품질 NULL=보류" OEE 규율, 교대 마감(진척→output, 늦은 귀속), 불량 입력(파생 확정), 마감/불량 백로그 조회.

**Architecture:** 기존 확정 실적 계산(`oeeRules.ts` · `daily/route.ts` · `plannedRuntime.ts` · `shiftDowntime.ts`)을 재사용한다. 교대 메트릭 계산을 `src/lib/shiftMetrics.ts`로 추출해 `daily` 라우트와 신규 `close-shift` 라우트가 공유(DRY). 불량은 스냅샷에서 파생 재계산. 모든 변경은 additive — 기존 행·경로·실시간 기능은 안 깨진다.

**Tech Stack:** Next.js 16 App Router(route handlers), Supabase(Postgres, service_role), Jest, TypeScript strict. 마이그레이션은 MCP `apply_migration`(사용자 명시 지시 시에만; 파일·테스트는 지금).

**설계 근거:** `docs/superpowers/specs/2026-07-18-operator-console-unified-input-design.md`

---

## File Structure

- Create `supabase/migrations/20260718000002_production_records_defect_nullable.sql` — `defect_qty` NULL 허용(additive).
- Create `src/app/__tests__/defectNullableMigration.test.ts` — 마이그레이션 텍스트 계약.
- Modify `src/app/api/production-records/oeeRules.ts` — `calculateOeeMetrics`가 `defectQty: number | null`을 받아 quality/oee를 `number | null`로.
- Create `src/app/api/production-records/__tests__/oeeRulesNullDefect.test.ts` — null-defect 계산 규율.
- Create `src/lib/shiftMetrics.ts` — 한 교대의 확정 스냅샷(planned/actual/ideal/availability/performance/quality/oee) 계산. `daily`·`close-shift` 공유.
- Create `src/lib/__tests__/shiftMetrics.test.ts`.
- Modify `src/app/api/production-records/daily/route.ts` — `calculateShiftMetrics`를 `shiftMetrics.ts`로 위임(동작 불변 리팩터), defect null 전파.
- Create `src/app/api/production-records/close-shift/route.ts` — `POST` 교대 마감(진척→output, defect NULL).
- Create `src/app/api/production-records/close-shift/__tests__/route.test.ts`.
- Create `src/app/api/production-records/[recordId]/defect/route.ts` — `PATCH` 불량 입력(파생 확정).
- Create `src/app/api/production-records/[recordId]/defect/__tests__/route.test.ts`.
- Create `src/app/api/production-records/pending/route.ts` — `GET` 마감대기/불량대기 백로그.
- Create `src/app/api/production-records/pending/__tests__/route.test.ts`.

각 태스크는 독립적으로 테스트 가능하며 순서대로 커밋한다.

---

## Task 1: `defect_qty` NULL 허용 마이그레이션

**Files:**
- Create: `supabase/migrations/20260718000002_production_records_defect_nullable.sql`
- Test: `src/app/__tests__/defectNullableMigration.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — 마이그레이션 파일의 텍스트 계약을 고정한다.

```typescript
// src/app/__tests__/defectNullableMigration.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const sql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260718000002_production_records_defect_nullable.sql'),
  'utf8',
);

describe('production_records.defect_qty NULL 허용 마이그레이션', () => {
  it('defect_qty 의 NOT NULL 을 제거한다', () => {
    expect(sql).toMatch(/alter table\s+public\.production_records\s+alter column\s+defect_qty\s+drop not null/i);
  });
  it('output_qty 등 다른 컬럼은 건드리지 않는다 (defect_qty 만)', () => {
    expect(sql).not.toMatch(/output_qty/i);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/app/__tests__/defectNullableMigration.test.ts`
Expected: FAIL — 파일 없음(ENOENT).

- [ ] **Step 3: 마이그레이션 작성**

```sql
-- production_records.defect_qty 를 NULL 허용으로. NULL = "미검사"(불량 결과가 다음날 검사에서
-- 나옴). 0 과 구분해야 한다(NULL≠0%): 미검사는 품질/OEE 를 계산할 수 없다. 스냅샷 필드
-- (quality/oee/performance)는 이미 nullable. 기존 행(모두 값 있음)·경로는 영향 없음(additive).
alter table public.production_records
  alter column defect_qty drop not null;
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest src/app/__tests__/defectNullableMigration.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: 커밋** (적용은 규칙상 사용자 명시 지시 시에만 — 파일·테스트만 커밋)

```bash
git add supabase/migrations/20260718000002_production_records_defect_nullable.sql src/app/__tests__/defectNullableMigration.test.ts
git commit -m "feat(records): defect_qty NULL 허용 마이그레이션(미검사) + 계약 테스트"
```

---

## Task 2: OEE 계산 — defect NULL 이면 quality/oee NULL

**Files:**
- Modify: `src/app/api/production-records/oeeRules.ts:31-55`
- Test: `src/app/api/production-records/__tests__/oeeRulesNullDefect.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/app/api/production-records/__tests__/oeeRulesNullDefect.test.ts
import { calculateOeeMetrics } from '../oeeRules';

describe('calculateOeeMetrics — defect NULL(미검사)', () => {
  const base = { plannedRuntime: 600, actualRuntime: 540, outputQty: 100, minutesPerUnit: 5 };

  it('defect 가 숫자면 quality·oee 를 계산한다 (기존 동작 유지)', () => {
    const m = calculateOeeMetrics({ ...base, defectQty: 10 });
    expect(m.quality).toBeCloseTo(0.9, 5);
    expect(m.oee).not.toBeNull();
  });

  it('defect 가 NULL 이면 quality·oee 는 NULL, availability·performance 는 유지', () => {
    const m = calculateOeeMetrics({ ...base, defectQty: null });
    expect(m.quality).toBeNull();
    expect(m.oee).toBeNull();
    // 가동×성능은 검사와 무관하므로 여전히 계산된다.
    expect(m.availability).toBeGreaterThan(0);
    expect(m.performance).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/app/api/production-records/__tests__/oeeRulesNullDefect.test.ts`
Expected: FAIL — `defectQty: null` 이 타입 에러이거나 quality 가 NaN/0.

- [ ] **Step 3: 구현** — `calculateOeeMetrics` 시그니처와 quality/oee 를 nullable 로.

`src/app/api/production-records/oeeRules.ts` 의 함수를 아래로 교체:

```typescript
export function calculateOeeMetrics(params: {
  plannedRuntime: number;
  actualRuntime: number;
  outputQty: number;
  defectQty: number | null;   // null = 미검사(품질 모름)
  minutesPerUnit: number;
}) {
  const plannedRuntime = Math.max(0, params.plannedRuntime);
  const actualRuntime = Math.min(Math.max(params.actualRuntime, 0), plannedRuntime);
  const idealRuntime = Math.max(0, params.outputQty * params.minutesPerUnit);
  const availability = plannedRuntime > 0 ? actualRuntime / plannedRuntime : 0;
  const performance = actualRuntime > 0 ? Math.min(Math.max(idealRuntime / actualRuntime, 0), 1) : 0;
  // 불량 미검사(null)면 품질을 만들지 않는다. 0 으로 채우면 멀쩡한 교대가 OEE 0% 로 보인다
  // (NULL≠0%). availability·performance 는 검사와 무관하므로 그대로 둔다.
  const quality = params.defectQty === null
    ? null
    : (params.outputQty > 0
        ? Math.min(Math.max((params.outputQty - params.defectQty) / params.outputQty, 0), 1)
        : 0);
  const oee = quality === null ? null : availability * performance * quality;
  return { plannedRuntime, actualRuntime, idealRuntime, availability, performance, quality, oee };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest src/app/api/production-records/__tests__/oeeRulesNullDefect.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: 호출부 타입 확인** — `calculateOeeMetrics` 호출부가 새 시그니처와 맞는지.

Run: `npx tsc --noEmit --incremental false 2>&1 | head -20`
Expected: 무출력(클린). 에러가 나면 해당 호출부(daily/route.ts, [recordId]/route.ts)에서 `defectQty` 를 `number | null` 로 넘기도록 좁힌다(값이 있으면 그대로, 없으면 null).

- [ ] **Step 6: 전체 스위트 회귀 확인**

Run: `npx jest --runInBand 2>&1 | grep -E "^Tests:|FAIL"`
Expected: 기존 전부 PASS + 신규 2.

- [ ] **Step 7: 커밋**

```bash
git add src/app/api/production-records/oeeRules.ts src/app/api/production-records/__tests__/oeeRulesNullDefect.test.ts
git commit -m "feat(oee): defect NULL(미검사) → quality·oee NULL, avail·perf 유지"
```

---

## Task 3: 교대 메트릭 계산 추출 (`shiftMetrics.ts`) — DRY 리팩터

**목적:** `daily/route.ts` 의 `calculateShiftMetrics`(planned/actual/downtime→OEE 스냅샷)를 공유 모듈로 빼서 `close-shift`(Task 4)가 재사용하게 한다. 동작은 불변.

**Files:**
- Create: `src/lib/shiftMetrics.ts`
- Test: `src/lib/__tests__/shiftMetrics.test.ts`
- Modify: `src/app/api/production-records/daily/route.ts` (calculateShiftMetrics 를 위임)

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/lib/__tests__/shiftMetrics.test.ts
import { computeShiftSnapshot } from '../shiftMetrics';

describe('computeShiftSnapshot', () => {
  it('downtime 이 null 이면 런타임 계열을 null 로 남긴다 (미보고 ≠ 완전가동)', () => {
    const s = computeShiftSnapshot({
      operatingMinutes: 720, breakMinutes: 110, downtimeMinutes: null,
      outputQty: 100, defectQty: null, tactSeconds: 300,
    });
    expect(s.actualRuntime).toBeNull();
    expect(s.availability).toBeNull();
    expect(s.oee).toBeNull();
  });

  it('downtime 이 값이고 defect 가 null 이면 avail·perf 는 계산, quality·oee 는 null', () => {
    const s = computeShiftSnapshot({
      operatingMinutes: 720, breakMinutes: 110, downtimeMinutes: 60,
      outputQty: 100, defectQty: null, tactSeconds: 300,
    });
    // planned = 720-110 = 610, actual = 610-60 = 550
    expect(s.plannedRuntime).toBe(610);
    expect(s.actualRuntime).toBe(550);
    expect(s.availability).toBeGreaterThan(0);
    expect(s.performance).toBeGreaterThan(0);
    expect(s.quality).toBeNull();
    expect(s.oee).toBeNull();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/lib/__tests__/shiftMetrics.test.ts`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: 구현** — `daily/route.ts` 의 `calculateShiftMetrics`(현재 구조: planned=resolvePlannedRuntime, downtime null→런타임 null, 아니면 actual=planned-downtime, tact 개당)를 그대로 옮기되 `defectQty: number | null` 을 받는다.

```typescript
// src/lib/shiftMetrics.ts
import { resolvePlannedRuntime } from '@/lib/plannedRuntime';
import { calculateOeeMetrics } from '@/app/api/production-records/oeeRules';

export interface ShiftSnapshotInput {
  operatingMinutes: number;
  breakMinutes: number;
  /** null = 비가동 조회 실패/보류. 이때 런타임 계열을 null 로 남긴다(미보고≠완전가동). */
  downtimeMinutes: number | null;
  outputQty: number;
  /** null = 미검사(품질 모름). */
  defectQty: number | null;
  /** 개당 가공시간(초). cavity 로 나누지 않는다(oeeRules.ts 참고). */
  tactSeconds: number;
}

export interface ShiftSnapshot {
  plannedRuntime: number;
  actualRuntime: number | null;
  idealRuntime: number;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  oee: number | null;
  downtime: number | null;
}

export function computeShiftSnapshot(input: ShiftSnapshotInput): ShiftSnapshot {
  const plannedRuntime = resolvePlannedRuntime(input.operatingMinutes, input.breakMinutes);
  const minutesPerUnit = input.tactSeconds / 60;

  if (input.downtimeMinutes === null) {
    // 비가동을 못 읽었다 → 완전가동으로 추정하지 않는다. 런타임 계열 null.
    const base = calculateOeeMetrics({
      plannedRuntime, actualRuntime: 0, outputQty: input.outputQty,
      defectQty: input.defectQty, minutesPerUnit,
    });
    return {
      plannedRuntime, actualRuntime: null, idealRuntime: base.idealRuntime,
      availability: null, performance: null, quality: base.quality, oee: null, downtime: null,
    };
  }

  const downtime = Math.min(Math.max(input.downtimeMinutes, 0), plannedRuntime);
  const actualRuntime = Math.max(0, plannedRuntime - downtime);
  const m = calculateOeeMetrics({
    plannedRuntime, actualRuntime, outputQty: input.outputQty,
    defectQty: input.defectQty, minutesPerUnit,
  });
  return { ...m, downtime };
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest src/lib/__tests__/shiftMetrics.test.ts`
Expected: PASS — 2 tests.

- [ ] **Step 5: `daily/route.ts` 를 위임으로 리팩터** — 기존 `calculateShiftMetrics` 내부를 `computeShiftSnapshot` 호출로 교체(동작 불변). `defectQty` 는 그대로 number 를 전달(관리자 백필은 값 있음). import 추가:

```typescript
import { computeShiftSnapshot } from '@/lib/shiftMetrics';
```

`calculateShiftMetrics` 본문을 `computeShiftSnapshot({ operatingMinutes, breakMinutes, downtimeMinutes, outputQty, defectQty, tactSeconds })` 반환으로 바꾼다(반환 shape 이 기존과 같은 필드명을 갖는지 확인하고, 다르면 호출부 매핑을 맞춘다).

- [ ] **Step 6: daily 라우트 회귀 확인**

Run: `npx jest src/app/api/production-records/daily --runInBand 2>&1 | grep -E "^Tests:|FAIL"`
Expected: 기존 daily 테스트 전부 PASS(동작 불변).

- [ ] **Step 7: 커밋**

```bash
git add src/lib/shiftMetrics.ts src/lib/__tests__/shiftMetrics.test.ts src/app/api/production-records/daily/route.ts
git commit -m "refactor(records): 교대 스냅샷 계산을 shiftMetrics 로 추출(동작 불변) + defect null 지원"
```

---

## Task 4: 교대 마감 엔드포인트 (`POST /api/production-records/close-shift`)

**동작:** (machine_id, date, shift[, final_qty]) 을 받아 — final_qty 미지정이면 그 교대의 마지막 진척 보고값을 output 으로, 지정이면 그 값을 output 으로. 비가동은 확정 계약(shiftDowntime)으로 계산. defect=NULL(미검사)로 `production_records` upsert. 늦은 입력 가능(귀속=인자의 date/shift, 입력 시각 무관).

**Files:**
- Create: `src/app/api/production-records/close-shift/route.ts`
- Test: `src/app/api/production-records/close-shift/__tests__/route.test.ts`

- [ ] **Step 1: 실패 테스트 작성** — mock: requireUser/assertMachineAccess, getShiftWindow/loadDowntimeSourceRows, getBreakTimeMinutes, supabaseAdmin(progress 조회·machines tact·records upsert).

```typescript
// src/app/api/production-records/close-shift/__tests__/route.test.ts
jest.mock('next/server', () => ({
  NextResponse: { json: (b: unknown, i?: { status?: number }) => ({ status: i?.status ?? 200, json: async () => b }) },
}));
const mockRequireUser = jest.fn();
const mockAssert = jest.fn();
const mockFrom = jest.fn();
const mockGetShiftWindow = jest.fn();
const mockLoadRows = jest.fn();
const mockBreak = jest.fn();
jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: (...a: unknown[]) => mockAssert(...a),
  apiAuthErrorResponse: () => null,
}));
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a) } }));
jest.mock('@/lib/shiftDowntime', () => ({
  getShiftWindow: (...a: unknown[]) => mockGetShiftWindow(...a),
  loadDowntimeSourceRows: (...a: unknown[]) => mockLoadRows(...a),
}));
jest.mock('@/lib/plannedRuntime', () => ({
  getBreakTimeMinutes: () => mockBreak(),
  resolvePlannedRuntime: (op: number, br: number) => Math.max(0, op - br),
}));

import { POST } from '../route';
const MACHINE = '11111111-1111-4111-8111-111111111111';
const WINDOW = { start: new Date('2026-07-17T08:00:00+07:00').getTime(), end: new Date('2026-07-17T20:00:00+07:00').getTime() };
const req = (b: unknown) => ({ url: 'http://x/api/production-records/close-shift', json: async () => b }) as never;

const wireDb = ({ lastQty = 112, tact = 300, upsert = jest.fn().mockResolvedValue({ data: [{ record_id: 'r1' }], error: null }) } = {}) => {
  mockFrom.mockImplementation((t: string) => {
    if (t === 'production_progress_reports') return { select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: async () => ({ data: lastQty === null ? null : { shift_output_qty: lastQty }, error: null }) }) }) }) }) }) }) };
    if (t === 'machines_with_production_info') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { current_tact_time: tact }, error: null }) }) }) };
    if (t === 'production_records') return { upsert };
    throw new Error(`unexpected ${t}`);
  });
  return { upsert };
};

describe('POST /api/production-records/close-shift', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssert.mockReturnValue(undefined);
    mockGetShiftWindow.mockResolvedValue(WINDOW);
    mockLoadRows.mockResolvedValue([]);      // 비가동 0
    mockBreak.mockResolvedValue(110);
  });

  it('진척 마지막값을 output 으로, defect NULL 로 마감한다', async () => {
    const { upsert } = wireDb({ lastQty: 112 });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));
    expect(res.status).toBe(201);
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ machine_id: MACHINE, date: '2026-07-17', shift: 'A', output_qty: 112, defect_qty: null }),
      expect.anything(),
    );
  });

  it('final_qty 를 주면 그 값으로 마감한다 (종이 전사)', async () => {
    const { upsert } = wireDb({ lastQty: 112 });
    await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A', final_qty: 130 }));
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ output_qty: 130, defect_qty: null }), expect.anything());
  });

  it('진척도 없고 final_qty 도 없으면 400 (마감할 수량 없음)', async () => {
    wireDb({ lastQty: null });
    const res = await POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }));
    expect(res.status).toBe(400);
  });

  it('담당이 아닌 설비는 거부', async () => {
    wireDb();
    mockAssert.mockImplementation(() => { throw new Error('forbidden'); });
    await expect(POST(req({ machine_id: MACHINE, date: '2026-07-17', shift: 'A' }))).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/app/api/production-records/close-shift`
Expected: FAIL — 라우트 없음.

- [ ] **Step 3: 구현**

```typescript
// src/app/api/production-records/close-shift/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';
import { getBreakTimeMinutes } from '@/lib/plannedRuntime';
import { getShiftWindow, loadDowntimeSourceRows } from '@/lib/shiftDowntime';
import { calculateVerifiedDowntimeMinutesForWindow } from '@/app/api/production-records/daily/downtimeCalculation';
import { computeShiftSnapshot } from '@/lib/shiftMetrics';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/production-records/close-shift — 교대 마감.
 * output = final_qty(있으면) 또는 그 교대 마지막 진척값. defect = NULL(미검사, 다음날 입력).
 * 늦게 불러도 귀속은 인자의 date/shift (입력 시각 무관). avail×perf 는 지금 확정, 품질/OEE 는 보류.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const body = await request.json() as { machine_id?: unknown; date?: unknown; shift?: unknown; final_qty?: unknown };
    const machineId = typeof body.machine_id === 'string' ? body.machine_id : '';
    const date = typeof body.date === 'string' ? body.date : '';
    const shift = body.shift === 'A' || body.shift === 'B' ? body.shift : null;
    const finalQty = typeof body.final_qty === 'number' ? body.final_qty : null;

    if (!UUID.test(machineId)) return NextResponse.json({ error: 'machine_id must be a UUID' }, { status: 400 });
    if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 });
    if (shift === null) return NextResponse.json({ error: "shift must be 'A' or 'B'" }, { status: 400 });
    if (finalQty !== null && (!Number.isInteger(finalQty) || finalQty < 0))
      return NextResponse.json({ error: 'final_qty must be a non-negative integer' }, { status: 400 });

    assertMachineAccess(user, machineId);

    // output 결정: final_qty 우선, 없으면 마지막 진척값.
    let outputQty = finalQty;
    if (outputQty === null) {
      const { data: last } = await supabaseAdmin
        .from('production_progress_reports')
        .select('shift_output_qty')
        .eq('machine_id', machineId).eq('date', date).eq('shift', shift)
        .order('reported_at', { ascending: false }).limit(1).maybeSingle();
      outputQty = last?.shift_output_qty ?? null;
    }
    if (outputQty === null) return NextResponse.json({ error: 'no quantity to close (진척·final_qty 없음)' }, { status: 400 });

    // 비가동 = 확정 OEE 와 동일 계약. tact = 뷰.
    const window = await getShiftWindow(date, shift);
    if (!window) return NextResponse.json({ error: 'Shift time configuration is invalid' }, { status: 500 });
    const rows = await loadDowntimeSourceRows(machineId, new Date(window.start).toISOString(), new Date(window.end).toISOString());
    const breakMinutes = await getBreakTimeMinutes();
    const downtimeMinutes = calculateVerifiedDowntimeMinutesForWindow(rows, window, breakMinutes, Date.now());
    const operatingMinutes = Math.round((window.end - window.start) / 60_000);

    const { data: tactRow } = await supabaseAdmin
      .from('machines_with_production_info').select('current_tact_time').eq('id', machineId).maybeSingle();
    const tactSeconds = tactRow?.current_tact_time && tactRow.current_tact_time > 0 ? tactRow.current_tact_time : 120;

    const snap = computeShiftSnapshot({
      operatingMinutes, breakMinutes, downtimeMinutes, outputQty, defectQty: null, tactSeconds,
    });

    const { error: upsertError } = await supabaseAdmin
      .from('production_records')
      .upsert({
        machine_id: machineId, date, shift,
        output_qty: outputQty, defect_qty: null,           // 미검사
        planned_runtime: snap.plannedRuntime, actual_runtime: snap.actualRuntime,
        ideal_runtime: snap.idealRuntime, availability: snap.availability,
        performance: snap.performance, quality: snap.quality, oee: snap.oee,
        tact_time_seconds: tactSeconds,
      }, { onConflict: 'machine_id,date,shift' });

    if (upsertError) {
      console.error('교대 마감 저장 오류:', upsertError);
      return NextResponse.json({ error: 'Failed to close shift' }, { status: 500 });
    }
    return NextResponse.json({ success: true }, { status: 201 });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
```

> **주의:** `production_records` 의 `onConflict` 유니크 제약이 `(machine_id, date, shift)` 인지 실제 스키마로 확인한다. 없으면 upsert 대신 select→insert/update 로 바꾸거나, 유니크 제약 추가를 별도 마이그레이션으로(이 라우트 구현 전에) 잡는다. daily 라우트의 기존 저장 방식과 동일한 키를 따른다.

- [ ] **Step 4: 통과 확인**

Run: `npx jest src/app/api/production-records/close-shift`
Expected: PASS — 4 tests.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/production-records/close-shift/
git commit -m "feat(records): 교대 마감 엔드포인트(진척→output, defect NULL, 늦은 귀속)"
```

---

## Task 5: 불량 입력 엔드포인트 (`PATCH /api/production-records/[recordId]/defect`)

**동작:** 확정대기(defect NULL) record 에 불량을 넣어 확정한다. avail·perf 스냅샷은 그대로, quality/oee 만 파생 재계산.

**Files:**
- Create: `src/app/api/production-records/[recordId]/defect/route.ts`
- Test: `src/app/api/production-records/[recordId]/defect/__tests__/route.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/app/api/production-records/[recordId]/defect/__tests__/route.test.ts
jest.mock('next/server', () => ({
  NextResponse: { json: (b: unknown, i?: { status?: number }) => ({ status: i?.status ?? 200, json: async () => b }) },
}));
const mockRequireUser = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: () => undefined,
  apiAuthErrorResponse: () => null,
}));
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a) } }));
import { PATCH } from '../route';

const REC = 'rec-1';
const wire = ({ record = { record_id: REC, machine_id: 'm1', output_qty: 100, defect_qty: null, availability: 0.9, performance: 0.8 }, update = jest.fn().mockResolvedValue({ error: null }) } = {}) => {
  mockFrom.mockImplementation((t: string) => {
    if (t === 'production_records') return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: record, error: null }) }) }),
      update: (patch: unknown) => ({ eq: async () => { update(patch); return { error: null }; } }),
    };
    throw new Error(`unexpected ${t}`);
  });
  return { update };
};
const req = (b: unknown) => ({ json: async () => b }) as never;
const ctx = { params: Promise.resolve({ recordId: REC }) } as never;

describe('PATCH .../[recordId]/defect', () => {
  beforeEach(() => { jest.clearAllMocks(); mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator' }); });

  it('불량을 넣으면 quality·oee 를 파생 확정한다', async () => {
    const { update } = wire();
    const res = await PATCH(req({ defect_qty: 10 }), ctx);
    expect(res.status).toBe(200);
    // quality = (100-10)/100 = .9 ; oee = .9(avail) * .8(perf) * .9 = .648
    const patch = update.mock.calls[0][0];
    expect(patch.defect_qty).toBe(10);
    expect(patch.quality).toBeCloseTo(0.9, 5);
    expect(patch.oee).toBeCloseTo(0.648, 3);
  });

  it('불량 > 생산 이면 400', async () => {
    wire();
    const res = await PATCH(req({ defect_qty: 200 }), ctx);
    expect(res.status).toBe(400);
  });

  it('없는 record 는 404', async () => {
    wire({ record: null as never });
    const res = await PATCH(req({ defect_qty: 1 }), ctx);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/app/api/production-records/[recordId]/defect`
Expected: FAIL — 라우트 없음.

- [ ] **Step 3: 구현**

```typescript
// src/app/api/production-records/[recordId]/defect/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, requireUser } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/production-records/[recordId]/defect — 다음날 불량 입력 → 확정.
 * avail·perf 스냅샷은 유지, quality/oee 만 파생 재계산. (미검사 NULL → 확정)
 */
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ recordId: string }> }) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    void user;
    const { recordId } = await ctx.params;
    const body = await request.json() as { defect_qty?: unknown };
    const defect = typeof body.defect_qty === 'number' ? body.defect_qty : Number.NaN;
    if (!Number.isInteger(defect) || defect < 0)
      return NextResponse.json({ error: 'defect_qty must be a non-negative integer' }, { status: 400 });

    const { data: rec, error: readErr } = await supabaseAdmin
      .from('production_records')
      .select('record_id, output_qty, availability, performance')
      .eq('record_id', recordId).maybeSingle();
    if (readErr) return NextResponse.json({ error: 'Failed to read record' }, { status: 500 });
    if (!rec) return NextResponse.json({ error: 'record not found' }, { status: 404 });
    if (defect > rec.output_qty)
      return NextResponse.json({ error: 'defect_qty must not exceed output_qty' }, { status: 400 });

    const quality = rec.output_qty > 0 ? Math.min(Math.max((rec.output_qty - defect) / rec.output_qty, 0), 1) : 0;
    // avail·perf 가 null(런타임 미보고)이면 oee 도 null 로 남긴다.
    const oee = rec.availability === null || rec.performance === null
      ? null : rec.availability * rec.performance * quality;

    const { error: updErr } = await supabaseAdmin
      .from('production_records')
      .update({ defect_qty: defect, quality, oee })
      .eq('record_id', recordId);
    if (updErr) return NextResponse.json({ error: 'Failed to update defect' }, { status: 500 });
    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest src/app/api/production-records/[recordId]/defect`
Expected: PASS — 3 tests.

- [ ] **Step 5: 커밋**

```bash
git add "src/app/api/production-records/[recordId]/defect/"
git commit -m "feat(records): 다음날 불량 입력 엔드포인트(quality·oee 파생 확정)"
```

---

## Task 6: 백로그 조회 (`GET /api/production-records/pending`)

**동작:** 한 설비(또는 담당 설비 전체)의 **마감대기**(WORKING 교대인데 확정 record 없음)와 **불량대기**(record 있고 defect NULL)를 돌려준다. Plan 2 콘솔의 배지·조건부 섹션이 소비.

**Files:**
- Create: `src/app/api/production-records/pending/route.ts`
- Test: `src/app/api/production-records/pending/__tests__/route.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/app/api/production-records/pending/__tests__/route.test.ts
jest.mock('next/server', () => ({
  NextResponse: { json: (b: unknown, i?: { status?: number }) => ({ status: i?.status ?? 200, json: async () => b }) },
}));
const mockRequireUser = jest.fn();
const mockFrom = jest.fn();
jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: () => undefined,
  apiAuthErrorResponse: () => null,
}));
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: (...a: unknown[]) => mockFrom(...a) } }));
import { GET } from '../route';
const MACHINE = '11111111-1111-4111-8111-111111111111';
const call = (qs: string) => GET({ url: `http://x/api/production-records/pending?${qs}` } as never);

// production_shift_states: WORKING 교대 목록 / production_records: 확정 record(및 defect null 여부)
const wire = ({ working = [{ date: '2026-07-17', shift: 'A' }, { date: '2026-07-17', shift: 'B' }],
                records = [{ date: '2026-07-17', shift: 'A', record_id: 'rA', defect_qty: null }] } = {}) => {
  mockFrom.mockImplementation((t: string) => {
    if (t === 'production_shift_states') return { select: () => ({ eq: () => ({ eq: async () => ({ data: working, error: null }) }) }) };
    if (t === 'production_records') return { select: () => ({ eq: async () => ({ data: records, error: null }) }) };
    throw new Error(`unexpected ${t}`);
  });
};

describe('GET /api/production-records/pending', () => {
  beforeEach(() => { jest.clearAllMocks(); mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] }); });

  it('마감대기(record 없는 WORKING 교대)와 불량대기(defect NULL)를 분리해 돌려준다', async () => {
    wire();
    const res = await call(`machine_id=${MACHINE}`);
    const body = await res.json() as { close_pending: unknown[]; defect_pending: unknown[] };
    // B 조는 WORKING 인데 record 없음 → 마감대기. A 조는 record 있고 defect null → 불량대기.
    expect(body.close_pending).toEqual([{ date: '2026-07-17', shift: 'B' }]);
    expect(body.defect_pending).toEqual([{ date: '2026-07-17', shift: 'A', record_id: 'rA' }]);
  });

  it('machine_id 없으면 400', async () => {
    const res = await call('');
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/app/api/production-records/pending`
Expected: FAIL — 라우트 없음.

- [ ] **Step 3: 구현** — WORKING 교대와 record 를 대조. `production_shift_states` 의 실제 컬럼/상태값(WORKING)과 조회 shape 을 구현 시 확인하고 맞춘다.

```typescript
// src/app/api/production-records/pending/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/production-records/pending?machine_id= — 마감/불량 백로그.
 * close_pending: WORKING 교대인데 확정 record 없음(마감 필요). 무기한(자동 마감 없음).
 * defect_pending: record 있으나 defect NULL(미검사, 다음날 불량 필요).
 */
export async function GET(request: NextRequest) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { searchParams } = new URL(request.url);
    const machineId = searchParams.get('machine_id') ?? '';
    if (!UUID.test(machineId)) return NextResponse.json({ error: 'machine_id is required' }, { status: 400 });
    assertMachineAccess(user, machineId);

    const { data: working, error: wErr } = await supabaseAdmin
      .from('production_shift_states')
      .select('date, shift').eq('machine_id', machineId).eq('state', 'WORKING');
    if (wErr) return NextResponse.json({ error: 'Failed to read shift states' }, { status: 500 });

    const { data: records, error: rErr } = await supabaseAdmin
      .from('production_records')
      .select('date, shift, record_id, defect_qty').eq('machine_id', machineId);
    if (rErr) return NextResponse.json({ error: 'Failed to read records' }, { status: 500 });

    const recByKey = new Map((records ?? []).map(r => [`${r.date} ${r.shift}`, r]));
    const close_pending = (working ?? [])
      .filter(w => !recByKey.has(`${w.date} ${w.shift}`))
      .map(w => ({ date: w.date, shift: w.shift }));
    const defect_pending = (records ?? [])
      .filter(r => r.defect_qty === null)
      .map(r => ({ date: r.date, shift: r.shift, record_id: r.record_id }));

    return NextResponse.json({ close_pending, defect_pending });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx jest src/app/api/production-records/pending`
Expected: PASS — 2 tests.

- [ ] **Step 5: 전체 회귀 + 커밋**

```bash
npx jest --runInBand 2>&1 | grep -E "^Tests:|^Test Suites:|FAIL"
git add src/app/api/production-records/pending/
git commit -m "feat(records): 마감/불량 백로그 조회 엔드포인트"
```

---

## Self-Review (작성자 체크)

- **Spec 커버리지:** §5 defect NULL(Task 1·2), OEE 품질보류 규율(Task 2·3), 교대 마감·늦은 귀속(Task 4), 다음날 불량 확정(Task 5), 마감/불량 백로그(Task 6). §4.5 andon(비가동 동시 기록)은 **Plan 2**에서 다룸(콘솔 동작). §6 진입점 통합·§4.1~4.4 UI 는 Plan 2.
- **미해결(구현 시 확인):** ① `production_records` 유니크 제약 `(machine_id,date,shift)` 존재 여부(Task 4 upsert 전제) — 없으면 유니크 마이그레이션 선행. ② `production_shift_states` 의 상태 컬럼명/값 `WORKING`(Task 6) — 실제 스키마 확인. ③ `daily/route.ts` `calculateShiftMetrics` 반환 필드명이 `computeShiftSnapshot` 과 다르면 매핑(Task 3 Step 5). 이 셋은 각 태스크 Step 에 확인 지시를 넣어 뒀다.
- **적용 게이트:** 마이그레이션(Task 1) 적용·main 병합은 사용자 명시 지시 시에만.

---

## Plan 2 예고 (별도 문서)

운영자 콘솔 UI — 레이아웃 A(목록+콘솔), 인라인 진척, andon 비가동(한 동작→두 테이블), 지난교대 마감 섹션(close-shift 호출·prefill), 불량대기 섹션([recordId]/defect 호출), 백로그 배지(pending 소비). Plan 1 구현·검증 후 작성한다.
