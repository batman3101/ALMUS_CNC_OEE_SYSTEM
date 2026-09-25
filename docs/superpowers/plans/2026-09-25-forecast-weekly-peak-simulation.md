# Forecast 주별 최대 일수량 배치 시뮬레이션 — 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/forecast` 에서 접수한 파일의 선택 주(월~일) 모델별 최대 일수량으로 모델·공정별 필요대수와 설비 단위 재배치 검토안을 보여준다.

**Architecture:** 접수 API 응답에 공장 스냅샷(모델·공정 T/T, 설비 현재 배치)을 추가하고, 브라우저에서 순수 함수 4개(주차 묶기·수요 → 모델 짝짓기 → 필요대수 → 재배치)로 계산해 antd 카드 하나에 표시한다. DB 쓰기 없음.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Ant Design, Jest 30 + Testing Library, Supabase service-role 읽기.

**Spec:** `docs/superpowers/specs/2026-09-25-forecast-weekly-peak-simulation-design.md`

## Global Constraints

- 브랜치 `design/forecast-layout-preview` 에서만 작업. main 병합·push·마이그레이션·배포 없음.
- CAPA 는 `src/utils/productionCapacity.ts` 의 `calculateDailyCapacity` 만 사용. `cavity_count` 를 곱하거나 나누지 않는다. 교대 가동시간은 `DEFAULT_OPERATING_MINUTES`(720) 두 교대, 휴식은 `capacityPolicy.breakMinutes`.
- 조회 실패는 `{ status: 'unavailable' }`. 임의 기본값으로 대체하지 않는다.
- 표의 NULL 값은 정렬 양방향 모두 맨 뒤(`table-sorting-conventions`).
- 번역 키는 `public/locales/ko/forecast.json` 과 `vi/forecast.json` 에 **같은 키 집합**으로 추가한다(기존 테스트가 키 집합 일치를 검사한다).
- 파일은 한 줄에 여러 문장을 넣는 기존 압축 스타일을 따르되, 새 파일은 가독성을 우선한다.
- 테스트 실행 명령(공통): `node node_modules/jest/bin/jest.js --runInBand <경로>`
- 커밋은 파일 단위 `git add <path>`. 디렉터리 `git add` 금지.

---

### Task 1: 타입 + 주차 묶기·주별 수요 (`weeklyDemand.ts`)

**Files:**
- Modify: `src/types/forecast.ts` (끝에 타입 추가)
- Create: `src/lib/forecast/weeklyDemand.ts`
- Test: `src/lib/forecast/__tests__/weeklyDemand.test.ts`

**Interfaces:**
- Produces: `isoWeek(date)`, `groupWeeks(dates): ForecastWeek[]`, `weeklyModelDemand(rows, week): WeeklyModelDemand[]`, 타입 `ForecastProcess`, `ForecastSnapshotModel`, `ForecastSnapshotMachine`, `ForecastCapacitySnapshot`, `ForecastWeek`, `WeeklyModelDemand`, `DemandWarning`.

- [ ] **Step 1: 타입 추가** — `src/types/forecast.ts` 끝에 붙인다.

```ts
export type ForecastProcess = 'CNC1' | 'CNC2';

export interface ForecastSnapshotModel {
  id: string; name: string; isActive: boolean;
  processes: Array<{ id: string; name: string; order: number; tactTimeSeconds: number | null }>;
}
export interface ForecastSnapshotMachine {
  id: string; name: string; location: string; isActive: boolean; modelId: string | null; processId: string | null;
}
/** Read-only factory state taken when the file was inspected; never a layout to apply. */
export type ForecastCapacitySnapshot = { status: 'unavailable' } | {
  status: 'available'; takenAt: string; models: ForecastSnapshotModel[]; machines: ForecastSnapshotMachine[];
};
```

그리고 `FactoryForecastPreview` 에 필드를 추가한다:

```ts
export interface FactoryForecastPreview extends ForecastPreview {
  factory: { id: string; code: string };
  fileName: string;
  capacityPolicy: ForecastCapacityPolicy;
  capacitySnapshot: ForecastCapacitySnapshot;
}
```

- [ ] **Step 2: 실패하는 테스트 작성** — `src/lib/forecast/__tests__/weeklyDemand.test.ts`

```ts
import type { ForecastSourceRow } from '@/types/forecast';
import { groupWeeks, isoWeek, weeklyModelDemand } from '../weeklyDemand';

const row = (model: string, quantities: Array<[string, number | null, ForecastSourceRow['quantities'][number]['state']?]>, extra: Partial<ForecastSourceRow> = {}): ForecastSourceRow => ({
  sourceRow: 1, model, displayModel: model, vendor: 'ALMUS', processGroup: 'CNC', processLabel: 'CNC 1 ~ CNC 2', processes: ['CNC1', 'CNC2'], issues: [],
  quantities: quantities.map(([date, quantity, state]) => ({ date, cell: 'A1', quantity, state: state ?? (quantity === null ? 'blank' : 'number'), formula: false, error: null })),
  ...extra,
});
const days = (start: string, count: number) => Array.from({ length: count }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));

describe('ISO weeks', () => {
  it('starts weeks on Monday and numbers them by ISO 8601', () => {
    expect(isoWeek('2026-09-07')).toEqual({ year: 2026, week: 37, monday: '2026-09-07' });
    expect(isoWeek('2026-09-13')).toEqual({ year: 2026, week: 37, monday: '2026-09-07' });
    expect(isoWeek('2026-01-01')).toEqual({ year: 2026, week: 1, monday: '2025-12-29' });
  });
  it('groups 77 days starting on a Monday into 11 full weeks', () => {
    const weeks = groupWeeks(days('2026-09-07', 77));
    expect(weeks).toHaveLength(11);
    expect(weeks[0]).toMatchObject({ key: '2026-W37', label: 'W37', start: '2026-09-07', end: '2026-09-13', partial: false });
    expect(weeks[0].dates).toHaveLength(7);
    expect(weeks[10]).toMatchObject({ key: '2026-W47', end: '2026-11-22' });
  });
  it('marks a week that the file does not fully cover as partial', () => {
    const weeks = groupWeeks(days('2026-09-09', 10));
    expect(weeks[0]).toMatchObject({ key: '2026-W37', partial: true });
    expect(weeks[0].dates).toEqual(days('2026-09-09', 5));
    expect(weeks[1]).toMatchObject({ key: '2026-W38', partial: true });
  });
});

describe('weekly peak demand', () => {
  const week = groupWeeks(days('2026-09-07', 7))[0];
  it('uses the largest daily quantity in the week and remembers its date', () => {
    const [demand] = weeklyModelDemand([row('H8 MAIN', [['2026-09-07', 100], ['2026-09-08', 900], ['2026-09-09', 300]])], week);
    expect(demand).toMatchObject({ model: 'H8 MAIN', week: '2026-W37', peakQuantity: 900, peakDate: '2026-09-08', numericDays: 3, warnings: [] });
  });
  it('sums rows of the same model per date before taking the peak', () => {
    const rows = [row('M1', [['2026-09-07', 400]]), row('M1', [['2026-09-07', 500]], { vendor: 'OTHER', sourceRow: 2 })];
    expect(weeklyModelDemand(rows, week)[0]).toMatchObject({ peakQuantity: 900, peakDate: '2026-09-07' });
  });
  it('flags duplicate source rows because their sum may double count', () => {
    const rows = [row('M1', [['2026-09-07', 400]], { issues: ['duplicate_row'] }), row('M1', [['2026-09-07', 400]], { sourceRow: 2, issues: ['duplicate_row'] })];
    expect(weeklyModelDemand(rows, week)[0].warnings).toContain('duplicate_rows');
  });
  it('treats blanks as zero, warns on error cells, and rounds fractions up', () => {
    const [demand] = weeklyModelDemand([row('ON 1', [['2026-09-07', null], ['2026-09-08', null, 'error'], ['2026-09-09', 10.2]])], week);
    expect(demand).toMatchObject({ peakQuantity: 11, peakDate: '2026-09-09', blankCells: 1, errorCells: 1, fractional: true });
    expect(demand.warnings).toEqual(expect.arrayContaining(['error_cells', 'fractional']));
  });
  it('reports a model with no numeric cell in the week instead of inventing zero demand', () => {
    const [demand] = weeklyModelDemand([row('E1', [['2026-09-07', null, 'missing_cache']])], week);
    expect(demand).toMatchObject({ peakQuantity: 0, peakDate: null, numericDays: 0 });
    expect(demand.warnings).toContain('no_numeric');
  });
  it('ignores dates outside the week, rows without a model, and unsupported processes', () => {
    const rows = [row('M3', [['2026-09-14', 999], ['2026-09-07', 1]]), row('', [['2026-09-07', 5]]), row('X', [['2026-09-07', 5]], { processes: [] })];
    const demands = weeklyModelDemand(rows, week);
    expect(demands).toHaveLength(1);
    expect(demands[0]).toMatchObject({ model: 'M3', peakQuantity: 1 });
  });
  it('adds partial_week when the selected week is incomplete', () => {
    const partial = groupWeeks(days('2026-09-09', 2))[0];
    expect(weeklyModelDemand([row('M3', [['2026-09-09', 1]])], partial)[0].warnings).toContain('partial_week');
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `node node_modules/jest/bin/jest.js --runInBand src/lib/forecast/__tests__/weeklyDemand.test.ts`
Expected: FAIL — `Cannot find module '../weeklyDemand'`

- [ ] **Step 4: 구현** — `src/lib/forecast/weeklyDemand.ts`

```ts
import type { ForecastSourceRow } from '@/types/forecast';

export interface ForecastWeek { key: string; label: string; start: string; end: string; dates: string[]; partial: boolean }
export type DemandWarning = 'error_cells' | 'fractional' | 'partial_week' | 'no_numeric' | 'duplicate_rows';
export interface WeeklyModelDemand {
  model: string; week: string; peakQuantity: number; peakDate: string | null;
  numericDays: number; blankCells: number; errorCells: number; fractional: boolean; warnings: DemandWarning[];
}

const DAY = 86_400_000;
const utc = (date: string) => Date.parse(`${date}T00:00:00Z`);
const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Monday-start week containing the date, numbered by ISO 8601 (week 1 holds the first Thursday). */
export function isoWeek(date: string): { year: number; week: number; monday: string } {
  const ms = utc(date);
  const monday = ms - ((new Date(ms).getUTCDay() + 6) % 7) * DAY;
  const thursday = monday + 3 * DAY;
  const year = new Date(thursday).getUTCFullYear();
  const week = Math.ceil(((thursday - Date.UTC(year, 0, 1)) / DAY + 1) / 7);
  return { year, week, monday: iso(monday) };
}

