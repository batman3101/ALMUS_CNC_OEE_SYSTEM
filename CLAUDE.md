# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CNC OEE Monitoring System - A real-time web application for monitoring and managing Overall Equipment Effectiveness (OEE) of CNC machines. Built with Next.js 16, React 19, TypeScript, Ant Design, and Supabase.

## Development Commands

### Development

#### ⚠️ `supabase/config.toml` 의 `major_version` 은 **운영과 같아야 한다** (17)

운영 DB 는 Postgres **17.6** 이다. `config.toml` 이 15 로 적혀 있던 동안
`supabase db dump`/`db diff` 가 운영에 대해 아예 동작하지 않았다:

```
pg_dump: error: aborting because of server version mismatch
pg_dump: detail: server version: 17.6; pg_dump version: 15.8
```

CLI 는 이 값으로 pg_dump/psql 컨테이너 이미지를 고른다. 그래서 이 값이 틀리면 **운영
스키마·데이터를 뜰 수 없고**, 그 사실은 덤프를 시도할 때까지 드러나지 않는다.
2026-08-24 에 17 로 올렸다.

**로컬 스택은 재초기화가 필요하다.** 기존 볼륨은 15 로 만들어져 있어 17 로는 열리지 않는다:

```bash
npx supabase stop --no-backup   # 로컬 데이터가 사라진다 (개발용 픽스처뿐이다)
npx supabase start
```

#### ⚠️ dev 는 Turbopack, build 는 webpack — 섞인 것이 아니라 각각 검증된 조합이다

Next.js **16.3.0 의 webpack dev 경로는 이 앱에서 깨진다.** 화면이 통째로 뜨지 않고
런타임 오류만 남는다:

```
InvariantError: Instant validation boundaries should never appear in browser bundles.
This is a bug in Next.js.
```

`next build --webpack` 은 정상이고 프로덕션도 정상이다 — **dev 전용 문제**다.
그래서 dev 만 Turbopack 으로 옮기고 build 는 검증된 webpack 을 유지한다.

**이 조합을 되돌리기 전에 브라우저에서 화면이 뜨는지 먼저 확인할 것.** 타입 검사·lint·
테스트·프로덕션 빌드가 **전부 통과하는데도** dev 화면만 죽기 때문에, 자동 검증만으로는
이 회귀가 보이지 않는다(2026-08-06 에 실제로 그렇게 놓칠 뻔했다).

## Key Architectural Patterns

### Authentication & Authorization
- **Supabase Auth** with JWT tokens stored in browser cookies
- **Row Level Security (RLS)** enforces database-level permissions
- **Three User Roles**:
  - `admin`: Full system access (all CRUD operations, system settings, user management)
  - `engineer`: All machines and analytics, **plus production-data writes** (production
    records, shift close, defect confirm, progress reports, downtime/andon) — confirmed as
    intended policy 2026-07-20. Destructive ops (record DELETE, settings, user mgmt) stay
    admin-only.
  - `operator`: Access only to assigned machines (via `assigned_machines` array field in `user_profiles`)
- **AuthContext** (`src/contexts/AuthContext.tsx`): Manages authentication state with automatic session recovery and cleanup on unmount to prevent memory leaks
- **Profile Fetching Strategy**: Attempts Service Role API first (admin endpoint), falls back to client-side query if RLS blocks it
- **Role Guards**:
  - `RoleGuard` component restricts UI elements by role
  - `ProtectedRoute` component protects entire pages
  - `withAuth` HOC for component-level protection

### Role-Based Dashboard Routing
The dashboard adapts based on user role via `DashboardRouter` component:
- **Admin Dashboard** (`AdminDashboard.tsx`): Full system overview, all machines, alerts, user management access
- **Engineer Dashboard** (`EngineerDashboard.tsx`): All machines with analytics, trends, quality metrics (read-only)
- **Operator Dashboard** (`OperatorDashboard.tsx`): Only assigned machines with production input forms
- Router automatically selects dashboard based on `user.role` from AuthContext
- Navigation sidebar adapts menu items based on role permissions

