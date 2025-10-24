# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

CNC OEE Monitoring System - A real-time web application for monitoring and managing Overall Equipment Effectiveness (OEE) of CNC machines. Built with Next.js 14, TypeScript, Ant Design, and Supabase.

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
- **Framework**: Next.js 14 (App Router)
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
└── middleware.ts          # Next.js middleware (cache control)
```

## Key Architectural Patterns

### Authentication & Authorization
- **Supabase Auth** with JWT tokens stored in browser cookies
- **Row Level Security (RLS)** enforces database-level permissions
- **Three User Roles**:
  - `admin`: Full system access (all CRUD operations, system settings, user management)
  - `engineer`: Read-only access to all machines and analytics
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
  - `OEE` = Availability × Performance × Quality
- **RealTimeOEECalculator**: Calculates OEE from machine logs in real-time
- **OEECache**: 5-minute in-memory cache for calculated OEE metrics
- **Shift Logic**: Supports 12-hour shifts (A: 08:00-20:00, B: 20:00-08:00)

### State Management
- **Context Providers** wrap the app in `src/app/providers.tsx` and `src/app/layout.tsx`:
  - `AntdConfigProvider`: Ant Design theme configuration (dark/light mode)
  - `ThemeProvider`: Custom theme state management
  - `AuthProvider`: User authentication and session management
  - `LanguageProvider`: i18n language switching (Korean/Vietnamese)
  - `NotificationProvider`: Real-time notifications and alerts
  - `SystemSettingsProvider`: Global settings (shift times, break times, OEE thresholds)
- **Provider Order**: AntdConfigProvider → ThemeProvider → AuthProvider → LanguageProvider → NotificationProvider → SystemSettingsProvider
- **Local State**: Use `useState` for component-specific state
- **Server State**: Fetched via Supabase queries, cached in React Query-like patterns

### Database Schema Key Tables
- `machines`: CNC machine master data (name, model, status, location, tact_time)
- `machine_logs`: Time-series state changes (NORMAL_OPERATION, ERROR, MAINTENANCE, etc.)
- `production_records`: Production output, defects, and timestamps per shift
- `user_profiles`: User info with role and assigned_machines (array of machine IDs)
- `notifications`: System notifications with read/unread status
- `system_settings`: Global configuration (shift_start_time, break_duration, oee_thresholds, etc.)
- `product_models`: Product model definitions with tact times
- `model_processes`: Process steps for each product model
- `oee_aggregation_log`: Daily OEE aggregation execution logs

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
  - `aggregated/` - Aggregated OEE data
- **system-settings/**: Settings CRUD by category
  - `[category]/` - Category-specific settings
  - `service-role/` - Service role key verification
- **upload/image/**: Image upload handling
- **alerts/**: Alert/notification management
- **quality-analysis/**, **productivity-analysis/**, **downtime-analysis/**: Analytics endpoints

API Route Patterns:
- **Client-side**: Use `supabase` client from `src/lib/supabase.ts`
- **Server-side**: Import Service Role client from `src/lib/supabase-admin.ts` for admin operations
- **Authentication**: Middleware checks for valid session on protected routes (see `src/middleware.ts`)
- **RLS Bypass**: Service Role Key bypasses RLS for admin operations in API routes

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
- **useShiftTime**: Current shift calculation and time utilities
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

### OEE Daily Aggregation System
The system includes automated daily OEE aggregation using Supabase Edge Functions and PostgreSQL pg_cron:
- **Edge Function**: `supabase/functions/daily-oee-aggregation/index.ts` - Performs OEE calculations
- **Scheduled Execution**:
  - 8:30 AM daily - aggregates previous day's B shift (20:00-08:00)
  - 8:30 PM daily - aggregates current day's A shift (08:00-20:00)
- **Manual Trigger**: Use `OEEAggregationService.triggerDailyAggregation(date)` from `src/utils/oeeAggregation.ts`
- **Admin UI**: `src/components/admin/OEEAggregationManager.tsx` provides aggregation management interface
- **Logs Table**: `oee_aggregation_log` tracks execution history and status
- See `docs/OEE_AGGREGATION_SYSTEM.md` for complete documentation

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