export function groupWeeks(dates: string[]): ForecastWeek[] {
  const weeks = new Map<string, ForecastWeek>();
  for (const date of [...dates].sort()) {
    const { year, week, monday } = isoWeek(date);
    const label = `W${String(week).padStart(2, '0')}`;
    const key = `${year}-${label}`;
    let entry = weeks.get(key);
    if (!entry) { entry = { key, label, start: monday, end: iso(utc(monday) + 6 * DAY), dates: [], partial: false }; weeks.set(key, entry); }
    entry.dates.push(date);
  }
  for (const week of weeks.values()) week.partial = week.dates.length < 7;
  return [...weeks.values()];
}

/** Peak daily quantity per model inside one week. Same-model rows are summed per date first (PRD 6.2). */
export function weeklyModelDemand(rows: ForecastSourceRow[], week: ForecastWeek): WeeklyModelDemand[] {
  const inWeek = new Set(week.dates);
  const models = new Map<string, { daily: Map<string, number>; blank: number; error: number; fractional: boolean; duplicate: boolean }>();
  for (const row of rows) {
    if (!row.model || !row.processes.length) continue;
    let entry = models.get(row.model);
    if (!entry) { entry = { daily: new Map(), blank: 0, error: 0, fractional: false, duplicate: false }; models.set(row.model, entry); }
    if (row.issues.includes('duplicate_row')) entry.duplicate = true;
    for (const q of row.quantities) {
      if (!inWeek.has(q.date)) continue;
      if (q.state === 'blank') { entry.blank++; continue; }
      if (q.state !== 'number' || q.quantity === null) { entry.error++; continue; }
      if (!Number.isInteger(q.quantity)) entry.fractional = true;
      entry.daily.set(q.date, (entry.daily.get(q.date) ?? 0) + q.quantity);
    }
  }
  return [...models.entries()].map(([model, entry]) => {
    let peak = 0; let peakDate: string | null = null;
    for (const date of week.dates) { const value = entry.daily.get(date); if (value !== undefined && value > peak) { peak = value; peakDate = date; } }
    const warnings: DemandWarning[] = [];
    if (entry.error) warnings.push('error_cells');
    if (entry.fractional) warnings.push('fractional');
    if (entry.duplicate) warnings.push('duplicate_rows');
    if (week.partial) warnings.push('partial_week');
    if (!entry.daily.size) warnings.push('no_numeric');
    return { model, week: week.key, peakQuantity: Math.ceil(peak), peakDate, numericDays: entry.daily.size, blankCells: entry.blank, errorCells: entry.error, fractional: entry.fractional, warnings };
  }).sort((a, b) => a.model.localeCompare(b.model));
}
```

- [ ] **Step 5: 통과 확인**

Run: `node node_modules/jest/bin/jest.js --runInBand src/lib/forecast/__tests__/weeklyDemand.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 6: 커밋**

```bash
git add src/types/forecast.ts src/lib/forecast/weeklyDemand.ts src/lib/forecast/__tests__/weeklyDemand.test.ts
git commit -m "feat(forecast): ISO 주차 묶기와 주별 모델 최대 일수량 산출"
```

---

### Task 2: 모델·공정 짝짓기 (`modelAliases.ts`)

**Files:**
- Create: `src/lib/forecast/modelAliases.ts`
- Test: `src/lib/forecast/__tests__/modelAliases.test.ts`

**Interfaces:**
- Consumes: `ForecastSnapshotModel`, `ForecastProcess` (Task 1)
- Produces: `normalizeModelName`, `normalizeProcessName`, `FORECAST_MODEL_ALIASES`, `matchModels(forecastModels, snapshotModels): Map<string, ModelMatch>`, 타입 `ModelMatch`, `ProcessRef`.

- [ ] **Step 1: 실패하는 테스트** — `src/lib/forecast/__tests__/modelAliases.test.ts`

```ts
import type { ForecastSnapshotModel } from '@/types/forecast';
import { matchModels, normalizeModelName, normalizeProcessName } from '../modelAliases';

const model = (id: string, name: string, processes: Array<[string, number, number | null]>, isActive = true): ForecastSnapshotModel => ({
  id, name, isActive, processes: processes.map(([pname, order, tact], i) => ({ id: `${id}-p${i}`, name: pname, order, tactTimeSeconds: tact })),
});
const db = [
  model('h8m', 'H8 M', [['CNC #0', 1, 63], ['CNC #1', 2, 593], ['CNC #2', 3, 453]]),
  model('h8m-old', 'H8M', [['CNC #1', 1, 593]], false),
  model('dm3', 'DM 3', [['CNC # 1', 1, 630], ['CNC # 2', 2, 796]]),
  model('on1', 'ON1', [['CNC #1', 1, 560], ['CNC #2', 2, 558]]),
  model('pa3', 'PA3', [['CNC #1', 1, 1391], ['CNC #2', 2, 1197], ['CNC #2-1', 3, 409]]),
  model('zero', 'ZERO', [['CNC #1', 1, 0], ['CNC #2', 2, null]]),
];

describe('model and process name matching', () => {
  it('normalizes spacing and case', () => {
    expect(normalizeModelName(' On 1 ')).toBe('ON1');
    expect(normalizeModelName('Canvas 2')).toBe('CANVAS2');
  });
  it('recognizes only CNC1 and CNC2 process names in their spelling variants', () => {
    expect(normalizeProcessName('CNC #1')).toBe('CNC1');
    expect(normalizeProcessName('CNC # 2')).toBe('CNC2');
    expect(normalizeProcessName('CNC #0')).toBeNull();
    expect(normalizeProcessName('CNC #2-1')).toBeNull();
  });
  it('matches by normalized name and by alias, skipping inactive models', () => {
    const matches = matchModels(['ON 1', 'H8 MAIN', 'Diamond3', 'Hubble Y2'], db);
    expect(matches.get('ON 1')).toMatchObject({ reason: 'matched', dbModel: { id: 'on1' } });
    expect(matches.get('H8 MAIN')).toMatchObject({ reason: 'alias', dbModel: { id: 'h8m' } });
    expect(matches.get('Diamond3')).toMatchObject({ reason: 'alias', dbModel: { id: 'dm3' } });
    expect(matches.get('Hubble Y2')).toMatchObject({ reason: 'unmapped', dbModel: null });
  });
  it('resolves CNC1/CNC2 process ids and tact time per model', () => {
    const h8 = matchModels(['H8 MAIN'], db).get('H8 MAIN')!;
    expect(h8.processes.CNC1).toEqual({ id: 'h8m-p1', tactTimeSeconds: 593 });
    expect(h8.processes.CNC2).toEqual({ id: 'h8m-p2', tactTimeSeconds: 453 });
    const dm = matchModels(['Diamond3'], db).get('Diamond3')!;
    expect(dm.processes.CNC1).toEqual({ id: 'dm3-p0', tactTimeSeconds: 630 });
  });
  it('keeps a missing process as null instead of borrowing another process', () => {
    const single = matchModels(['ONLY'], [model('only', 'ONLY', [['CNC #1', 1, 100]])]).get('ONLY')!;
    expect(single.processes).toEqual({ CNC1: { id: 'only-p0', tactTimeSeconds: 100 }, CNC2: null });
  });
  it('refuses an ambiguous match when two active models normalize to the same name', () => {
    const twins = [model('a', 'B7 SUB', [['CNC #1', 1, 1]]), model('b', 'B7SUB', [['CNC #1', 1, 1]])];
    expect(matchModels(['B7 Sub'], twins).get('B7 Sub')).toMatchObject({ reason: 'ambiguous', dbModel: null });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node node_modules/jest/bin/jest.js --runInBand src/lib/forecast/__tests__/modelAliases.test.ts`
Expected: FAIL — `Cannot find module '../modelAliases'`

- [ ] **Step 3: 구현** — `src/lib/forecast/modelAliases.ts`

