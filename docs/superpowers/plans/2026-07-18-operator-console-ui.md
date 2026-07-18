# 통합 입력 콘솔 — Plan 2: 운영자 콘솔 UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **선행:** Plan 1(`2026-07-18-operator-console-foundation.md`)이 구현·검증된 상태를 전제로 한다(close-shift · [recordId]/defect · pending 엔드포인트).

**Goal:** 운영자의 흩어진 3개 입력(상태변경·생산실적·진행보고)을 **설비 선택 → 하나의 콘솔**로 통합한다. 태블릿·작업자·터치. 진척 인라인 입력, andon 비가동(한 동작→두 테이블), 지난교대 마감, 다음날 불량, 마감/불량 배지.

**Architecture:** 현행 `OperatorDashboard`를 진화(레이아웃 A: 왼쪽 목록 + 오른쪽 콘솔). 새 백엔드는 andon 비가동 RPC 하나(`toggle_machine_downtime`: machine_logs + downtime_entries 원자적). 나머지는 Plan 1 엔드포인트를 소비하는 훅·컴포넌트. UI 검증은 이 저장소의 확립된 방식(텍스트 계약 테스트 + 브라우저 E2E, 실시간 기능과 동일)을 따른다.

**Tech Stack:** Next.js 16, React 19, TypeScript strict, Ant Design 5, react-i18next(ko/vi), Jest + Testing Library, Supabase RPC. 마이그레이션 적용·main 병합은 사용자 명시 지시 시에만.

**설계 근거:** `docs/superpowers/specs/2026-07-18-operator-console-unified-input-design.md`

---

## File Structure

- Create `supabase/migrations/20260718000003_toggle_machine_downtime.sql` — andon RPC(비가동 시작/재개 → 두 테이블 원자).
- Create `src/app/__tests__/andonDowntimeMigration.test.ts` — RPC 텍스트 계약.
- Create `src/app/api/machines/[machineId]/downtime/route.ts` — `POST` andon(RPC 호출·매핑).
- Create `src/app/api/machines/[machineId]/downtime/__tests__/route.test.ts`.
- Create `src/hooks/useMachineDowntime.ts` — andon start/resume 클라이언트 훅. + `__tests__`.
- Create `src/hooks/useShiftBacklog.ts` — `GET pending` 소비(마감/불량대기). + `__tests__`.
- Create `src/components/dashboard/operator-console/ProgressInputSection.tsx` — 인라인 진척(현 `ProgressInputModal` 로직을 콘솔 섹션으로).
- Create `src/components/dashboard/operator-console/DowntimeAndonSection.tsx` — 비가동 시작/재개 + 사유 그리드.
- Create `src/components/dashboard/operator-console/CloseShiftSection.tsx` — 지난교대 마감(prefill·close-shift 호출).
- Create `src/components/dashboard/operator-console/DefectPendingSection.tsx` — 다음날 불량 입력([recordId]/defect 호출).
- Create `src/components/dashboard/operator-console/MachineConsole.tsx` — 오른쪽 콘솔 컨테이너(위 섹션 조립 + 실시간 지표).
- Modify `src/components/dashboard/OperatorDashboard.tsx` — 오른쪽 패널을 `MachineConsole`로 교체(레이아웃 A), 배지 배선.
- Modify `src/components/dashboard/__tests__/OperatorDashboard.realtimeProgress.test.ts` — 콘솔 계약 갱신.
- Modify `public/locales/{ko,vi}/machines.json`, `public/locales/{ko,vi}/production.json` — 신규 문구.

각 컴포넌트는 단일 책임(한 입력 종류)이며 독립 테스트 가능하다.

---

## Task 1: andon 비가동 RPC 마이그레이션

**동작:** 한 동작이 machine_logs(상태 구간)와 downtime_entries(비가동 구간)를 함께 기록.
- `start(reason)`: 열린 NORMAL 로그 종료 → 비정상 로그(state=reason) 시작 → downtime_entry(start=now, end=null, reason) 삽입 → machines.current_state=reason.
- `resume`: 열린 비정상 로그 종료 → NORMAL 로그 시작 → 열린 downtime_entry 종료(end=now) → machines.current_state=NORMAL_OPERATION.
- advisory lock(설비별)로 원자화(중복 open 방지 — F1 교훈).