### Real-time Data Synchronization
- **Hybrid Approach**: Supabase Realtime subscriptions + polling fallback
- **useRealtimeData Hook** (`src/hooks/useRealtimeData.ts`): Subscribes to `machines`, `machine_logs`, and `production_records` tables
- **Auto-reconnection**: Retries connection every 5 seconds on failure
- **Heartbeat System**: 30-second interval connection health checks
- **Cleanup on Unmount**: All subscriptions are properly unsubscribed to prevent memory leaks

### OEE Calculation System
- **OEECalculator Class** (`src/utils/oeeCalculator.ts`): Core calculation logic
  - `Availability` = Actual Runtime / Planned Runtime
  - `Performance` = Ideal Runtime / Actual Runtime
  - `Quality` = Good Qty / Total Output Qty
  - `OEE` = Availability × Performance × Quality (internal values are all 0..1)
- **RealTimeOEECalculator**: Calculates OEE from machine logs in real-time
- **OEECache**: 5-minute in-memory cache for calculated OEE metrics
- **Shift Logic**: Supports 12-hour shifts (A: 08:00-20:00, B: 20:00-08:00)

#### ⚠️ `tact_time_seconds` is PER-PIECE. Never divide by `cavity_count`.

`model_processes.tact_time_seconds` is the time to produce **one piece**, not one cycle.
A JIG holding 2 cavities yields 2 pieces per cycle, and **that is already baked into the
per-piece value** (cycle 1,152s ÷ 2 cavities = 576s per piece).

```
ideal_runtime = output_qty × tact_time_seconds / 60
CAPA          = planned_runtime / (tact_time_seconds / 60)
```

`cavity_count` is **reference-only** — cycle-count conversion (`output_qty / cavity`) and
JIG configuration record. Using it in OEE/CAPA math double-counts and skews performance to
exactly `1/cavity` (48.8% at cavity=2, 24.5% at cavity=4). This shipped as a real bug on
2026-07-16 and hit every machine.

**Five write paths compute this — change them together:**
`api/production-records/oeeRules.ts`, `api/production-records/route.ts`,
`api/production-records/daily/route.ts`, `api/production-records/[recordId]/route.ts`,
`components/data-input/ShiftDataInputForm.tsx`.
`src/app/api/production-records/__tests__/perPieceTactContract.test.ts` pins all of them.

#### ⚠️ No downtime entry means no downtime

Operators log downtime **only when it happens**; they never confirm that nothing broke.
`resolveConfirmedDowntimeMinutes(measured)` → `measured > 0 ? measured : 0`.

But `measured === null` (the downtime **query failed**) stays `NULL`. "Queried, found 0"
and "couldn't query" are different kinds of unknown — asserting 0 for the latter fabricates
data.

#### ⚠️ A NULL metric is not 0%

`NULL` means "not computable", not "0%". Coercing it (`oee || 0`) makes a healthy machine
look dead — it rendered 396 rows as a red 0.0%. Type nullable metrics as `number | null`,
never `number?`; the optional type cannot express "unknown" and is what enabled the bug.

#### Units and shift boundaries
- Time fields (`planned_runtime`, `actual_runtime`, `ideal_runtime`) are **minutes**; tact time is **seconds**.
- `planned_runtime` = `max(0, operating_minutes − break_minutes)`; break comes from `system_settings(category='shift')`. See `src/lib/plannedRuntime.ts`.
- **B shift crosses midnight.** Verify both shifts when touching date ranges, daily aggregation, or timezone logic.

#### Snapshot preservation
`production_records` stores `tact_time_seconds`, `cavity_count`, `ideal_runtime`,
`performance`, and `oee` as **save-time snapshots**, so a later process change cannot
rewrite a past shift's history. Consequence: **fixing calculation logic does not change
existing rows** — they need an explicit recompute.

