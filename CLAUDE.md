# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CNC OEE Monitoring System - A real-time web application for monitoring and managing Overall Equipment Effectiveness (OEE) of CNC machines. Built with Next.js 16, React 19, TypeScript, Ant Design, and Supabase.

## Development Commands

### Setup & Installation
```bash
npm install                 # Install dependencies
cp .env.example .env.local  # Create environment file (configure Supabase keys)
```

### Development
```bash
npm run dev                 # Start development server (localhost:3000)
npm run dev:clean           # Clean .next cache and start dev server
npm run build               # Build for production
npm start                   # Start production server
```

### Testing & Quality
```bash
npm run lint                # Run ESLint
npm test                    # Run Jest tests
npm test:watch              # Run Jest in watch mode
npm test -- path/to/test.ts # Run single test file
npm test -- --coverage      # Run tests with coverage report
npm test -- --testPathPattern=production  # Run tests matching pattern
npm run clean               # Clean cache directories
```

## Architecture

### Tech Stack
- **Runtime**: Node.js 24.18 LTS
- **Framework**: Next.js 16 (App Router) with React 19
- **Language**: TypeScript 5
- **UI Library**: Ant Design 5.27+
- **Database**: Supabase (PostgreSQL + Realtime)
- **Charts**: Chart.js 4.5 + react-chartjs-2, Recharts
- **Authentication**: Supabase Auth with Row Level Security (RLS)
- **State Management**: React Context API
- **i18n**: react-i18next (Korean, Vietnamese)

### Key Dependencies
- **@supabase/supabase-js** ^2.53.0 - Supabase client library
- **antd** ^5.27.1 - UI component library
- **date-fns** ^4.1.0 - Date/time utilities
- **zod** ^4.0.15 - Schema validation for forms and data
- **xlsx** ^0.18.5 - Excel file parsing and generation
- **jspdf** ^3.0.1 + **jspdf-autotable** ^5.0.2 - PDF report generation
- **html2canvas** ^1.4.1 - Chart to image conversion for reports
- **i18next** ^25.3.2 + **react-i18next** ^15.6.1 - Internationalization