**Files:**
- Create: `supabase/migrations/20260718000003_toggle_machine_downtime.sql`
- Test: `src/app/__tests__/andonDowntimeMigration.test.ts`

- [ ] **Step 1: 실패 테스트 작성 (텍스트 계약)**

```typescript
// src/app/__tests__/andonDowntimeMigration.test.ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/20260718000003_toggle_machine_downtime.sql'), 'utf8');

describe('toggle_machine_downtime RPC 계약', () => {
  it('설비별 advisory lock 으로 직렬화', () => expect(sql).toMatch(/pg_advisory_xact_lock/));
  it('machine_logs 와 downtime_entries 를 함께 기록', () => {
    expect(sql).toMatch(/machine_logs/i);
    expect(sql).toMatch(/downtime_entries/i);
  });
  it("start 와 resume 두 동작을 분기", () => {
    expect(sql).toMatch(/'start'/);
    expect(sql).toMatch(/'resume'/);
  });
  it('service_role 에만 EXECUTE', () => {
    expect(sql).toMatch(/grant\s+execute[\s\S]*to\s+service_role/i);
    expect(sql).toMatch(/revoke\s+all[\s\S]*anon,\s*authenticated/i);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/app/__tests__/andonDowntimeMigration.test.ts`
Expected: FAIL — 파일 없음.

- [ ] **Step 3: 마이그레이션 작성** — 구현 전 `machine_logs`/`downtime_entries`/`machines` 실제 컬럼(state enum 값, log_id, current_state 등)을 확인해 맞춘다.

```sql
-- andon 비가동: 한 동작이 machine_logs(상태 구간) + downtime_entries(비가동 구간)를 함께 기록.
-- 두 소스는 OEE 계산이 유니온으로 한 번만 센다(calculateVerifiedDowntimeMinutesForWindow).
-- 설비별 advisory lock 으로 중복 open 을 막는다.
create or replace function public.toggle_machine_downtime(
  p_machine_id uuid,
  p_action text,           -- 'start' | 'resume'
  p_reason text,           -- start 시 비정상 상태값(INSPECTION 등). resume 시 무시.
  p_operator_id uuid
) returns jsonb language plpgsql as $$
declare now_ts timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));

  if p_action = 'start' then
    update public.machine_logs set end_time = now_ts
      where machine_id = p_machine_id and end_time is null;
    insert into public.machine_logs(machine_id, state, start_time)
      values (p_machine_id, p_reason, now_ts);
    insert into public.downtime_entries(machine_id, start_time, reason)
      values (p_machine_id, now_ts, p_reason);
    update public.machines set current_state = p_reason where id = p_machine_id;
    return jsonb_build_object('ok', true, 'state', p_reason);

  elsif p_action = 'resume' then
    update public.machine_logs set end_time = now_ts
      where machine_id = p_machine_id and end_time is null;
    insert into public.machine_logs(machine_id, state, start_time)
      values (p_machine_id, 'NORMAL_OPERATION', now_ts);
    update public.downtime_entries set end_time = now_ts
      where machine_id = p_machine_id and end_time is null;
    update public.machines set current_state = 'NORMAL_OPERATION' where id = p_machine_id;
    return jsonb_build_object('ok', true, 'state', 'NORMAL_OPERATION');
  end if;

  return jsonb_build_object('ok', false, 'reason', 'invalid_action');
end; $$;

revoke all on function public.toggle_machine_downtime(uuid, text, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.toggle_machine_downtime(uuid, text, text, uuid) to service_role;
```

> **주의:** `machine_logs` 의 실제 컬럼(예: `log_id` PK 기본값, `change_reason`, `duration_minutes` 등 NOT NULL)과 `downtime_entries` 의 NOT NULL 컬럼(`date`/`shift`/`is_planned` 등)을 스키마로 확인해 INSERT 를 맞춘다. `downtime_entries` 가 date/shift 를 요구하면 `getShiftAt`/`getBusinessDateAt` 로 채운다(서버 라우트에서 계산해 RPC 인자로 넘기는 방식도 가능). state enum 제약이 있으면 p_reason 검증을 추가.

- [ ] **Step 4: 통과 확인**