### State Management
- **Context Providers** wrap the app in `src/app/providers.tsx` and `src/app/layout.tsx`:
  - `AntdConfigProvider`: Ant Design theme configuration (dark/light mode)
  - `ThemeProvider`: Custom theme state management
  - `AuthProvider`: User authentication and session management
  - `LanguageProvider`: i18n language switching (Korean/Vietnamese)
  - `NotificationProvider`: Real-time notifications and alerts
  - `SystemSettingsProvider`: Global settings (shift times, break times, OEE thresholds)
- **Provider Order** (actual, from `src/app/providers.tsx`): ConfigProvider → I18nextProvider → AuthProvider → SystemSettingsProvider → UserPreferencesProvider → LanguageProvider → DateRangeProvider → ThemeProvider → AntdConfigProvider → ToastNotificationProvider → NotificationProvider
  - Inner providers consume outer contexts — verify dependencies before reordering.
- **Local State**: Use `useState` for component-specific state
- **Server State**: Fetched via Supabase queries, cached in React Query-like patterns

### Database Schema Key Tables
- `machines`: CNC machine master data (name, model, status, location, tact_time)
- `machine_logs`: Time-series state changes (NORMAL_OPERATION, ERROR, MAINTENANCE, etc.)
- `production_records`: Production output, defects, and timestamps per shift
- `user_profiles`: User info with role and assigned_machines (array of machine IDs)
- `system_settings`: Global configuration (shift_start_time, break_duration, oee_thresholds, etc.)
- `product_models`: Product model definitions
- `model_processes`: Process steps per model — holds `tact_time_seconds` (**per piece**) and `cavity_count` (**reference-only**)
- `production_shift_states`: Persistent schedule/entry state. `MISSING` is distinct from `OFF`/`HOLIDAY` and from a `WORKING` production record.
- `downtime_entries`: Downtime logged independently, before production entry
- `machine_status_history`, `machine_status_descriptions`: Status change history and labels
- `alert_acknowledgements`: Alert keys acknowledged/dismissed per admin/engineer
- `system_settings_audit`, `audit_log`: Change history

Verified against the live DB on 2026-07-16. **There is no `notifications` table and no
`oee_aggregation_log` table** despite earlier docs claiming both — confirm table existence
before writing queries against it.