### Directory Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── dashboard/          # Main dashboard (role-based views)
│   ├── machines/           # Machine management
│   ├── reports/            # Reports & analytics
│   ├── settings/           # System settings
│   ├── admin/              # Admin-only pages
│   ├── login/              # Authentication page
│   └── api/                # API routes
├── components/             # React components (organized by feature)
├── contexts/              # React Context providers
│   ├── AuthContext.tsx     # Authentication state & user management
│   ├── LanguageContext.tsx # i18n language switching
│   ├── NotificationContext.tsx # Real-time notification system
│   └── SystemSettingsContext.tsx # Global system settings
├── hooks/                 # Custom React hooks
│   ├── useRealtimeData.ts  # Supabase Realtime subscriptions
│   ├── useMachines.ts      # Machine data management
│   └── useSystemSettings.ts # System settings management
├── lib/                   # Core libraries
│   ├── supabase.ts         # Supabase client (browser)
│   └── supabase-admin.ts   # Supabase admin client (server-side)
├── types/                 # TypeScript type definitions
├── utils/                 # Utility functions
│   ├── oeeCalculator.ts    # OEE calculation engine
│   ├── dateTimeUtils.ts    # Date/time helpers
│   └── notificationDetector.ts # Notification logic
└── proxy.ts               # Next.js proxy (cache control)
```

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
- **auth/**: Login, logout, profile retrieval (regular + admin with RLS bypass)
- **admin/**:
  - `machines/` - Machine CRUD, bulk upload, Excel template generation
  - `users/` - User management
  - `setup-real-user/` - Initial admin user creation
- **machines/**: Machine queries and machine-specific data
  - `[machineId]/oee/` - OEE metrics for specific machine
  - `[machineId]/production/` - Production records for specific machine
- **production-records/**: Production data CRUD
  - `daily/` - Daily production summaries
- **oee-data/**: OEE metrics queries
  - Returns raw `production_records` rows, so it is **paginated**: `limit` (default 1000, max 5000) + `offset`, with a `pagination` block (`total`, `returned`, `has_more`) in the response.
  - `statistics` is computed in SQL over the **entire** filtered set (`analytics_oee_records_summary` RPC), not over the returned page. Never average the returned rows — a yearly query matches far more rows than one page holds, and you will only ever hold a page of them.
  - `aggregated/` - Aggregated OEE data (rolled up server-side; use this when you want trends, not rows)
- **system-settings/**: Settings CRUD by category
  - `[category]/` - Category-specific settings
  - `service-role/` - Service role key verification
- **upload/image/**: Image upload handling
- **alerts/**: Alert/notification management
- **quality-analysis/**, **productivity-analysis/**, **downtime-analysis/**: Analytics endpoints

API Route Patterns:
- **Client-side**: Use `supabase` client from `src/lib/supabase.ts`
- **Server-side**: Import Service Role client from `src/lib/supabase-admin.ts` for admin operations
- **Request cache control**: Proxy adds development cache headers to non-API routes (see `src/proxy.ts`)
- **RLS Bypass**: Service Role Key bypasses RLS for admin operations in API routes

#### ⚠️ PostgREST silently truncates large queries
PostgREST enforces a `max-rows` cap (**100,000** on this project). A `select()` without `.limit()` that matches more rows returns exactly 100,000 of them **with a 200 status and no warning** — the response looks complete.

**Current headroom (measured 2026-08-04):** `production_records` holds **32,736 rows** and grows
**~1,423 rows/day** (800 machines × 2 shifts, 2026-07-11 onward). That is roughly **47 days** of
headroom before an unbounded query over the whole table starts truncating silently.

Do not read that as "we have time". Read it as: the cap is a date, not a hypothetical, and the
failure when it arrives is invisible. Also, *filtered* queries hit it far earlier than the table
total suggests — any query whose predicate matches more than 100,000 rows truncates, and a
multi-year range over this table will.

> Earlier revisions of this file claimed ~325k rows. That was wrong by 10× and it caused a real
> misjudgement: the 2026-08-04 audit rated a pagination defect HIGH on the premise that deep pages
> already return empty, which they do not at the current row count. **Re-measure before citing a
> row count as a reason.**

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

### TypeScript Types (src/types/)
Type definitions organized by domain:
- **index.ts**: Core types (User, Machine, MachineLog, ProductionRecord, OEEMetrics)
- **database.types.ts**: Auto-generated Supabase database types
- **database.ts**: Extended database types with custom properties
- **dataInput.ts**: Production input form types
- **reports.ts**: Report configuration and data types
- **notifications.ts**: Notification and alert types
- **systemSettings.ts**: System settings with categories (General, Display, OEE, Shift, Notification)
- **modelInfo.ts**: Product model and process types
- Use strict TypeScript typing throughout the codebase

## Development Guidelines

### Key Custom Hooks (src/hooks/)
Critical hooks for feature development:
- **useRealtimeData**: Subscribes to machines, machine_logs, production_records tables with auto-reconnection
- **useMachines**: Machine CRUD operations with real-time updates
- **useProductionRecords**: Production record management with shift-based queries
- **useRealtimeMachines**: Real-time machine status updates
- **useRealtimeNotifications**: Live notification system
- **useSystemSettings**: Access global settings (shift times, OEE thresholds, break durations)
- (Shift/time helpers live in `src/utils/shiftUtils.ts`, not a hook — there is no `useShiftTime`)
- **useShiftNotification**: Shift end notification triggers (15 min before shift end)
- **useOEEThresholds**: OEE status color coding (good/warning/poor)
- **useTranslation**: i18n translation function with language context
- **useAutoRefresh**: Configurable auto-refresh for data polling
- **useClientOnly**: SSR-safe client-only rendering

### Key Utilities (src/utils/)
Core utility functions:
- **oeeCalculator.ts**: `OEECalculator` class with methods for availability, performance, quality, and OEE calculations
- **oeeAggregation.ts**: `OEEAggregationService` for triggering manual/batch aggregations and monitoring logs
- **shiftUtils.ts**: Shift time calculations (`getCurrentShiftInfo`, `shouldShowShiftEndNotification`, `calculateActualRuntime`)
- **reportUtils.ts**: Report generation helpers (chart to image, CSV export, number formatting)
- **reportAggregator.ts**: Data aggregation for reports
- **dateTimeUtils.ts**: Date/time formatting and timezone handling
- **notificationDetector.ts**: Logic for detecting notification-worthy events
- **localStorage.ts**: Type-safe localStorage wrapper

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

### Adding New Features
1. **Define Types**: Add TypeScript interfaces in `src/types/`
2. **Create API Route**: If server-side logic needed, add in `src/app/api/`
3. **Build Components**: Create feature components in `src/components/[feature]/`
4. **Add Page**: Create route in `src/app/[route]/page.tsx`
5. **Update RLS**: Modify Supabase RLS policies if new tables/permissions needed
6. **Test Roles**: Verify admin, engineer, and operator access patterns

### Real-time Subscriptions
- Subscribe in `useEffect` with proper cleanup using `channelsRef.current`
- Use `channelsRef` to track channels and unsubscribe on unmount
- Handle `INSERT`, `UPDATE`, `DELETE` events separately
- Throttle UI updates to avoid excessive re-renders (batch state updates)
- Example pattern from `useRealtimeData.ts`:
  ```typescript
  const channelsRef = useRef<RealtimeChannel[]>([]);

  useEffect(() => {
    const channel = supabase.channel('table-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'machines' }, handleChange)
      .subscribe();

    channelsRef.current.push(channel);

    return () => {
      channelsRef.current.forEach(ch => ch.unsubscribe());
      channelsRef.current = [];
    };
  }, []);
  ```

### Component Organization
Components are organized by feature domain in `src/components/`:
- **admin/**: User management, machine management, OEE aggregation manager
- **auth/**: Login forms, role guards, protected routes
- **dashboard/**: Role-based dashboards (Admin, Engineer, Operator)
- **data-input/**: Shift data input forms
- **layout/**: App layout, sidebar, theme/language toggles
- **machines/**: Machine list/cards, detail modals, status input, bulk upload
- **notifications/**: Notification panel, badges, toast notifications
- **oee/**: OEE gauges, charts (trend, comparison, downtime)
- **production/**: Production record input, shift notifications
- **quality/**: Defect analysis charts
- **reports/**: Report generators, export modals, templates
- **settings/**: System settings tabs (General, Display, OEE, Shift, Notifications)

Each feature directory includes an `index.ts` for clean exports

### Testing
- Jest config: `jest.config.js`
- Setup file: `jest.setup.js`
- Run single test: `npm test -- path/to/test.ts`
- Test coverage: `npm test -- --coverage`

### Internationalization
- Translation files: JSON files in `public/locales/{ko,vi}/` directories organized by feature
  - `common.json`: Common UI strings
  - `auth.json`: Authentication messages
  - `machines.json`: Machine-related translations
  - `dashboard.json`: Dashboard strings
  - `production.json`: Production input translations
  - `reports.json`: Report generation strings
- Use `useTranslation()` hook from `src/hooks/useTranslation.ts`
- Supported languages: Korean (ko), Vietnamese (vi)
- Add new translations by creating/updating JSON files in `public/locales/`

### Styling
- **Ant Design Theme**: Customized in `src/app/globals.css` and `src/components/providers/AntdConfigProvider.tsx`
- **CSS Modules**: Use for component-specific styles
- **Tailwind CSS 4**: Configured via `tailwindcss` package (see `postcss.config.mjs`)
- **Responsive Design**: Mobile-first approach, test on all breakpoints

## Environment Variables

Required in `.env.local`:
```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key  # Server-side only, never expose to client
```

Environment validation is performed using Zod schemas in `src/lib/env-validation.ts`

## Deployment

### Vercel (Recommended)
```bash
vercel --prod
```
- Set environment variables in Vercel dashboard
- Ensure Supabase URL uses HTTPS
- Enable Realtime in Supabase dashboard before deployment

### Post-Deployment Checklist
- Verify RLS policies are active in production
- Test real-time subscriptions work
- Confirm authentication flow (login/logout)
- Check all user roles have appropriate access
- Monitor Supabase usage and API rate limits

## Critical System Features

### OEE 정합성 보정 Edge Function (⚠ 예약 실행되지 않는다)

**2026-07-29 실측으로 이 절을 전면 정정했다.** 이전 서술은 거의 전부 사실이 아니었고,
같은 문서 안의 다른 서술(위 "there is no `oee_aggregation_log` table")과도 충돌했다.

| 이전 서술 | 실제 |
|---|---|
| pg_cron 으로 매일 08:30 / 20:30 자동 실행 | **pg_cron 미설치**(`installed_version=null`), `cron` 스키마 없음 → **예약 실행 없음** |
| `OEEAggregationService.triggerDailyAggregation` 으로 수동 실행 | 그 모듈을 **import 하는 곳이 없다** (죽은 코드) |
| `OEEAggregationManager.tsx` 가 관리 UI 제공 | 어느 페이지에도 **마운트되지 않았다** (죽은 코드) |
| `oee_aggregation_log` 가 실행 이력 기록 | **그런 테이블은 없다** |
| "Performs OEE calculations" | 재계산을 **하지 않는다** — 아래 참조 |

**현재 상태**: 함수는 배포되어 있고(`verify_jwt: true`, ACTIVE) 유효한 관리자 JWT 로 HTTP
호출하면 동작한다. 그러나 **앱 안에 살아있는 호출자가 하나도 없다.**

**함수가 실제로 하는 일**: 산술적으로 반박 불가능한 명제 하나만 적용한다 —
`output_qty = 0` 이면 `ideal_runtime / performance / quality / oee` 도 0이다.
작업자 입력값(`planned_runtime`, `actual_runtime`, `output_qty`, `defect_qty`,
`downtime_minutes`, `availability`)은 **건드리지 않고**, 행을 **INSERT 하지도 않는다**.
지표를 저장된 입력값으로 재유도하면 이 DB 에서는 곧 역사 덮어쓰기가 되기 때문이다
(근거는 함수 파일 상단 주석에 있다). `dry_run: true` 로 영향 범위만 확인할 수 있다.

**인가**(2026-07-29 추가): `service_role` 토큰은 통과, 그 외에는 `admin` + `is_active` 를
요구한다. 토큰 없음·서명 불일치는 플랫폼의 `verify_jwt` 가 401 로 막는다(실측 확인).

- Edge Function: `supabase/functions/daily-oee-aggregation/index.ts`
- 회귀 검사: `supabase/functions/__tests__/dailyOeeAggregationAuthz.test.ts`
- 상세: `docs/OEE_AGGREGATION_SYSTEM.md` (2026-08-06 전면 재작성 — 존재하지 않는 시스템의
  설치 절차를 지우고 실측만 남겼다. 원래 설계와 그 행방은 그 문서 부록에 있다.)

### Production Record Input System
Shift-based production data entry with automatic notifications:
- **Components**:
  - `ProductionRecordInput`: Modal for entering production quantities
  - `ShiftEndNotification`: Auto-notification 15 minutes before shift end
  - `ProductionManager`: Integrated production management interface
- **Validation**: Zod schema ensures defect_qty ≤ output_qty
- **Estimation**: Calculates estimated output based on tact time and actual runtime
- **Shift Times**: A shift (08:00-20:00), B shift (20:00-08:00 next day)
- See `src/components/production/README.md` for details

### Report Generation System
Multi-format report export with customizable templates:
- **Formats**: PDF (jsPDF) and Excel (xlsx)
- **Components**:
  - `ReportGenerator`: Quick export with default settings
  - `ReportExportModal`: Custom report configuration
  - `ReportTemplates`: Static generation methods
  - `ReportDashboard`: Comprehensive report management
- **Report Types**: Summary, Detailed, Trend Analysis, Downtime Analysis
- **Chart Integration**: Supports embedding Chart.js visualizations in PDFs using `html2canvas`
- See `src/components/reports/README.md` for API reference

### Machine Bulk Upload System
Excel-based bulk machine import functionality:
- **Template Generation**: `/api/admin/machines/template` generates Excel template with proper headers
- **Upload Component**: `MachinesBulkUpload` (`src/components/machines/MachinesBulkUpload.tsx`)
- **Template Creator**: `src/lib/excel/machineTemplate.ts` defines Excel structure
- **Validation**: Validates required fields (name, model, location) before import
- **Usage**: Admin page at `/machines/bulk-upload`
- **Libraries**: Uses `xlsx` package for Excel parsing

## Important Technical Notes

### Memory Management & Performance
- **Context Cleanup**: All contexts use `isMountedRef` to prevent state updates after unmount
- **AbortController**: Used in AuthContext to cancel pending API requests on unmount
- **Timeout Handling**: Auth initialization has 30-second timeout with user-friendly error messages
- **Realtime Reconnection**: Auto-reconnects every 5 seconds on connection failure with heartbeat checks every 30 seconds
- **OEE Caching**: OEE calculations are cached for 5 minutes; clear cache with `OEECache.clear()`

### Configuration
- **Shift System**: 12-hour shifts (A: 08:00-20:00, B: 20:00-08:00) with 60-minute break
- **System Settings**: Configurable via `system_settings` table and `SystemSettingsContext`
- **OEE Thresholds**: Configurable per settings (defaults: Good ≥80%, Warning 60-79%, Poor <60%)