Run: `npx jest src/app/__tests__/andonDowntimeMigration.test.ts`
Expected: PASS — 4 tests.

- [ ] **Step 5: 커밋** (적용 보류)

```bash
git add supabase/migrations/20260718000003_toggle_machine_downtime.sql src/app/__tests__/andonDowntimeMigration.test.ts
git commit -m "feat(andon): 비가동 시작/재개 RPC(machine_logs+downtime_entries 원자) + 계약 테스트"
```

---

## Task 2: andon 엔드포인트 (`POST /api/machines/[machineId]/downtime`)

**Files:**
- Create: `src/app/api/machines/[machineId]/downtime/route.ts`
- Test: `src/app/api/machines/[machineId]/downtime/__tests__/route.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/app/api/machines/[machineId]/downtime/__tests__/route.test.ts
jest.mock('next/server', () => ({
  NextResponse: { json: (b: unknown, i?: { status?: number }) => ({ status: i?.status ?? 200, json: async () => b }) },
}));
const mockRequireUser = jest.fn();
const mockAssert = jest.fn();
const mockRpc = jest.fn();
jest.mock('@/lib/apiAuth', () => ({
  requireUser: (...a: unknown[]) => mockRequireUser(...a),
  assertMachineAccess: (...a: unknown[]) => mockAssert(...a),
  apiAuthErrorResponse: () => null,
}));
jest.mock('@/lib/supabase-admin', () => ({ supabaseAdmin: { rpc: (...a: unknown[]) => mockRpc(...a) } }));
import { POST } from '../route';
const MACHINE = '11111111-1111-4111-8111-111111111111';
const req = (b: unknown) => ({ json: async () => b }) as never;
const ctx = { params: Promise.resolve({ machineId: MACHINE }) } as never;

describe('POST .../[machineId]/downtime', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRequireUser.mockResolvedValue({ userId: 'op-1', role: 'operator', assignedMachineIds: [MACHINE] });
    mockAssert.mockReturnValue(undefined);
    mockRpc.mockResolvedValue({ data: { ok: true, state: 'INSPECTION' }, error: null });
  });

  it('start + reason 을 RPC 로 전달', async () => {
    const res = await POST(req({ action: 'start', reason: 'INSPECTION' }), ctx);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('toggle_machine_downtime', expect.objectContaining({
      p_machine_id: MACHINE, p_action: 'start', p_reason: 'INSPECTION', p_operator_id: 'op-1',
    }));
  });

  it('resume 를 RPC 로 전달', async () => {
    mockRpc.mockResolvedValue({ data: { ok: true, state: 'NORMAL_OPERATION' }, error: null });
    const res = await POST(req({ action: 'resume' }), ctx);
    expect(res.status).toBe(200);
    expect(mockRpc).toHaveBeenCalledWith('toggle_machine_downtime', expect.objectContaining({ p_action: 'resume' }));
  });

  it('잘못된 action 은 400 (RPC 호출 안 함)', async () => {
    const res = await POST(req({ action: 'bogus' }), ctx);
    expect(res.status).toBe(400);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('담당이 아닌 설비는 거부', async () => {
    mockAssert.mockImplementation(() => { throw new Error('forbidden'); });
    await expect(POST(req({ action: 'resume' }), ctx)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx jest src/app/api/machines/[machineId]/downtime`
Expected: FAIL — 라우트 없음.

- [ ] **Step 3: 구현**