### API Routes Structure (src/app/api/)
Routes are organized by feature and follow RESTful conventions:
- **oee-data/**: OEE metrics queries
  - Returns raw `production_records` rows, so it is **paginated**: `limit` (default 1000, max 5000) + `offset`, with a `pagination` block (`total`, `returned`, `has_more`) in the response.
  - `statistics` is computed in SQL over the **entire** filtered set (`analytics_oee_records_summary` RPC), not over the returned page. Never average the returned rows — a yearly query matches far more rows than one page holds, and you will only ever hold a page of them.
  - `aggregated/` - Aggregated OEE data (rolled up server-side; use this when you want trends, not rows)

API Route Patterns:
- **Client-side**: Use `supabase` client from `src/lib/supabase.ts`
- **Server-side**: Import Service Role client from `src/lib/supabase-admin.ts` for admin operations
- **Request cache control**: Proxy adds development cache headers to non-API routes (see `src/proxy.ts`)
- **RLS Bypass**: Service Role Key bypasses RLS for admin operations in API routes

#### ⚠️ PostgREST silently truncates large queries
PostgREST enforces a `max-rows` cap (**100,000** on this project). A `select()` without `.limit()` that matches more rows returns exactly 100,000 of them **with a 200 status and no warning** — the response looks complete.

**Current headroom (measured 2026-08-28):** `production_records` holds **61,894 rows** (30 MB)
and grows **~1,450 rows/day** — that is the mean of the last 14 days; the all-time mean is
1,289/day and the busiest single day was 1,595. Data starts 2026-07-11 (48 days, 800 machines ×
2 shifts). That leaves roughly **26 days**, i.e. **around 2026-09-22**, before an unbounded query
over the whole table starts truncating silently.

**The `factory_id` filter buys no headroom today.** Every API query scopes by factory, but ALV is
still empty — ALT's 61,894 rows *are* the whole table. Multi-factory does not push that date out
until ALV actually carries data.

Do not read that as "we have time". Read it as: the cap is a date, not a hypothetical, and the
failure when it arrives is invisible. Also, *filtered* queries hit it far earlier than the table
total suggests — any query whose predicate matches more than 100,000 rows truncates, and a
multi-year range over this table will.

> **Re-measure before citing a row count as a reason.** This line has been wrong twice now, in
> opposite directions.
>
> An early revision claimed ~325k rows — wrong by 10×, and it caused a real misjudgement: the
> 2026-08-04 audit rated a pagination defect HIGH on the premise that deep pages already returned
> empty, which they did not.
>
> The replacement figure (32,736) was *correct when written* and still went stale fast: the table
> had grown **89% past it 24 days later**. A number that moves ~1,450/day is unusable once it is
> more than about a week old. Count it, don't quote it.
>
> The **100,000** cap itself was not re-verified on 2026-08-28. It is PostgREST-side config and is
> not readable over SQL — `pg_roles.rolconfig` carries only the statement/lock timeouts.

Two rules follow:
1. **Never aggregate in Node over an unbounded query.** To average the table you must first
   transfer it, which re-triggers the cap — so the average is computed on a slice and reported as
   if it covered everything. Aggregate in SQL instead (see the `analytics_*` RPCs in
   `supabase/migrations/`), which returns the statistic without transferring the rows.
2. **If you return raw rows, paginate explicitly** and expose `total` / `has_more` so callers can *see* the boundary. An invisible cap is a correctness bug; a visible one is just a page.

### Error Handling & Logging
- **Type-safe Errors**: Use `ErrorCodes` enum from `types/index.ts` for consistent error classification
- **Supabase Operations**: Wrapped in `safeSupabaseOperation()` helper with fallback values
- **Connection Checks**: `checkSupabaseConnection()` validates connectivity before operations
- **User-friendly Messages**: Map technical errors to localized user messages in AuthContext
- **Logger System**: Use `log()` function from `src/lib/logger.ts` with categories:
  - `LogCategories.AUTH` - Authentication events
  - `LogCategories.DATABASE` - Database operations
  - `LogCategories.API` - API calls
  - `LogCategories.UI` - UI events
  - Example: `log('User logged in', LogCategories.AUTH)`

## Development Guidelines

### Key Custom Hooks (src/hooks/)
- Shift/time helpers live in `src/utils/shiftUtils.ts`, **not** a hook — there is no `useShiftTime`.

### Working with Supabase
- Always use `safeSupabaseOperation()` wrapper for database queries to handle connection failures gracefully
- Check `checkSupabaseConnection()` before critical operations
- Use `.single()` for queries expecting one row, `.maybeSingle()` if row may not exist
- Enable Realtime on tables in Supabase dashboard: Settings > Realtime
- Test RLS policies in Supabase SQL Editor using `auth.uid()` function
- **Service Role Key**: Only use in API routes (`src/app/api/`), never in client components
- **Admin Operations**: Use `/api/auth/profile-admin` endpoint for bypassing RLS when needed

#### ⚠️ 설비 상태를 쓰려면 advisory lock 하나만 쓴다

`machines` 또는 `downtime_entries` 를 쓰는 함수는 **반드시** 아래 잠금을 먼저 잡는다:

```sql
perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
```

**키가 같아야 의미가 있다.** advisory lock 은 Postgres 에서 독립된 네임스페이스라
`SELECT ... FOR UPDATE` 와 **서로를 차단하지 않는다.** `apply_machine_update` 는 행 잠금만,
andon·정정 RPC 는 advisory 만 써서 — 넷 다 "잠금이 있는" 것처럼 보였지만 실제로는 상호 배제가
전혀 없었다. 이 때문에 정정 RPC 의 `no_open_downtime` 가드를 통과한 뒤 다른 요청이 상태를
바꾸면, 트리거가 억제된 채 `current_state` 만 갱신돼 열린 `machine_logs` 와 어긋난 채 남았다.

따라오는 규칙:
- **판단과 쓰기는 같은 잠금 아래 있어야 한다.** 비활성 여부·현재 상태 같은 조건을 Node 에서
  먼저 조회하고 RPC 에 넘기면, 그 조회는 트랜잭션 밖이라 조회와 쓰기 사이가 비어 있다.
  조건 검사는 RPC 안(잠금 확보 후)에 둔다. 거부는 `55000` + `MACHINE_INACTIVE` 규약을 쓴다.
- **순서는 항상 advisory → 행 잠금.** 모든 경로가 같은 순서라야 데드락이 없다.
- 트리거 함수는 예외다 — 호출자의 트랜잭션 안에서 돌기 때문에 호출자가 이미 잠금을 쥐고 있다.

**기존 RPC 의 시그니처는 바꾸지 않는다.** `create or replace` 는 인자 목록이 다르면 덮어쓰지
않고 **오버로드**를 만든다. 그래서 인자를 늘리면 옛 함수를 `DROP` 해야 하고, `DROP` 하는 순간
마이그레이션과 코드 배포 사이에 어느 순서로도 피할 수 없는 "함수 없음" 창이 생긴다
(PostgREST 의 스키마 캐시 리로드 지연까지 더해진다). 호출자별로 동작을 나누고 싶어질 때는
인자를 추가하기 전에 **모든 호출자에 옳은 규칙 하나**로 표현할 수 있는지 먼저 본다.
비활성 설비 가드가 그 예다 — "PATCH 만 거부"가 아니라 "상태 변경은 언제나 거부"로 쓰면
인자가 필요 없고, 마이그레이션이 코드보다 먼저 적용돼도 안전하다.

`supabase/migrations/__tests__/machineStateLockProtocol.test.ts` 가 마이그레이션 전체를 훑어
각 함수의 **최종 정의**를 모아 이 규약을 강제한다. 새 함수가 상태를 쓰기 시작하면 그 테스트를
고치지 않아도 자동으로 검사 대상이 된다.

### Real-time Subscriptions
- Subscribe in `useEffect` with proper cleanup using `channelsRef.current`
- Use `channelsRef` to track channels and unsubscribe on unmount
- Handle `INSERT`, `UPDATE`, `DELETE` events separately
- Throttle UI updates to avoid excessive re-renders (batch state updates)

### Internationalization
- Translation files: JSON files in `public/locales/{ko,vi}/` directories organized by feature
- Use `useTranslation()` hook from `src/hooks/useTranslation.ts`
- Supported languages: Korean (ko), Vietnamese (vi)
- Add new translations by creating/updating JSON files in `public/locales/`

## Environment Variables

Required in `.env.local` (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` — the service role key is
**server-side only, never expose it to the client**.

Environment validation is performed using Zod schemas in `src/lib/env-validation.ts`

## Deployment

Vercel. Deploy steps and the post-deployment checklist live in `docs/DEPLOYMENT.md`.

## Critical System Features

### OEE 정합성 보정 Edge Function (⚠ 예약 실행되지 않는다)

`supabase/functions/daily-oee-aggregation` 은 **예약 실행도, 앱 안의 살아있는 호출자도
없다.** 재계산도 하지 않는다. 건드리기 전에 `oee-aggregation` 스킬과
`docs/OEE_AGGREGATION_SYSTEM.md` 를 먼저 읽을 것 — 이전 문서의 서술은 거의 전부
사실이 아니었다.

### Production Record Input System
- See `src/components/production/README.md` for details

### Report Generation System
- See `src/components/reports/README.md` for API reference