```ts
import type { ForecastProcess, ForecastSnapshotModel } from '@/types/forecast';

export const normalizeModelName = (name: string): string => name.replace(/\s+/g, '').toUpperCase();

/**
 * Forecast spelling → DB spelling, both normalized. Verified against the live DB on 2026-09-25:
 * these are the only machine-bearing models whose names differ beyond spacing/case.
 * Adding an entry here is a mapping decision; confirm with the factory before extending.
 */
export const FORECAST_MODEL_ALIASES: Readonly<Record<string, string>> = { H8MAIN: 'H8M', DIAMOND3: 'DM3' };

/** Only CNC1/CNC2 are forecast processes; `CNC #0`, `CNC #2-1` stay out of scope. */
export function normalizeProcessName(name: string): ForecastProcess | null {
  const compact = name.replace(/[\s#]/g, '').toUpperCase();
  return compact === 'CNC1' ? 'CNC1' : compact === 'CNC2' ? 'CNC2' : null;
}

export interface ProcessRef { id: string; tactTimeSeconds: number | null }
export interface ModelMatch {
  forecastModel: string;
  dbModel: ForecastSnapshotModel | null;
  reason: 'matched' | 'alias' | 'unmapped' | 'ambiguous';
  processes: Record<ForecastProcess, ProcessRef | null>;
}

function processRefs(model: ForecastSnapshotModel | null): Record<ForecastProcess, ProcessRef | null> {
  const refs: Record<ForecastProcess, ProcessRef | null> = { CNC1: null, CNC2: null };
  if (!model) return refs;
  for (const process of [...model.processes].sort((a, b) => a.order - b.order)) {
    const key = normalizeProcessName(process.name);
    if (key && !refs[key]) refs[key] = { id: process.id, tactTimeSeconds: process.tactTimeSeconds };
  }
  return refs;
}

export function matchModels(forecastModels: string[], snapshotModels: ForecastSnapshotModel[]): Map<string, ModelMatch> {
  const index = new Map<string, ForecastSnapshotModel[]>();
  for (const model of snapshotModels) {
    if (!model.isActive) continue;
    const key = normalizeModelName(model.name);
    index.set(key, [...(index.get(key) ?? []), model]);
  }
  const result = new Map<string, ModelMatch>();
  for (const forecastModel of forecastModels) {
    const normalized = normalizeModelName(forecastModel);
    const alias = FORECAST_MODEL_ALIASES[normalized];
    const candidates = index.get(alias ?? normalized) ?? [];
    const dbModel = candidates.length === 1 ? candidates[0] : null;
    const reason: ModelMatch['reason'] = candidates.length > 1 ? 'ambiguous' : !dbModel ? 'unmapped' : alias ? 'alias' : 'matched';
    result.set(forecastModel, { forecastModel, dbModel, reason, processes: processRefs(dbModel) });
  }
  return result;
}
```

- [ ] **Step 4: 통과 확인**

Run: `node node_modules/jest/bin/jest.js --runInBand src/lib/forecast/__tests__/modelAliases.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/forecast/modelAliases.ts src/lib/forecast/__tests__/modelAliases.test.ts
git commit -m "feat(forecast): Forecast 모델명과 DB 모델·공정 짝짓기(별칭 H8 MAIN, Diamond3)"
```

---

### Task 3: 필요대수 (`requiredMachines.ts`)

**Files:**
- Create: `src/lib/forecast/requiredMachines.ts`
- Test: `src/lib/forecast/__tests__/requiredMachines.test.ts`

**Interfaces:**
- Consumes: `WeeklyModelDemand` (Task 1), `ModelMatch` (Task 2), `calculateDailyCapacity` (`src/utils/productionCapacity.ts`), `DEFAULT_OPERATING_MINUTES` (`src/lib/plannedRuntime.ts`, 값 720).
- Produces: `dailyCapacityPerMachine(tact, breakMinutes): number | null`, `buildRequirements(input): ModelProcessRequirement[]`, 타입 `ModelProcessRequirement`, `RequirementStatus`.

- [ ] **Step 1: 실패하는 테스트** — `src/lib/forecast/__tests__/requiredMachines.test.ts`

```ts
import type { ForecastSnapshotMachine, ForecastSnapshotModel } from '@/types/forecast';
import { matchModels } from '../modelAliases';
import type { WeeklyModelDemand } from '../weeklyDemand';
import { buildRequirements, dailyCapacityPerMachine } from '../requiredMachines';

const demand = (model: string, peakQuantity: number, warnings: WeeklyModelDemand['warnings'] = []): WeeklyModelDemand =>
  ({ model, week: '2026-W37', peakQuantity, peakDate: peakQuantity ? '2026-09-08' : null, numericDays: 7, blankCells: 0, errorCells: 0, fractional: false, warnings });
const models: ForecastSnapshotModel[] = [
  { id: 'on1', name: 'ON1', isActive: true, processes: [{ id: 'on1-c1', name: 'CNC #1', order: 1, tactTimeSeconds: 560 }, { id: 'on1-c2', name: 'CNC #2', order: 2, tactTimeSeconds: 558 }] },
  { id: 'zero', name: 'ZERO', isActive: true, processes: [{ id: 'zero-c1', name: 'CNC #1', order: 1, tactTimeSeconds: 0 }, { id: 'zero-c2', name: 'CNC #2', order: 2, tactTimeSeconds: null }] },
  { id: 'idle', name: 'IDLE', isActive: true, processes: [{ id: 'idle-c1', name: 'CNC #1', order: 1, tactTimeSeconds: 600 }, { id: 'idle-c2', name: 'CNC #2', order: 2, tactTimeSeconds: 600 }] },
];
const machine = (name: string, modelId: string | null, processId: string | null, isActive = true): ForecastSnapshotMachine => ({ id: name, name, location: 'A동', isActive, modelId, processId });
const machines = [
  ...Array.from({ length: 15 }, (_, i) => machine(`CNC-${String(i + 1).padStart(3, '0')}`, 'on1', 'on1-c1')),
  ...Array.from({ length: 10 }, (_, i) => machine(`CNC-${String(i + 101).padStart(3, '0')}`, 'on1', 'on1-c2')),
  machine('CNC-900', 'on1', 'on1-c2', false),
  machine('CNC-950', 'idle', 'idle-c1'),
];

describe('required machines from weekly peak demand', () => {
  it('reuses the OEE capacity formula: two 720-minute shifts, breaks subtracted once, floored per shift', () => {
    // (720 - 110) * 60 / 560 = 65.35 → 65 per shift → 130 per day. No cavity factor.
    expect(dailyCapacityPerMachine(560, 110)).toBe(130);
    expect(dailyCapacityPerMachine(0, 110)).toBeNull();
    expect(dailyCapacityPerMachine(null, 110)).toBeNull();
  });
  it('computes required = ceil(peak / daily capacity) per process with the same quantity for CNC1 and CNC2', () => {
    const rows = buildRequirements({ demands: [demand('ON 1', 2000)], matches: matchModels(['ON 1'], models), machines, breakMinutes: 110 });
    const c1 = rows.find(r => r.forecastModel === 'ON 1' && r.process === 'CNC1')!;
    const c2 = rows.find(r => r.forecastModel === 'ON 1' && r.process === 'CNC2')!;
    expect(c1).toMatchObject({ dbModel: { id: 'on1', name: 'ON1' }, tactTimeSeconds: 560, dailyCapacity: 130, peakQuantity: 2000, required: 16, current: 15, gap: 1, status: 'shortage' });
    // (720 - 110) * 60 / 558 = 65.59 → 65 → 130/day; 2000 / 130 = 15.38 → 16 needed, 10 active (inactive CNC-900 not counted)
    expect(c2).toMatchObject({ dailyCapacity: 130, required: 16, current: 10, gap: 6, status: 'shortage' });
  });
  it('marks surplus, exact fit, and zero demand', () => {
    const rows = buildRequirements({ demands: [demand('ON 1', 1300)], matches: matchModels(['ON 1'], models), machines, breakMinutes: 110 });
    expect(rows.find(r => r.process === 'CNC1')).toMatchObject({ required: 10, current: 15, gap: -5, status: 'surplus' });
    expect(rows.find(r => r.process === 'CNC2')).toMatchObject({ required: 10, current: 10, gap: 0, status: 'ok' });
    const idle = buildRequirements({ demands: [demand('ON 1', 0)], matches: matchModels(['ON 1'], models), machines, breakMinutes: 110 });
    expect(idle.find(r => r.process === 'CNC1')).toMatchObject({ required: 0, gap: -15, status: 'zero_demand' });
  });
  it('holds unmapped models and processes without tact time instead of guessing', () => {
    const rows = buildRequirements({ demands: [demand('Hubble Y2', 500), demand('ZERO', 500)], matches: matchModels(['Hubble Y2', 'ZERO'], models), machines, breakMinutes: 110 });
    expect(rows.filter(r => r.forecastModel === 'Hubble Y2')).toEqual([expect.objectContaining({ process: 'CNC1', status: 'unmapped', required: null, gap: null }), expect.objectContaining({ process: 'CNC2', status: 'unmapped' })]);
    expect(rows.filter(r => r.forecastModel === 'ZERO').map(r => r.status)).toEqual(['no_tact', 'no_tact']);
  });
  it('lists DB models that hold machines but are absent from the forecast as not_in_forecast', () => {
    const rows = buildRequirements({ demands: [demand('ON 1', 1300)], matches: matchModels(['ON 1'], models), machines, breakMinutes: 110 });
    expect(rows.find(r => r.dbModel?.id === 'idle' && r.process === 'CNC1')).toMatchObject({ forecastModel: null, status: 'not_in_forecast', current: 1, required: null });
    expect(rows.find(r => r.dbModel?.id === 'idle' && r.process === 'CNC2')).toBeUndefined();
  });
  it('carries demand warnings through', () => {
    const rows = buildRequirements({ demands: [demand('ON 1', 10, ['error_cells'])], matches: matchModels(['ON 1'], models), machines, breakMinutes: 110 });
    expect(rows[0].warnings).toEqual(['error_cells']);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node node_modules/jest/bin/jest.js --runInBand src/lib/forecast/__tests__/requiredMachines.test.ts`
Expected: FAIL — `Cannot find module '../requiredMachines'`

- [ ] **Step 3: 구현** — `src/lib/forecast/requiredMachines.ts`

```ts
import { DEFAULT_OPERATING_MINUTES } from '@/lib/plannedRuntime';
import { calculateDailyCapacity } from '@/utils/productionCapacity';
import type { ForecastProcess, ForecastSnapshotMachine } from '@/types/forecast';
import type { ModelMatch } from './modelAliases';
import type { DemandWarning, WeeklyModelDemand } from './weeklyDemand';

export type RequirementStatus = 'ok' | 'shortage' | 'surplus' | 'zero_demand' | 'unmapped' | 'no_tact' | 'not_in_forecast';
export interface ModelProcessRequirement {
  key: string;
  forecastModel: string | null;
  dbModel: { id: string; name: string } | null;
  process: ForecastProcess;
  processId: string | null;
  tactTimeSeconds: number | null;
  dailyCapacity: number | null;
  peakQuantity: number;
  peakDate: string | null;
  required: number | null;
  current: number;
  gap: number | null;
  status: RequirementStatus;
  warnings: DemandWarning[];
}
export interface RequirementInput { demands: WeeklyModelDemand[]; matches: Map<string, ModelMatch>; machines: ForecastSnapshotMachine[]; breakMinutes: number }

const PROCESSES: ForecastProcess[] = ['CNC1', 'CNC2'];

/** Same formula as the OEE input form: floor per 720-minute shift after one break deduction, then sum. */
export function dailyCapacityPerMachine(tactTimeSeconds: number | null, breakMinutes: number): number | null {
  if (tactTimeSeconds === null || !Number.isFinite(tactTimeSeconds) || tactTimeSeconds <= 0) return null;
  const shift = { operatingMinutes: DEFAULT_OPERATING_MINUTES, breakMinutes };
  return calculateDailyCapacity(tactTimeSeconds, [shift, shift]);
}

export function countActiveMachines(machines: ForecastSnapshotMachine[], modelId: string, processId: string): number {
  return machines.filter(m => m.isActive && m.modelId === modelId && m.processId === processId).length;
}

export function buildRequirements({ demands, matches, machines, breakMinutes }: RequirementInput): ModelProcessRequirement[] {
  const rows: ModelProcessRequirement[] = [];
  const covered = new Set<string>();
  for (const demand of demands) {
    const match = matches.get(demand.model);
    for (const process of PROCESSES) {
      const ref = match?.processes[process] ?? null;
      const dbModel = match?.dbModel ? { id: match.dbModel.id, name: match.dbModel.name } : null;
      const processId = ref?.id ?? null;
      if (dbModel && processId) covered.add(`${dbModel.id}:${processId}`);
      const current = dbModel && processId ? countActiveMachines(machines, dbModel.id, processId) : 0;
      const base = { key: `${demand.model}:${process}`, forecastModel: demand.model, dbModel, process, processId, peakQuantity: demand.peakQuantity, peakDate: demand.peakDate, current, warnings: demand.warnings };
      if (!dbModel) { rows.push({ ...base, tactTimeSeconds: null, dailyCapacity: null, required: null, gap: null, status: 'unmapped' }); continue; }
      const dailyCapacity = dailyCapacityPerMachine(ref?.tactTimeSeconds ?? null, breakMinutes);
      if (!processId || dailyCapacity === null) { rows.push({ ...base, tactTimeSeconds: ref?.tactTimeSeconds ?? null, dailyCapacity: null, required: null, gap: null, status: 'no_tact' }); continue; }
      const required = demand.peakQuantity > 0 ? Math.ceil(demand.peakQuantity / dailyCapacity) : 0;
      const gap = required - current;
      const status: RequirementStatus = required === 0 ? 'zero_demand' : gap > 0 ? 'shortage' : gap < 0 ? 'surplus' : 'ok';
      rows.push({ ...base, tactTimeSeconds: ref?.tactTimeSeconds ?? null, dailyCapacity, required, gap, status });
    }
  }
  // Machines whose model/process never appears in the forecast: demand unknown, shown but never pooled.
  const modelsById = new Map([...matches.values()].filter(m => m.dbModel).map(m => [m.dbModel!.id, m.dbModel!]));
  const seen = new Set<string>();
  for (const machine of machines) {
    if (!machine.isActive || !machine.modelId || !machine.processId) continue;
    const key = `${machine.modelId}:${machine.processId}`;
    if (covered.has(key) || seen.has(key)) continue;
    seen.add(key);
    const model = modelsById.get(machine.modelId);
    if (model) continue; // model is in the forecast; this is a non-CNC1/2 process, reported separately
    rows.push({ key: `db:${key}`, forecastModel: null, dbModel: null, process: 'CNC1', processId: machine.processId, tactTimeSeconds: null, dailyCapacity: null, peakQuantity: 0, peakDate: null, required: null, current: 0, gap: null, status: 'not_in_forecast', warnings: [] });
  }
  return rows;
}
```

> 위 `not_in_forecast` 블록은 스냅샷 모델 목록이 없어 이름·공정을 채울 수 없다. 실제 구현에서는 `RequirementInput` 에 `models: ForecastSnapshotModel[]` 를 추가하고 아래처럼 바꾼다(테스트가 이 형태를 요구한다):

```ts
export interface RequirementInput { demands: WeeklyModelDemand[]; matches: Map<string, ModelMatch>; models: ForecastSnapshotModel[]; machines: ForecastSnapshotMachine[]; breakMinutes: number }
// ...
  const forecastModelIds = new Set([...matches.values()].flatMap(m => m.dbModel ? [m.dbModel.id] : []));
  for (const model of models) {
    if (!model.isActive || forecastModelIds.has(model.id)) continue;
    for (const process of PROCESSES) {
      const ref = match(model, process); // normalizeProcessName 으로 CNC1/CNC2 공정 찾기
      if (!ref) continue;
      const current = countActiveMachines(machines, model.id, ref.id);
      if (!current) continue;
      rows.push({ key: `db:${model.id}:${process}`, forecastModel: null, dbModel: { id: model.id, name: model.name }, process, processId: ref.id, tactTimeSeconds: ref.tactTimeSeconds, dailyCapacity: dailyCapacityPerMachine(ref.tactTimeSeconds, breakMinutes), peakQuantity: 0, peakDate: null, required: null, current, gap: null, status: 'not_in_forecast', warnings: [] });
    }
  }
```

여기서 `match(model, process)` 는 `modelAliases.ts` 의 `processRefs` 를 export 해 재사용한다(`export function processRefs(...)`). 테스트 호출도 `models` 를 넘기도록 맞춘다: `buildRequirements({ demands, matches, models, machines, breakMinutes: 110 })`.

- [ ] **Step 4: 통과 확인**

Run: `node node_modules/jest/bin/jest.js --runInBand src/lib/forecast/__tests__/requiredMachines.test.ts src/lib/forecast/__tests__/modelAliases.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/lib/forecast/requiredMachines.ts src/lib/forecast/__tests__/requiredMachines.test.ts src/lib/forecast/modelAliases.ts
git commit -m "feat(forecast): 주 최대 일수량 기반 모델·공정별 필요대수"
```

---

### Task 4: 재배치 검토안 (`reassignment.ts`)

**Files:**
- Create: `src/lib/forecast/reassignment.ts`
- Test: `src/lib/forecast/__tests__/reassignment.test.ts`

**Interfaces:**
- Consumes: `ModelProcessRequirement` (Task 3), `WeeklyModelDemand` (Task 1), `ForecastSnapshotMachine`.
- Produces: `proposeReassignment(input): ReassignmentProposal`, 타입 `ReassignmentMove`, `ReassignmentProposal`.

- [ ] **Step 1: 실패하는 테스트** — `src/lib/forecast/__tests__/reassignment.test.ts`

```ts
import type { ForecastSnapshotMachine } from '@/types/forecast';
import type { ModelProcessRequirement } from '../requiredMachines';
import { proposeReassignment } from '../reassignment';

const req = (forecastModel: string, dbId: string, process: 'CNC1' | 'CNC2', required: number | null, current: number, status: ModelProcessRequirement['status']): ModelProcessRequirement => ({
  key: `${forecastModel}:${process}`, forecastModel, dbModel: { id: dbId, name: dbId.toUpperCase() }, process, processId: `${dbId}-${process}`, tactTimeSeconds: 600, dailyCapacity: 100,
  peakQuantity: required ? required * 100 : 0, peakDate: null, required, current, gap: required === null ? null : required - current, status, warnings: [],
});
const machine = (name: string, modelId: string | null, processId: string | null): ForecastSnapshotMachine => ({ id: name, name, location: 'B동', isActive: true, modelId, processId });
const machines = [
  machine('CNC-001', 'on1', 'on1-CNC1'), machine('CNC-002', 'on1', 'on1-CNC1'), machine('CNC-003', 'on1', 'on1-CNC1'),
  machine('CNC-010', 'm3', 'm3-CNC1'), machine('CNC-011', 'm3', 'm3-CNC1'),
  machine('CNC-020', null, null),
  machine('CNC-030', 'pa1', 'pa1-CNC2'),
];

describe('minimal-change reassignment proposal', () => {
  it('moves surplus first, then unassigned, then zero-demand machines, highest machine number first', () => {
    const requirements = [
      req('ON 1', 'on1', 'CNC1', 1, 3, 'surplus'),
      req('M3', 'm3', 'CNC1', 0, 2, 'zero_demand'),
      req('PA1', 'pa1', 'CNC2', 1, 1, 'ok'),
      req('H8 MAIN', 'h8m', 'CNC2', 4, 0, 'shortage'),
    ];
    const proposal = proposeReassignment({ requirements, machines, nextWeekDemands: [] });
    expect(proposal.moves.map(m => [m.machineName, m.reason])).toEqual([['CNC-003', 'surplus'], ['CNC-002', 'surplus'], ['CNC-020', 'unassigned'], ['CNC-011', 'zero_demand']]);
    expect(proposal.moves[0]).toMatchObject({ from: { model: 'ON1', process: 'CNC1' }, to: { model: 'H8M', process: 'CNC2' }, location: 'B동', nextWeekDemand: false });
    expect(proposal.unresolved).toEqual([]);
    expect(proposal.summary).toEqual({ required: 6, current: 6, shortage: 4, surplus: 4, changes: 4 });
  });
  it('fills the largest shortage first and reports what the pool could not cover', () => {
    const requirements = [req('ON 1', 'on1', 'CNC1', 2, 3, 'surplus'), req('A', 'a', 'CNC1', 3, 0, 'shortage'), req('B', 'b', 'CNC2', 5, 0, 'shortage')];
    const proposal = proposeReassignment({ requirements, machines: machines.slice(0, 3), nextWeekDemands: [] });
    expect(proposal.moves).toHaveLength(1);
    expect(proposal.moves[0].to).toEqual({ model: 'B', process: 'CNC2' });
    expect(proposal.unresolved).toEqual([{ dbModel: 'B', process: 'CNC2', remaining: 4 }, { dbModel: 'A', process: 'CNC1', remaining: 3 }]);
  });
  it('uses machines whose model has demand next week only as a last resort and flags them', () => {
    const requirements = [req('ON 1', 'on1', 'CNC1', 1, 3, 'surplus'), req('M3', 'm3', 'CNC1', 0, 2, 'zero_demand'), req('X', 'x', 'CNC1', 3, 0, 'shortage')];
    const nextWeek = [{ model: 'ON 1', week: '2026-W38', peakQuantity: 500, peakDate: '2026-09-15', numericDays: 7, blankCells: 0, errorCells: 0, fractional: false, warnings: [] as never[] }];
    const proposal = proposeReassignment({ requirements, machines, nextWeekDemands: nextWeek });
    expect(proposal.moves.map(m => [m.machineName, m.nextWeekDemand])).toEqual([['CNC-020', false], ['CNC-011', false], ['CNC-010', false]]);
  });
  it('never pools machines of unmapped, no_tact, or not_in_forecast rows, and never moves inactive machines', () => {
    const requirements = [
      { ...req('Hubble Y2', 'y2', 'CNC1', null, 0, 'unmapped'), dbModel: null, processId: null },
      req('ZERO', 'zero', 'CNC1', null, 2, 'no_tact'),
      { ...req('', 'idle', 'CNC1', null, 1, 'not_in_forecast'), forecastModel: null },
      req('X', 'x', 'CNC1', 5, 0, 'shortage'),
    ];
    const pool = [machine('CNC-050', 'zero', 'zero-CNC1'), machine('CNC-051', 'idle', 'idle-CNC1'), { ...machine('CNC-052', null, null), isActive: false }];
    const proposal = proposeReassignment({ requirements, machines: pool, nextWeekDemands: [] });
    expect(proposal.moves).toEqual([]);
    expect(proposal.unresolved).toEqual([{ dbModel: 'X', process: 'CNC1', remaining: 5 }]);
  });
  it('is deterministic for equal inputs', () => {
    const requirements = [req('ON 1', 'on1', 'CNC1', 0, 3, 'zero_demand'), req('X', 'x', 'CNC1', 2, 0, 'shortage')];
    const a = proposeReassignment({ requirements, machines, nextWeekDemands: [] });
    const b = proposeReassignment({ requirements: [...requirements].reverse(), machines: [...machines].reverse(), nextWeekDemands: [] });
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node node_modules/jest/bin/jest.js --runInBand src/lib/forecast/__tests__/reassignment.test.ts`
Expected: FAIL — `Cannot find module '../reassignment'`

- [ ] **Step 3: 구현** — `src/lib/forecast/reassignment.ts`

```ts
import type { ForecastProcess, ForecastSnapshotMachine } from '@/types/forecast';
import type { ModelProcessRequirement } from './requiredMachines';
import type { WeeklyModelDemand } from './weeklyDemand';

export type MoveReason = 'surplus' | 'unassigned' | 'zero_demand';
export interface ReassignmentMove {
  machineId: string; machineName: string; location: string;
  from: { model: string | null; process: ForecastProcess | null };
  to: { model: string; process: ForecastProcess };
  reason: MoveReason; nextWeekDemand: boolean;
}
export interface ReassignmentProposal {
  moves: ReassignmentMove[];
  unresolved: Array<{ dbModel: string; process: ForecastProcess; remaining: number }>;
  summary: { required: number; current: number; shortage: number; surplus: number; changes: number };
}
export interface ReassignmentInput { requirements: ModelProcessRequirement[]; machines: ForecastSnapshotMachine[]; nextWeekDemands: WeeklyModelDemand[] }

const REASON_RANK: Record<MoveReason, number> = { surplus: 0, unassigned: 1, zero_demand: 2 };
const byNameDesc = (a: ForecastSnapshotMachine, b: ForecastSnapshotMachine) => b.name.localeCompare(a.name);

/**
 * Greedy, deterministic, quantity-only. One machine move = one change (PRD 6.4/6.5).
 * Compatibility, changeover time, and JIG are not modeled; the output is a review draft.
 */
export function proposeReassignment({ requirements, machines, nextWeekDemands }: ReassignmentInput): ReassignmentProposal {
  const nextWeek = new Set(nextWeekDemands.filter(d => d.peakQuantity > 0).map(d => d.model));
  const pool: Array<{ machine: ForecastSnapshotMachine; from: ReassignmentMove['from']; reason: MoveReason; nextWeekDemand: boolean }> = [];

  for (const row of requirements) {
    if (!row.dbModel || !row.processId || row.gap === null || row.gap >= 0) continue;
    if (row.status !== 'surplus' && row.status !== 'zero_demand') continue;
    const candidates = machines.filter(m => m.isActive && m.modelId === row.dbModel!.id && m.processId === row.processId).sort(byNameDesc).slice(0, -row.gap);
    for (const machine of candidates) pool.push({ machine, from: { model: row.dbModel.name, process: row.process }, reason: row.status, nextWeekDemand: row.forecastModel !== null && nextWeek.has(row.forecastModel) });
  }
  for (const machine of machines.filter(m => m.isActive && (!m.modelId || !m.processId)).sort(byNameDesc)) {
    pool.push({ machine, from: { model: null, process: null }, reason: 'unassigned', nextWeekDemand: false });
  }
  pool.sort((a, b) => Number(a.nextWeekDemand) - Number(b.nextWeekDemand) || REASON_RANK[a.reason] - REASON_RANK[b.reason] || byNameDesc(a.machine, b.machine));

  const shortages = requirements
    .filter(r => r.status === 'shortage' && r.dbModel && r.gap !== null && r.gap > 0)
    .map(r => ({ dbModel: r.dbModel!.name, process: r.process, remaining: r.gap! }))
    .sort((a, b) => b.remaining - a.remaining || a.dbModel.localeCompare(b.dbModel) || a.process.localeCompare(b.process));

  const moves: ReassignmentMove[] = [];
  for (const shortage of shortages) {
    while (shortage.remaining > 0 && pool.length) {
      const { machine, from, reason, nextWeekDemand } = pool.shift()!;
      moves.push({ machineId: machine.id, machineName: machine.name, location: machine.location, from, to: { model: shortage.dbModel, process: shortage.process }, reason, nextWeekDemand });
      shortage.remaining--;
    }
  }
  const computed = requirements.filter(r => r.required !== null && r.gap !== null);
  return {
    moves,
    unresolved: shortages.filter(s => s.remaining > 0),
    summary: {
      required: computed.reduce((sum, r) => sum + (r.required ?? 0), 0),
      current: computed.reduce((sum, r) => sum + r.current, 0),
      shortage: computed.reduce((sum, r) => sum + Math.max(0, r.gap ?? 0), 0),
      surplus: computed.reduce((sum, r) => sum + Math.max(0, -(r.gap ?? 0)), 0),
      changes: moves.length,
    },
  };
}
```

> 첫 테스트의 `summary` 기대값 확인: required 1+0+1+4=6, current 3+2+1+0=6, shortage 4, surplus 2+2=4, changes 4. 세 번째 테스트에서 ON 1 의 잉여 2대는 다음 주 수요가 있어 마지막 순서이므로 부족 3대는 CNC-020(미배정)·CNC-011·CNC-010(수요 0)으로 채워진다.

- [ ] **Step 4: 통과 확인**

Run: `node node_modules/jest/bin/jest.js --runInBand src/lib/forecast/__tests__/reassignment.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/lib/forecast/reassignment.ts src/lib/forecast/__tests__/reassignment.test.ts
git commit -m "feat(forecast): 최소 변경 재배치 검토안(여유→미배정→수요0, 다음 주 수요 보호)"
```

---

### Task 5: 공장 스냅샷 로더 + 접수 API 응답 확장

**Files:**
- Create: `src/lib/forecast/capacitySnapshot.ts`
- Test: `src/lib/forecast/__tests__/capacitySnapshot.test.ts`
- Modify: `src/app/api/forecasts/preview/route.ts` (import 1줄, `Promise.all`, 응답 필드)
- Modify: `src/app/api/forecasts/preview/__tests__/route.test.ts` (mock 1개, 검증 2개)

**Interfaces:**
- Produces: `loadForecastCapacitySnapshot(factoryId): Promise<ForecastCapacitySnapshot>`; API 응답 `preview.capacitySnapshot`.

- [ ] **Step 1: 로더 테스트** — `src/lib/forecast/__tests__/capacitySnapshot.test.ts`

```ts
const from = jest.fn();
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { from: (...args: unknown[]) => from(...args) } }));
import { SNAPSHOT_LIMIT, loadForecastCapacitySnapshot } from '../capacitySnapshot';

type Row = Record<string, unknown>;
function table(data: Row[] | null, error: unknown = null) {
  const builder: Record<string, unknown> = {};
  for (const method of ['select', 'eq', 'order', 'limit']) builder[method] = jest.fn(() => builder);
  builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve);
  return builder;
}

describe('factory capacity snapshot', () => {
  beforeEach(() => jest.clearAllMocks());
  it('reads models, processes and machines of one factory only and nests processes under models', async () => {
    const tables: Record<string, ReturnType<typeof table>> = {
      product_models: table([{ id: 'm1', model_name: 'ON1', is_active: true }]),
      model_processes: table([{ id: 'p1', model_id: 'm1', process_name: 'CNC #1', process_order: 1, tact_time_seconds: 560 }, { id: 'p9', model_id: 'ghost', process_name: 'CNC #1', process_order: 1, tact_time_seconds: 1 }]),
      machines: table([{ id: 'x', name: 'CNC-001', location: 'A동', is_active: true, production_model_id: 'm1', current_process_id: 'p1' }]),
    };
    from.mockImplementation((name: string) => tables[name]);
    const snapshot = await loadForecastCapacitySnapshot('factory-1');
    expect(snapshot).toMatchObject({ status: 'available', models: [{ id: 'm1', name: 'ON1', isActive: true, processes: [{ id: 'p1', name: 'CNC #1', order: 1, tactTimeSeconds: 560 }] }], machines: [{ id: 'x', name: 'CNC-001', location: 'A동', isActive: true, modelId: 'm1', processId: 'p1' }] });
    for (const t of Object.values(tables)) expect(t.eq).toHaveBeenCalledWith('factory_id', 'factory-1');
  });
  it('reports unavailable on any query error instead of a partial snapshot', async () => {
    from.mockImplementation((name: string) => name === 'machines' ? table(null, { message: 'boom' }) : table([]));
    expect(await loadForecastCapacitySnapshot('factory-1')).toEqual({ status: 'unavailable' });
  });
  it('refuses a result that may have been truncated at the row limit', async () => {
    from.mockImplementation((name: string) => name === 'machines' ? table(Array.from({ length: SNAPSHOT_LIMIT }, (_, i) => ({ id: String(i), name: 'CNC', location: '', is_active: true, production_model_id: null, current_process_id: null }))) : table([]));
    expect(await loadForecastCapacitySnapshot('factory-1')).toEqual({ status: 'unavailable' });
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node node_modules/jest/bin/jest.js --runInBand src/lib/forecast/__tests__/capacitySnapshot.test.ts`
Expected: FAIL — `Cannot find module '../capacitySnapshot'`

- [ ] **Step 3: 로더 구현** — `src/lib/forecast/capacitySnapshot.ts`

```ts
import { supabaseAdmin } from '@/lib/supabase-admin';
import type { ForecastCapacitySnapshot, ForecastSnapshotModel } from '@/types/forecast';

/** Well above 800 machines / ~60 processes; hitting it means the query was cut, so the snapshot is refused. */
export const SNAPSHOT_LIMIT = 5000;

interface ModelRow { id: string; model_name: string; is_active: boolean }
interface ProcessRow { id: string; model_id: string; process_name: string; process_order: number; tact_time_seconds: number | null }
interface MachineRow { id: string; name: string; location: string | null; is_active: boolean; production_model_id: string | null; current_process_id: string | null }

/** Read-only view of one factory at inspection time. Never a default: failure is `unavailable`. */
export async function loadForecastCapacitySnapshot(factoryId: string): Promise<ForecastCapacitySnapshot> {
  try {
    const [models, processes, machines] = await Promise.all([
      supabaseAdmin.from('product_models').select('id, model_name, is_active').eq('factory_id', factoryId).order('model_name').limit(SNAPSHOT_LIMIT),
      supabaseAdmin.from('model_processes').select('id, model_id, process_name, process_order, tact_time_seconds').eq('factory_id', factoryId).order('process_order').limit(SNAPSHOT_LIMIT),
      supabaseAdmin.from('machines').select('id, name, location, is_active, production_model_id, current_process_id').eq('factory_id', factoryId).order('name').limit(SNAPSHOT_LIMIT),
    ]);
    if (models.error || processes.error || machines.error) return { status: 'unavailable' };
    const rows = { models: (models.data ?? []) as ModelRow[], processes: (processes.data ?? []) as ProcessRow[], machines: (machines.data ?? []) as MachineRow[] };
    if (Object.values(rows).some(list => list.length >= SNAPSHOT_LIMIT)) return { status: 'unavailable' };
    const byModel = new Map<string, ForecastSnapshotModel>(rows.models.map(m => [m.id, { id: m.id, name: m.model_name, isActive: m.is_active, processes: [] }]));
    for (const p of rows.processes) byModel.get(p.model_id)?.processes.push({ id: p.id, name: p.process_name, order: p.process_order, tactTimeSeconds: p.tact_time_seconds });
    return {
      status: 'available', takenAt: new Date().toISOString(), models: [...byModel.values()],
      machines: rows.machines.map(m => ({ id: m.id, name: m.name, location: m.location ?? '', isActive: m.is_active, modelId: m.production_model_id, processId: m.current_process_id })),
    };
  } catch { return { status: 'unavailable' }; }
}
```

- [ ] **Step 4: 로더 테스트 통과 확인**

Run: `node node_modules/jest/bin/jest.js --runInBand src/lib/forecast/__tests__/capacitySnapshot.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 라우트 테스트 확장** — `route.test.ts` 에 mock 과 검증을 추가한다.

mock 선언부(기존 `mockPolicy` 아래):
```ts
const mockSnapshot = jest.fn();
jest.mock('@/lib/forecast/capacitySnapshot', () => ({ loadForecastCapacitySnapshot: (...args: unknown[]) => mockSnapshot(...args) }));
```
`beforeEach` 에 `mockSnapshot.mockResolvedValue({ status: 'unavailable' });` 추가.
첫 테스트에 추가:
```ts
    expect(mockSnapshot).toHaveBeenCalledWith('factory-1');
    expect(body.preview.capacitySnapshot).toEqual({ status: 'unavailable' });
```
권한 실패 테스트에 `expect(mockSnapshot).not.toHaveBeenCalled();` 추가.
새 테스트:
```ts
  it('returns the factory snapshot alongside the preview', async () => {
    mockSnapshot.mockResolvedValue({ status: 'available', takenAt: 't', models: [], machines: [] });
    const body = await (await POST(request())).json();
    expect(body.preview.capacitySnapshot).toMatchObject({ status: 'available', models: [], machines: [] });
  });
```

- [ ] **Step 6: 실패 확인**

Run: `node node_modules/jest/bin/jest.js --runInBand src/app/api/forecasts/preview`
Expected: FAIL — `capacitySnapshot` undefined / mockSnapshot not called

- [ ] **Step 7: 라우트 수정** — `route.ts`

import 추가: `import { loadForecastCapacitySnapshot } from '@/lib/forecast/capacitySnapshot';`
아래 두 줄을
```ts
    const capacityPolicy = await loadForecastCapacityPolicy(user.factoryId);
    return NextResponse.json({ success: true, preview: { ...preview, factory: { id: user.factoryId, code: user.factoryCode }, fileName, capacityPolicy } }, ...);
```
이렇게 바꾼다:
```ts
    const [capacityPolicy, capacitySnapshot] = await Promise.all([loadForecastCapacityPolicy(user.factoryId), loadForecastCapacitySnapshot(user.factoryId)]);
    return NextResponse.json({ success: true, preview: { ...preview, factory: { id: user.factoryId, code: user.factoryCode }, fileName, capacityPolicy, capacitySnapshot } }, { headers: { 'Cache-Control': 'private, no-store' } });
```

- [ ] **Step 8: 통과 확인**

Run: `node node_modules/jest/bin/jest.js --runInBand src/app/api/forecasts/preview src/lib/forecast`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add src/lib/forecast/capacitySnapshot.ts src/lib/forecast/__tests__/capacitySnapshot.test.ts src/app/api/forecasts/preview/route.ts src/app/api/forecasts/preview/__tests__/route.test.ts
git commit -m "feat(forecast): 접수 응답에 공장 모델·공정·설비 스냅샷 포함"
```

---

### Task 6: 화면 카드 + 번역 + 컴포넌트 테스트

**Files:**
- Create: `src/components/forecast/WeeklySimulationCard.tsx`
- Create: `src/components/forecast/__tests__/WeeklySimulationCard.test.tsx`
- Modify: `src/components/forecast/ForecastWorkspace.tsx` (import 1줄, 파일 카드 아래 1줄)
- Modify: `src/components/forecast/ForecastWorkspace.module.css` (규칙 2개)
- Modify: `public/locales/ko/forecast.json`, `public/locales/vi/forecast.json` (`simulation` 객체)

**Interfaces:**
- Consumes: Task 1~4 함수, `FactoryForecastPreview.capacitySnapshot` (Task 5).
- Produces: `<WeeklySimulationCard preview={FactoryForecastPreview} />`

- [ ] **Step 1: 번역 키 추가** — `ko/forecast.json` 맨 끝 `capacityUnavailable` 뒤에:

```json
  "simulation": {
    "title": "주별 배치 시뮬레이션 (검토안)",
    "notice": "선택한 주의 모델별 최대 일수량으로 필요대수를 계산합니다. 호환성·교체시간·JIG는 반영하지 않으며 운영 설비에 적용되지 않습니다.",
    "week": "기준 주차",
    "partial": "부분 주",
    "snapshotUnavailable": "설비·T/T 정보를 읽지 못해 시뮬레이션을 보류합니다.",
    "policyUnavailable": "OEE 시간 설정이 없어 CAPA를 계산할 수 없습니다.",
    "snapshotTaken": "설비·T/T 기준 시각 {{time}} · 교대 720분 × 2 · 휴식 {{rest}}분",
    "required": "필요대수",
    "current": "현재 배치",
    "shortage": "부족",
    "surplus": "여유",
    "changes": "변경 건수",
    "model": "모델",
    "dbModel": "DB 모델",
    "process": "공정",
    "peak": "주 최대 일수량",
    "peakDate": "최대일",
    "capacity": "1대 일 CAPA",
    "gap": "차이",
    "status": "상태",
    "statuses": {
      "ok": "충족",
      "shortage": "부족",
      "surplus": "여유",
      "zero_demand": "수요 없음",
      "unmapped": "모델 미매칭",
      "no_tact": "T/T 없음",
      "not_in_forecast": "Forecast 없음"
    },
    "warnings": {
      "error_cells": "오류 셀 포함",
      "fractional": "소수 올림",
      "partial_week": "부분 주",
      "no_numeric": "숫자 없음",
      "duplicate_rows": "중복 행 합산"
    },
    "movesTitle": "재배치 검토안",
    "machine": "설비",
    "location": "위치",
    "fromTo": "현재 → 변경",
    "reason": "사유",
    "reasons": {
      "surplus": "여유 설비",
      "unassigned": "미배정 설비",
      "zero_demand": "수요 없는 모델"
    },
    "nextWeekDemand": "다음 주 수요 있음",
    "noMoves": "옮길 설비가 없습니다.",
    "unresolved": "풀 부족으로 남은 수량: {{list}}",
    "unmappedTitle": "미매칭 모델 {{count}}개 (계산 보류)",
    "excludedMachines": "계산 대상 밖 설비(CNC #0 등 다른 공정) {{count}}대",
    "unassignedMachines": "모델 미배정 설비 {{count}}대"
  }
```

`vi/forecast.json` 에 같은 키로 베트남어:

```json
  "simulation": {
    "title": "Mô phỏng bố trí theo tuần (bản xem xét)",
    "notice": "Tính số máy cần theo sản lượng ngày cao nhất của từng model trong tuần đã chọn. Chưa xét tương thích, thời gian đổi model, JIG và không áp dụng vào máy thực tế.",
    "week": "Tuần",
    "partial": "Tuần không đủ ngày",
    "snapshotUnavailable": "Không đọc được máy/T/T nên tạm dừng mô phỏng.",
    "policyUnavailable": "Không có cài đặt giờ OEE nên không tính được CAPA.",
    "snapshotTaken": "Dữ liệu máy/T/T lúc {{time}} · 2 ca × 720 phút · nghỉ {{rest}} phút",
    "required": "Máy cần",
    "current": "Đang bố trí",
    "shortage": "Thiếu",
    "surplus": "Dư",
    "changes": "Số thay đổi",
    "model": "Model",
    "dbModel": "Model DB",
    "process": "Công đoạn",
    "peak": "SL ngày cao nhất",
    "peakDate": "Ngày cao nhất",
    "capacity": "CAPA/máy/ngày",
    "gap": "Chênh lệch",
    "status": "Trạng thái",
    "statuses": {
      "ok": "Đủ",
      "shortage": "Thiếu",
      "surplus": "Dư",
      "zero_demand": "Không có nhu cầu",
      "unmapped": "Chưa khớp model",
      "no_tact": "Không có T/T",
      "not_in_forecast": "Không có trong Forecast"
    },
    "warnings": {
      "error_cells": "Có ô lỗi",
      "fractional": "Làm tròn lên",
      "partial_week": "Tuần không đủ ngày",
      "no_numeric": "Không có số",
      "duplicate_rows": "Cộng dòng trùng"
    },
    "movesTitle": "Đề xuất bố trí lại",
    "machine": "Máy",
    "location": "Vị trí",
    "fromTo": "Hiện tại → Đổi",
    "reason": "Lý do",
    "reasons": {
      "surplus": "Máy dư",
      "unassigned": "Máy chưa gán model",
      "zero_demand": "Model không có nhu cầu"
    },
    "nextWeekDemand": "Tuần sau có nhu cầu",
    "noMoves": "Không có máy để chuyển.",
    "unresolved": "Còn thiếu sau khi hết máy dư: {{list}}",
    "unmappedTitle": "{{count}} model chưa khớp (tạm dừng tính)",
    "excludedMachines": "{{count}} máy ngoài phạm vi (công đoạn khác như CNC #0)",
    "unassignedMachines": "{{count}} máy chưa gán model"
  }
```

- [ ] **Step 2: 컴포넌트 테스트** — `src/components/forecast/__tests__/WeeklySimulationCard.test.tsx`

```tsx
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { FactoryForecastPreview } from '@/types/forecast';
import WeeklySimulationCard from '../WeeklySimulationCard';

jest.mock('@/hooks/useTranslation', () => ({ useTranslation: () => ({ t: (key: string, opts?: Record<string, unknown>) => opts && 'count' in opts ? `${key}:${opts.count}` : key, language: 'ko' }) }));

const days = (start: string, count: number) => Array.from({ length: count }, (_, i) => new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10));
const dates = days('2026-09-07', 14);
const row = (model: string, week1: number, week2: number, sourceRow = 1): FactoryForecastPreview['rows'][number] => ({
  sourceRow, model, displayModel: model, vendor: 'ALMUS', processGroup: 'CNC', processLabel: 'CNC 1 ~ CNC 2', processes: ['CNC1', 'CNC2'], issues: [],
  quantities: dates.map((date, i) => ({ date, cell: `I${i}`, quantity: i < 7 ? week1 : week2, state: 'number', formula: false, error: null })),
});
const preview = (overrides: Partial<FactoryForecastPreview> = {}): FactoryForecastPreview => ({
  parserVersion: 'almus-v1', sourceHash: 'h', sheet: 'S', dates, rows: [row('ON 1', 1300, 0), row('Hubble Y2', 50, 50, 2)],
  summary: { sourceRows: 2, excludedRows: 0, models: 2, formulaCells: 0, numericTotal: 0, states: { number: 28, blank: 0, error: 0, missing_cache: 0, invalid: 0 }, fractionalCells: 0, rowIssues: 0 },
  requiresReview: true, capacityValidated: false, factory: { id: 'f', code: 'ALT' }, fileName: 'plan.xlsx',
  capacityPolicy: { status: 'available', source: 'oee_settings', timezone: 'Asia/Ho_Chi_Minh', shiftAStart: '08:00', shiftBStart: '20:00', breakMinutes: 110, separateEfficiencyMultiplier: false },
  capacitySnapshot: { status: 'available', takenAt: '2026-09-25T00:00:00Z', models: [
    { id: 'on1', name: 'ON1', isActive: true, processes: [{ id: 'on1-c1', name: 'CNC #1', order: 1, tactTimeSeconds: 560 }, { id: 'on1-c2', name: 'CNC #2', order: 2, tactTimeSeconds: 558 }] },
  ], machines: [
    ...Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, name: `CNC-${String(i + 1).padStart(3, '0')}`, location: 'A동', isActive: true, modelId: 'on1', processId: 'on1-c1' })),
    ...Array.from({ length: 8 }, (_, i) => ({ id: `b${i}`, name: `CNC-${String(i + 101).padStart(3, '0')}`, location: 'B동', isActive: true, modelId: 'on1', processId: 'on1-c2' })),
    { id: 'u', name: 'CNC-500', location: 'B동', isActive: true, modelId: null, processId: null },
  ] },
  ...overrides,
});

describe('WeeklySimulationCard', () => {
  it('defaults to the first week and shows required vs current per model/process', () => {
    render(<WeeklySimulationCard preview={preview()} />);
    // ON 1 peak 1300, CAPA 130/day → 10 needed; CNC1 has 12 (surplus 2), CNC2 has 8 (shortage 2)
    const table = screen.getByTestId('requirements-table');
    expect(within(table).getByText('simulation.statuses.surplus')).toBeInTheDocument();
    expect(within(table).getByText('simulation.statuses.shortage')).toBeInTheDocument();
    expect(within(table).getAllByText('simulation.statuses.unmapped')).toHaveLength(2);
    expect(screen.getByText('simulation.unmappedTitle:1')).toBeInTheDocument();
  });
  it('proposes moving surplus machines before the unassigned one, highest number first', () => {
    render(<WeeklySimulationCard preview={preview()} />);
    const moves = screen.getByTestId('moves-table');
    const names = within(moves).getAllByText(/^CNC-\d{3}$/).map(el => el.textContent);
    expect(names).toEqual(['CNC-012', 'CNC-011']);
    expect(within(moves).getAllByText('simulation.reasons.surplus')).toHaveLength(2);
  });
  it('recomputes when another week is selected', () => {
    render(<WeeklySimulationCard preview={preview()} />);
    fireEvent.mouseDown(screen.getByRole('combobox'));
    fireEvent.click(screen.getByText(/W38/));
    // week 2: ON 1 demand 0 → both processes zero_demand, nothing to move
    expect(screen.getAllByText('simulation.statuses.zero_demand')).toHaveLength(2);
    expect(screen.getByText('simulation.noMoves')).toBeInTheDocument();
  });
  it('holds the simulation when the snapshot or the OEE settings are unavailable', () => {
    const { rerender } = render(<WeeklySimulationCard preview={preview({ capacitySnapshot: { status: 'unavailable' } })} />);
    expect(screen.getByText('simulation.snapshotUnavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('requirements-table')).not.toBeInTheDocument();
    rerender(<WeeklySimulationCard preview={preview({ capacityPolicy: { status: 'unavailable' } })} />);
    expect(screen.getByText('simulation.policyUnavailable')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 실패 확인**

Run: `node node_modules/jest/bin/jest.js --runInBand src/components/forecast/__tests__/WeeklySimulationCard.test.tsx`
Expected: FAIL — `Cannot find module '../WeeklySimulationCard'`

- [ ] **Step 4: 컴포넌트 구현** — `src/components/forecast/WeeklySimulationCard.tsx`

```tsx
'use client';

import React, { useMemo, useState } from 'react';
import { Alert, Card, Col, Row, Select, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useTranslation } from '@/hooks/useTranslation';
import type { FactoryForecastPreview } from '@/types/forecast';
import { groupWeeks, weeklyModelDemand } from '@/lib/forecast/weeklyDemand';
import { matchModels, normalizeProcessName } from '@/lib/forecast/modelAliases';
import { buildRequirements, type ModelProcessRequirement } from '@/lib/forecast/requiredMachines';
import { proposeReassignment, type ReassignmentMove } from '@/lib/forecast/reassignment';
import styles from './ForecastWorkspace.module.css';

const STATUS_RANK: Record<ModelProcessRequirement['status'], number> = { shortage: 0, unmapped: 1, no_tact: 2, surplus: 3, zero_demand: 4, not_in_forecast: 5, ok: 6 };
const STATUS_COLOR: Record<ModelProcessRequirement['status'], string> = { shortage: 'red', unmapped: 'orange', no_tact: 'orange', surplus: 'blue', zero_demand: 'default', not_in_forecast: 'default', ok: 'green' };
/** NULL sorts last in both directions (table-sorting convention). */
const nullable = (pick: (r: ModelProcessRequirement) => number | null) => (a: ModelProcessRequirement, b: ModelProcessRequirement, order?: 'ascend' | 'descend') => {
  const [x, y] = [pick(a), pick(b)];
  if (x === null && y === null) return 0;
  if (x === null) return order === 'descend' ? -1 : 1;
  if (y === null) return order === 'descend' ? 1 : -1;
  return x - y;
};

export default function WeeklySimulationCard({ preview }: { preview: FactoryForecastPreview }) {
  const { t, language } = useTranslation('forecast');
  const weeks = useMemo(() => groupWeeks(preview.dates), [preview.dates]);
  const [weekKey, setWeekKey] = useState(weeks[0]?.key ?? '');
  const weekIndex = Math.max(0, weeks.findIndex(w => w.key === weekKey));
  const week = weeks[weekIndex];
  const snapshot = preview.capacitySnapshot;
  const policy = preview.capacityPolicy;
  const numberFormat = new Intl.NumberFormat(language === 'vi' ? 'vi-VN' : 'ko-KR');

  const result = useMemo(() => {
    if (!week || snapshot?.status !== 'available' || policy.status !== 'available') return null;
    const demands = weeklyModelDemand(preview.rows, week);
    const nextWeek = weeks[weekIndex + 1];
    const nextWeekDemands = nextWeek ? weeklyModelDemand(preview.rows, nextWeek) : [];
    const matches = matchModels(demands.map(d => d.model), snapshot.models);
    const requirements = buildRequirements({ demands, matches, models: snapshot.models, machines: snapshot.machines, breakMinutes: policy.breakMinutes })
      .sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status] || (b.gap ?? 0) - (a.gap ?? 0) || (a.forecastModel ?? a.dbModel?.name ?? '').localeCompare(b.forecastModel ?? b.dbModel?.name ?? ''));
    const proposal = proposeReassignment({ requirements, machines: snapshot.machines, nextWeekDemands });
    const unmapped = [...matches.values()].filter(m => !m.dbModel).map(m => m.forecastModel);
    const processIds = new Set(snapshot.models.flatMap(m => m.processes.filter(p => normalizeProcessName(p.name)).map(p => p.id)));
    const active = snapshot.machines.filter(m => m.isActive);
    const unassigned = active.filter(m => !m.modelId || !m.processId).length;
    const excluded = active.filter(m => m.modelId && m.processId && !processIds.has(m.processId)).length;
    return { requirements, proposal, unmapped, unassigned, excluded };
  }, [preview.rows, week, weeks, weekIndex, snapshot, policy]);

  const columns: ColumnsType<ModelProcessRequirement> = [
    { title: t('simulation.model'), key: 'model', width: 190, sorter: (a, b) => (a.forecastModel ?? '').localeCompare(b.forecastModel ?? ''), render: (_, r) => <><strong>{r.forecastModel ?? '—'}</strong><div className={styles.secondary}>{r.dbModel?.name ?? t('simulation.statuses.unmapped')}</div></> },
    { title: t('simulation.process'), dataIndex: 'process', width: 80, sorter: (a, b) => a.process.localeCompare(b.process) },
    { title: t('simulation.peak'), key: 'peak', width: 150, sorter: (a, b) => a.peakQuantity - b.peakQuantity, render: (_, r) => <>{numberFormat.format(r.peakQuantity)}{r.peakDate && <div className={styles.secondary}>{r.peakDate}</div>}</> },
    { title: t('simulation.capacity'), key: 'capacity', width: 120, sorter: nullable(r => r.dailyCapacity), render: (_, r) => r.dailyCapacity === null ? '—' : numberFormat.format(r.dailyCapacity) },
    { title: t('simulation.required'), key: 'required', width: 100, sorter: nullable(r => r.required), render: (_, r) => r.required === null ? '—' : r.required },
    { title: t('simulation.current'), dataIndex: 'current', width: 100, sorter: (a, b) => a.current - b.current },
    { title: t('simulation.gap'), key: 'gap', width: 90, sorter: nullable(r => r.gap), render: (_, r) => r.gap === null ? '—' : r.gap > 0 ? `+${r.gap}` : String(r.gap) },
    { title: t('simulation.status'), key: 'status', sorter: (a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status], render: (_, r) => <Space wrap><Tag color={STATUS_COLOR[r.status]}>{t(`simulation.statuses.${r.status}`)}</Tag>{r.warnings.map(w => <Tag color="orange" key={w}>{t(`simulation.warnings.${w}`)}</Tag>)}</Space> },
  ];
  const moveColumns: ColumnsType<ReassignmentMove> = [
    { title: t('simulation.machine'), dataIndex: 'machineName', width: 110 },
    { title: t('simulation.location'), dataIndex: 'location', width: 90 },
    { title: t('simulation.fromTo'), key: 'fromTo', render: (_, m) => <>{m.from.model ? `${m.from.model} / ${m.from.process}` : '—'} → <strong>{m.to.model} / {m.to.process}</strong></> },
    { title: t('simulation.reason'), key: 'reason', render: (_, m) => <Space wrap><Tag>{t(`simulation.reasons.${m.reason}`)}</Tag>{m.nextWeekDemand && <Tag color="orange">{t('simulation.nextWeekDemand')}</Tag>}</Space> },
  ];

  return <Card title={t('simulation.title')}>
    <Space direction="vertical" className={styles.fullWidth} size="middle">
      <Alert type="warning" showIcon message={t('simulation.notice')} />
      <div className={styles.filters}>
        <label>{t('simulation.week')}
          <Select value={weekKey} onChange={setWeekKey} className={styles.weekSelect} options={weeks.map(w => ({ value: w.key, label: `${w.label} · ${w.start.slice(5)}~${w.end.slice(5)}${w.partial ? ` (${t('simulation.partial')})` : ''}` }))} />
        </label>
      </div>
      {snapshot?.status !== 'available' && <Alert type="warning" message={t('simulation.snapshotUnavailable')} />}
      {snapshot?.status === 'available' && policy.status !== 'available' && <Alert type="warning" message={t('simulation.policyUnavailable')} />}
      {result && snapshot?.status === 'available' && policy.status === 'available' && <>
        <Typography.Text type="secondary">{t('simulation.snapshotTaken', { time: new Date(snapshot.takenAt).toLocaleString(language === 'vi' ? 'vi-VN' : 'ko-KR'), rest: policy.breakMinutes })}</Typography.Text>
        <Row gutter={[16, 16]} className={styles.statistics}>
          <Col xs={12} md={6}><Statistic title={t('simulation.required')} value={result.proposal.summary.required} /></Col>
          <Col xs={12} md={6}><Statistic title={t('simulation.current')} value={result.proposal.summary.current} /></Col>
          <Col xs={12} md={6}><Statistic title={t('simulation.shortage')} value={result.proposal.summary.shortage} valueStyle={result.proposal.summary.shortage ? { color: '#cf1322' } : undefined} /></Col>
          <Col xs={12} md={6}><Statistic title={t('simulation.changes')} value={result.proposal.summary.changes} /></Col>
        </Row>
        <div data-testid="requirements-table">
          <Table<ModelProcessRequirement> size="small" columns={columns} dataSource={result.requirements} rowKey="key" scroll={{ x: 900 }} pagination={{ pageSize: 20, showSizeChanger: true }} />
        </div>
        <Typography.Title level={5}>{t('simulation.movesTitle')}</Typography.Title>
        {result.proposal.moves.length
          ? <div data-testid="moves-table"><Table<ReassignmentMove> size="small" columns={moveColumns} dataSource={result.proposal.moves} rowKey="machineId" scroll={{ x: 600 }} pagination={{ pageSize: 20, showSizeChanger: true }} /></div>
          : <Typography.Text type="secondary">{t('simulation.noMoves')}</Typography.Text>}
        {result.proposal.unresolved.length > 0 && <Alert type="error" showIcon message={t('simulation.unresolved', { list: result.proposal.unresolved.map(u => `${u.dbModel} ${u.process} ${u.remaining}`).join(', ') })} />}
        {result.unmapped.length > 0 && <div><Typography.Text strong>{t('simulation.unmappedTitle', { count: result.unmapped.length })}</Typography.Text><div className={styles.tagList}>{result.unmapped.map(m => <Tag key={m}>{m}</Tag>)}</div></div>}
        <Typography.Text type="secondary">{t('simulation.excludedMachines', { count: result.excluded })} · {t('simulation.unassignedMachines', { count: result.unassigned })}</Typography.Text>
      </>}
    </Space>
  </Card>;
}
```

CSS 추가(`ForecastWorkspace.module.css` 끝, `@media` 줄 앞):
```css
.weekSelect { min-width: 240px; }
.tagList { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
```

- [ ] **Step 5: 워크스페이스 연결** — `ForecastWorkspace.tsx`

import: `import WeeklySimulationCard from './WeeklySimulationCard';`
파일 카드 `</Card>` 바로 뒤(`</>}` 앞)에: `<WeeklySimulationCard preview={visiblePreview} />`

- [ ] **Step 6: 테스트 통과 확인**

Run: `node node_modules/jest/bin/jest.js --runInBand src/components/forecast`
Expected: PASS (기존 5 + 새 4). 기존 `ForecastWorkspace.test.tsx` 의 fixture 에는 `capacitySnapshot` 이 없으므로 카드는 `snapshotUnavailable` 을 표시해야 하고, 테스트가 그대로 통과해야 한다. 번역 키 집합 테스트도 통과해야 한다.

- [ ] **Step 7: 타입 검사**

Run: `node node_modules/typescript/bin/tsc --noEmit --incremental false`
Expected: 오류 0

- [ ] **Step 8: 커밋**

```bash
git add src/components/forecast/WeeklySimulationCard.tsx src/components/forecast/__tests__/WeeklySimulationCard.test.tsx src/components/forecast/ForecastWorkspace.tsx src/components/forecast/ForecastWorkspace.module.css public/locales/ko/forecast.json public/locales/vi/forecast.json
git commit -m "feat(forecast): 주별 배치 시뮬레이션 카드(필요대수·재배치 검토안)"
```

---

### Task 7: 실제 파일 대조 + 전체 검증 + 브라우저 확인 + 상태 문서

**Files:**
- Modify: `src/lib/forecast/__tests__/weeklyDemand.test.ts` (실제 파일 대조 1개 추가)
- Modify: `docs/FORECAST_IMPLEMENTATION_STATUS.md` (구현 내용·검증 결과 추가)

- [ ] **Step 1: 실제 파일 대조 테스트** — `weeklyDemand.test.ts` 끝에 추가

```ts
import { readFileSync } from 'node:fs';
import { parseForecastFile } from '../parseForecast';

const samplePath = process.env.FORECAST_SAMPLE_PATH;
(samplePath ? describe : describe.skip)('real forecast file', () => {
  it('finds 11 full ISO weeks starting 2026-W37 and a peak for H8 MAIN in the first week', () => {
    const preview = parseForecastFile(readFileSync(samplePath!));
    const weeks = groupWeeks(preview.dates);
    expect(weeks).toHaveLength(11);
    expect(weeks[0]).toMatchObject({ key: '2026-W37', start: '2026-09-07', end: '2026-09-13', partial: false });
    const demands = weeklyModelDemand(preview.rows, weeks[0]);
    const h8 = demands.find(d => d.model === 'H8 MAIN')!;
    // Independent check: the peak must equal the max over the week of the summed daily quantities.
    const daily = weeks[0].dates.map(date => preview.rows.filter(r => r.model === 'H8 MAIN').reduce((sum, r) => sum + (r.quantities.find(q => q.date === date)?.quantity ?? 0), 0));
    expect(h8.peakQuantity).toBe(Math.ceil(Math.max(...daily)));
  });
});
```

- [ ] **Step 2: 전체 forecast 테스트 실행(실제 파일 포함)**

```powershell
$env:FORECAST_SAMPLE_PATH='C:/Work Drive/APP/CNC OEE 참조파일/ALMUS TECH FORECAST W39 update B7.xlsx'
node node_modules/jest/bin/jest.js --runInBand src/lib/forecast src/app/api/forecasts src/components/forecast src/utils/__tests__/productionCapacity.test.ts
```
Expected: 전부 PASS

- [ ] **Step 3: 타입·lint·빌드**

```powershell
node node_modules/typescript/bin/tsc --noEmit --incremental false
npm run lint
npm run build
```
Expected: tsc 오류 0, lint 오류 0(기존 경고만), build PASS 에 `/forecast` 포함

- [ ] **Step 4: 브라우저 확인** — `npm run dev` 후 로그인(admin) → `/forecast` → 실제 파일 선택 → 파일 검증 → 카드 확인. 확인 항목:
  1. 주차 Select 에 W37 09-07~09-13 … W47 까지 11개, 기본 W37.
  2. 요약 4개 숫자가 표의 합과 맞는지(필요·현재·부족·변경).
  3. H8 MAIN → H8 M, Diamond3 → DM 3 로 DB 모델이 채워지는지. 미매칭 목록에 Hubble/Beyond 등이 나오는지.
  4. 재배치 표에 설비 번호·현재→변경·사유가 보이고, 운영 적용 버튼이 없는지.
  5. 주차를 바꾸면 숫자가 바뀌는지.
  6. 390px 폭에서 가로 스크롤은 표 내부에서만 생기고 페이지가 넘치지 않는지.
  스크린샷을 `docs/previews/forecast-input/simulation-desktop.png`, `simulation-mobile.png` 로 저장.

- [ ] **Step 5: 상태 문서 갱신** — `docs/FORECAST_IMPLEMENTATION_STATUS.md` 의 "구현 내용" 뒤에 7~9번 항목과 "2026-09-25 검증 결과" 절을 추가한다. 내용: 주별 최대 일수량 기준(사용자 결정), 별칭 2개, 스냅샷 응답, 재배치 검토안 규칙(여유→미배정→수요0, 다음 주 수요 보호, 설비 번호 내림차순), 테스트 수, tsc/lint/build 결과, 브라우저 확인 결과와 스크린샷 경로, 그리고 "호환성·교체시간 미반영, 운영 적용 없음". "다음 구현 순서" 의 2번을 "완료(주별 최대 일수량 기준)" 로 바꾸고 날짜별 가동·휴무 입력은 남은 항목으로 유지한다.

- [ ] **Step 6: 커밋**

```bash
git add src/lib/forecast/__tests__/weeklyDemand.test.ts docs/FORECAST_IMPLEMENTATION_STATUS.md docs/previews/forecast-input/simulation-desktop.png docs/previews/forecast-input/simulation-mobile.png
git commit -m "test(forecast): 실제 파일 주차 대조 + 시뮬레이션 검증 기록"
```

---

## Self-review

- 스펙 2절 스냅샷 → Task 5. 3절 주차·수요 → Task 1. 4절 짝짓기 → Task 2. 5절 필요대수 → Task 3. 6절 재배치 → Task 4. 7절 화면 → Task 6. 8절 테스트 → 각 Task + Task 7. 9절 범위 밖 → 어떤 Task 도 DB 쓰기·확정 버튼을 만들지 않는다.
- Task 3 의 `not_in_forecast` 는 `models` 입력이 필요해 두 번째 코드 블록이 최종 형태다. 실행자는 첫 블록이 아니라 두 번째 블록의 시그니처(`RequirementInput.models`)를 쓴다. Task 6 의 `buildRequirements` 호출도 `models` 를 넘긴다.
- `processRefs` 는 Task 2 에서 `export` 로 바꿔 Task 3 이 재사용한다.
- 주차 라벨은 ISO 주 번호다. 파일명의 "W39" 가 회사 자체 주차 표기라면 ISO 와 다를 수 있으므로 화면에는 반드시 날짜 범위를 함께 보여준다(Task 6 Select 라벨). 브라우저 확인 때 사용자에게 주차 번호 표기가 현장과 맞는지 물어본다.