```typescript
// src/app/api/machines/[machineId]/downtime/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { apiAuthErrorResponse, assertMachineAccess, requireUser } from '@/lib/apiAuth';

export const dynamic = 'force-dynamic';

/** POST /api/machines/[machineId]/downtime — andon 한 동작(start+reason / resume). */
export async function POST(request: NextRequest, ctx: { params: Promise<{ machineId: string }> }) {
  try {
    const user = await requireUser(request, ['admin', 'engineer', 'operator']);
    const { machineId } = await ctx.params;
    const body = await request.json() as { action?: unknown; reason?: unknown };
    const action = body.action === 'start' || body.action === 'resume' ? body.action : null;
    const reason = typeof body.reason === 'string' ? body.reason : '';
    if (action === null) return NextResponse.json({ error: "action must be 'start' or 'resume'" }, { status: 400 });
    if (action === 'start' && reason.length === 0)
      return NextResponse.json({ error: 'reason is required for start' }, { status: 400 });

    assertMachineAccess(user, machineId);

    const { data, error } = await supabaseAdmin.rpc('toggle_machine_downtime', {
      p_machine_id: machineId, p_action: action, p_reason: reason, p_operator_id: user.userId,
    });
    if (error) {
      console.error('andon 오류:', error);
      return NextResponse.json({ error: 'Failed to toggle downtime' }, { status: 500 });
    }
    const r = data as { ok: boolean; state?: string; reason?: string };
    if (!r.ok) return NextResponse.json({ error: r.reason ?? 'failed' }, { status: 400 });
    return NextResponse.json({ success: true, state: r.state }, { status: 200 });
  } catch (error) {
    const authResponse = apiAuthErrorResponse(error);
    if (authResponse) return authResponse;
    throw error;
  }
}
```

- [ ] **Step 4: 통과 확인 + 커밋**

Run: `npx jest src/app/api/machines/[machineId]/downtime`
Expected: PASS — 4 tests.

```bash
git add "src/app/api/machines/[machineId]/downtime/"
git commit -m "feat(andon): 비가동 시작/재개 엔드포인트(RPC 래퍼)"
```

---

## Task 3: `useMachineDowntime` 훅 (andon 클라이언트)

**Files:**
- Create: `src/hooks/useMachineDowntime.ts`
- Test: `src/hooks/__tests__/useMachineDowntime.test.tsx`

- [ ] **Step 1: 실패 테스트 작성**

```typescript
// src/hooks/__tests__/useMachineDowntime.test.tsx
import { renderHook, act } from '@testing-library/react';
import { useMachineDowntime } from '../useMachineDowntime';
const mockAuthFetch = jest.fn();
jest.mock('@/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => mockAuthFetch(...a) }));

describe('useMachineDowntime', () => {
  beforeEach(() => { jest.clearAllMocks(); mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({ success: true, state: 'INSPECTION' }) }); });

  it('start(reason) 는 action=start·reason 을 POST 한다', async () => {
    const onDone = jest.fn();
    const { result } = renderHook(() => useMachineDowntime('m1', onDone));
    await act(async () => { await result.current.start('INSPECTION'); });
    const [url, init] = mockAuthFetch.mock.calls[0];
    expect(String(url)).toContain('/api/machines/m1/downtime');
    expect(JSON.parse((init as { body: string }).body)).toEqual({ action: 'start', reason: 'INSPECTION' });
    expect(onDone).toHaveBeenCalled();
  });

  it('resume 는 action=resume 을 POST 한다', async () => {
    const { result } = renderHook(() => useMachineDowntime('m1', jest.fn()));
    await act(async () => { await result.current.resume(); });
    expect(JSON.parse((mockAuthFetch.mock.calls[0][1] as { body: string }).body)).toEqual({ action: 'resume' });
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 → 커밋**

```typescript
// src/hooks/useMachineDowntime.ts
'use client';
import { useCallback, useState } from 'react';
import { authFetch } from '@/lib/authFetch';

export function useMachineDowntime(machineId: string, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const post = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true); setError(null);
    try {
      const res = await authFetch(`/api/machines/${machineId}/downtime`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) { setError('failed'); return; }
      onDone();
    } catch { setError('failed'); } finally { setBusy(false); }
  }, [machineId, onDone]);
  return {
    busy, error,
    start: (reason: string) => post({ action: 'start', reason }),
    resume: () => post({ action: 'resume' }),
  };
}
```

Run: `npx jest src/hooks/__tests__/useMachineDowntime.test.tsx` → PASS.
```bash
git add src/hooks/useMachineDowntime.ts src/hooks/__tests__/useMachineDowntime.test.tsx
git commit -m "feat(andon): useMachineDowntime 훅"
```

---

## Task 4: `useShiftBacklog` 훅 (마감/불량 백로그)

**Files:**
- Create: `src/hooks/useShiftBacklog.ts`
- Test: `src/hooks/__tests__/useShiftBacklog.test.tsx`

- [ ] **Step 1: 실패 테스트 작성** — GET pending 을 소비해 `closePending`/`defectPending` 노출, `refresh` 제공. 인자(machineId) 변경 시 초기화(useRealtimeProgress 패턴 재사용).

```typescript
// src/hooks/__tests__/useShiftBacklog.test.tsx
import { renderHook, waitFor } from '@testing-library/react';
import { useShiftBacklog } from '../useShiftBacklog';
const mockAuthFetch = jest.fn();
jest.mock('@/lib/authFetch', () => ({ authFetch: (...a: unknown[]) => mockAuthFetch(...a) }));

describe('useShiftBacklog', () => {
  it('pending 을 closePending/defectPending 으로 노출한다', async () => {
    mockAuthFetch.mockResolvedValue({ ok: true, json: async () => ({
      close_pending: [{ date: '2026-07-17', shift: 'B' }],
      defect_pending: [{ date: '2026-07-17', shift: 'A', record_id: 'rA' }],
    }) });
    const { result } = renderHook(() => useShiftBacklog('m1'));
    await waitFor(() => expect(result.current.closePending).toHaveLength(1));
    expect(result.current.defectPending[0].record_id).toBe('rA');
  });

  it('machineId 없으면 조회 안 함', () => {
    renderHook(() => useShiftBacklog(null));
    expect(mockAuthFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: 실패 확인 → 구현 → 통과 → 커밋** — `useRealtimeProgress`의 reqRef·언마운트·인자변경 초기화 패턴을 따른다.

```typescript
// src/hooks/useShiftBacklog.ts
'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '@/lib/authFetch';

interface ShiftKey { date: string; shift: 'A' | 'B'; }
interface DefectItem extends ShiftKey { record_id: string; }

export function useShiftBacklog(machineId: string | null) {
  const [closePending, setClosePending] = useState<ShiftKey[]>([]);
  const [defectPending, setDefectPending] = useState<DefectItem[]>([]);
  const reqRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!machineId) return;
    const reqId = ++reqRef.current;
    try {
      const res = await authFetch(`/api/production-records/pending?machine_id=${machineId}`, { cache: 'no-store' });
      if (reqId !== reqRef.current || !res.ok) return;
      const body = await res.json() as { close_pending: ShiftKey[]; defect_pending: DefectItem[] };
      if (reqId !== reqRef.current) return;
      setClosePending(body.close_pending ?? []);
      setDefectPending(body.defect_pending ?? []);
    } catch { if (reqId === reqRef.current) { setClosePending([]); setDefectPending([]); } }
  }, [machineId]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setClosePending([]); setDefectPending([]); }, [machineId]);
  useEffect(() => () => { reqRef.current++; }, []);

  return { closePending, defectPending, refresh };
}
```

Run: `npx jest src/hooks/__tests__/useShiftBacklog.test.tsx` → PASS.
```bash
git add src/hooks/useShiftBacklog.ts src/hooks/__tests__/useShiftBacklog.test.tsx
git commit -m "feat(console): useShiftBacklog 훅(마감/불량 백로그)"
```

---

## Task 5: 콘솔 섹션 컴포넌트 — 진척 인라인 · andon · 마감 · 불량

각 컴포넌트는 단일 책임이며, 로직(무엇을 POST 하는가)을 계약 테스트로 고정한다. 시각·상호작용의 최종 증명은 Task 8 브라우저 E2E.

**Files:**
- Create: `src/components/dashboard/operator-console/ProgressInputSection.tsx` (+ test)
- Create: `src/components/dashboard/operator-console/DowntimeAndonSection.tsx` (+ test)
- Create: `src/components/dashboard/operator-console/CloseShiftSection.tsx` (+ test)
- Create: `src/components/dashboard/operator-console/DefectPendingSection.tsx` (+ test)

### 5a. ProgressInputSection (인라인 진척)
현 `ProgressInputModal`의 저장 로직(값·409 감소·machine_in_downtime 처리)을 **모달이 아닌 인라인 섹션**으로 옮긴다. props: `{ machineId, date, shift, lastReportedQty, downtimeSince, onSaved }`. 비가동 중이면 입력 잠금(기존 규율 유지). 저장은 `POST /api/production-progress`(기존 RPC).

- [ ] 실패 테스트: 저장 시 body 가 `{machine_id,date,shift,shift_output_qty}` 이고, 409 감소/machine_in_downtime 메시지 분기가 유지되는지(기존 `ProgressInputModal.test.tsx` 케이스를 인라인 버전으로 이식). → 구현(모달 셸만 제거, 로직 재사용) → 통과 → 커밋.

### 5b. DowntimeAndonSection (비가동 andon)
props: `{ machineId, currentState, onChanged }`. 정상이면 "■ 비가동 시작"→사유 그리드(비정상 상태 목록: INSPECTION/BREAKDOWN_REPAIR/PM_MAINTENANCE/MODEL_CHANGE/PLANNED_STOP/PROGRAM_CHANGE/TOOL_CHANGE/TEMPORARY_STOP), 비가동이면 "▶ 가동 재개"+현재 사유. `useMachineDowntime` 사용.

- [ ] 실패 테스트: 사유 선택 시 `start(reason)` 호출, 비가동 상태에서 재개 시 `resume()` 호출(useMachineDowntime 모킹). → 구현 → 통과 → 커밋.

### 5c. CloseShiftSection (지난교대 마감)
props: `{ machineId, pendingShift: {date,shift} | null, prefillQty: number | null, onClosed }`. `pendingShift` 있을 때만 렌더. 입력칸 prefill(prefillQty), "마감" → `POST /api/production-records/close-shift` with `{machine_id,date,shift,final_qty}`.

- [ ] 실패 테스트: 마감 클릭 시 close-shift 로 `{machine_id, date, shift, final_qty}`(prefill 편집값) POST, 성공 시 onClosed. pendingShift null 이면 아무것도 안 그림. → 구현 → 통과 → 커밋.

### 5d. DefectPendingSection (다음날 불량)
props: `{ recordId, shiftKey: {date,shift}, onConfirmed }`. 불량 입력 → `PATCH /api/production-records/[recordId]/defect` with `{defect_qty}`. 불량>생산 등은 400 을 메시지로.

- [ ] 실패 테스트: 확정 클릭 시 `.../[recordId]/defect` PATCH `{defect_qty}`, 성공 시 onConfirmed. → 구현 → 통과 → 커밋.

---

## Task 6: `MachineConsole` 조립 + OperatorDashboard 배선(레이아웃 A)

**Files:**
- Create: `src/components/dashboard/operator-console/MachineConsole.tsx`
- Modify: `src/components/dashboard/OperatorDashboard.tsx`
- Modify: `src/components/dashboard/__tests__/OperatorDashboard.realtimeProgress.test.ts`

- [ ] **Step 1: `MachineConsole` 작성** — 선택 설비의 콘솔. 위→아래: 실시간 지표(기존 realtime 카드 이식) · `ProgressInputSection` · `DowntimeAndonSection` · `CloseShiftSection`(closePending[0]) · `DefectPendingSection`(defectPending[0]). 데이터: `useRealtimeProgress`(기존) + `useShiftBacklog`(Task 4). props: `{ machineId, machineRow, date, shift }`.

- [ ] **Step 2: `OperatorDashboard` 오른쪽 패널을 `MachineConsole` 로 교체** — 기존 OEE 탭/진행보고 모달 트리거·상태변경/생산실적 버튼을 콘솔이 대체(중복 제거). 왼쪽 목록 그리드는 유지(선택+상태·진척 미리보기). 목록/헤더에 마감·불량 대기 **배지**(useShiftBacklog 카운트).

- [ ] **Step 3: 계약 테스트 갱신** — `OperatorDashboard.realtimeProgress.test.ts` 에:
```typescript
it('콘솔을 배선한다 (진척 인라인·andon·마감·불량 섹션)', () => {
  expect(source).toMatch(/MachineConsole/);
});
```
그리고 기존 진행보고 모달 트리거가 콘솔로 이동했음을(모달 전용 배선 제거) 반영해 깨진 계약을 갱신.

- [ ] **Step 4: tsc + 전체 스위트 + lint**

Run: `npx tsc --noEmit --incremental false && npx jest --runInBand 2>&1 | grep -E "^Tests:|FAIL" && npx eslint src/components/dashboard/OperatorDashboard.tsx src/components/dashboard/operator-console/`
Expected: tsc 클린, 전부 PASS, lint 0.

- [ ] **Step 5: 커밋**

```bash
git add src/components/dashboard/operator-console/ src/components/dashboard/OperatorDashboard.tsx src/components/dashboard/__tests__/OperatorDashboard.realtimeProgress.test.ts
git commit -m "feat(console): 운영자 콘솔 조립(레이아웃 A) — 진척·andon·마감·불량·배지"
```

---

## Task 7: i18n (ko/vi)

**Files:** Modify `public/locales/{ko,vi}/machines.json`, `public/locales/{ko,vi}/production.json`

- [ ] 신규 문구 키를 ko/vi 동시에 추가(같은 키 구조): andon 사유 라벨(상태값별), "비가동 시작/가동 재개", "지난 교대 마감/최종 생산 수량", "불량 입력/확정", 배지("마감 대기 N/불량 대기 N"). 하드코딩 문구 금지, 기존 `machines`/`production` 네임스페이스 재사용.
- [ ] **검증:** ko/vi 키 집합이 동일한지 확인(누락 키 없음). 커밋.

```bash
git add public/locales/ko/machines.json public/locales/vi/machines.json public/locales/ko/production.json public/locales/vi/production.json
git commit -m "i18n(console): 통합 콘솔 문구(ko/vi)"
```

---

## Task 8: 브라우저 E2E 검증 (실물 증명)

> 마이그레이션(Plan 1 Task 1, Plan 2 Task 1)은 사용자 명시 지시로 **적용된 상태**여야 함. 실시간 기능 검증과 동일한 방식(Claude in Chrome + 데이터 원복).

- [ ] `/operator-view` → 설비 선택 → 콘솔 한 화면 확인.
- [ ] **진척**: 인라인 저장 → 실시간 지표 갱신. 감소 → 안내. 비가동 중 → 잠금.
- [ ] **andon**: "비가동 시작"→사유 → 설비 상태·목록 배지 변화, GET availability 에 반영(두 소스 유니온). "가동 재개" → 복귀.
- [ ] **마감**: (진척 넣어둔 뒤) 교대 마감 → `production_records` output 확정·defect NULL 확인(SQL). 늦은 귀속(다음 교대 시계에서 지난 교대 마감) 확인.
- [ ] **불량대기**: 마감된 교대에 불량 입력 → quality·oee 확정(SQL).
- [ ] **배지**: 마감/불량 대기 카운트가 백로그와 일치.
- [ ] **정리:** 테스트로 만든 progress/records/downtime/machine_logs 행을 SQL 로 원복(실시간 검증 때와 동일 원칙). 설비 상태 원복.
- [ ] 결과를 커밋 메시지·메모리에 기록.

---

## Self-Review (작성자 체크)

- **Spec 커버리지:** §4.1 레이아웃 A(Task 6), §4.2 콘솔 섹션(Task 5·6), §4.5 andon(Task 1·2·3·5b), §4.4 늦은 마감·귀속(Task 5c + Plan 1 close-shift), §4.3 라이프사이클 배지(Task 4·6), 불량 확정(Task 5d + Plan 1), i18n(Task 7). 브라우저 증명(Task 8).
- **미해결(구현 시 확인):** ① `machine_logs`/`downtime_entries`/`machines` 실제 컬럼·enum(Task 1 INSERT). ② `downtime_entries` 가 date/shift/is_planned 를 요구하면 라우트에서 계산해 RPC 인자로 넘길지 결정. ③ 진행보고 모달(`ProgressInputModal`) 제거 vs 유지(인라인으로 대체 시 기존 테스트 이관). ④ 기존 상태변경 경로(`/api/machines/[machineId]` PATCH)와 andon 의 공존/대체 정리.
- **적용 게이트:** 두 마이그레이션 적용·main 병합은 명시적 지시 시에만.

---

## 전체 실행 순서 요약

Plan 1(데이터/API) → Plan 2(콘솔 UI). 각 태스크 TDD·빈번 커밋. 마이그레이션 3개(defect nullable · andon RPC, + Plan 1 없음)와 close-shift/defect/pending·andon 엔드포인트가 기반, 그 위에 콘솔 컴포넌트. 데이터입력 페이지는 관리자 백필로 존치. 실시간 기능·OEE 규율·확정 스냅샷은 유지.
