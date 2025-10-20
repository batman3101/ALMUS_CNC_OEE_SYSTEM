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
npm run clean               # Clean cache directories
```

## Architecture

### Tech Stack
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **UI Library**: Ant Design 5.27+
- **Database**: Supabase (PostgreSQL + Realtime)
- **Charts**: Chart.js + react-chartjs-2
- **Authentication**: Supabase Auth with Row Level Security (RLS)
- **State Management**: React Context API
- **i18n**: react-i18next (Korean, Vietnamese)

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
  - `admin`: Full system access
  - `engineer`: Read-only access to all machines
  - `operator`: Access only to assigned machines (via `assigned_machines` field in `user_profiles`)
- **AuthContext** (`src/contexts/AuthContext.tsx`): Manages authentication state with automatic session recovery and cleanup on unmount to prevent memory leaks
- **Profile Fetching Strategy**: Attempts Service Role API first (admin endpoint), falls back to client-side query if RLS blocks it

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
- **Context Providers** wrap the app in `src/app/providers.tsx`:
  - `AuthProvider`: User authentication
  - `LanguageProvider`: i18n language switching
  - `NotificationProvider`: Real-time notifications
  - `SystemSettingsProvider`: Global settings (shift times, break times)
- **Local State**: Use `useState` for component-specific state
- **Server State**: Fetched via Supabase queries, cached in React Query-like patterns

### Database Schema Key Tables
- `machines`: CNC machine master data (name, model, status, location)
- `machine_logs`: Time-series state changes (NORMAL_OPERATION, ERROR, MAINTENANCE, etc.)
- `production_records`: Production output, defects, and timestamps per shift
- `user_profiles`: User info with role and assigned_machines (array of machine IDs)
- `notifications`: System notifications with read/unread status
- `system_settings`: Global configuration (shift_start_time, break_duration, etc.)

### API Routes
- **Client-side**: Use `supabase` client from `src/lib/supabase.ts`
- **Server-side**: Use `createServerClient()` with Service Role Key for admin operations
- **Authentication**: Middleware checks for valid session on protected routes
- **RLS Bypass**: Service Role Key bypasses RLS for admin operations in API routes

### Error Handling
- **Type-safe Errors**: Use `ErrorCodes` enum from `types/index.ts`
- **Supabase Operations**: Wrapped in `safeSupabaseOperation()` helper with fallback values
- **Connection Checks**: `checkSupabaseConnection()` validates connectivity before operations
- **User-friendly Messages**: Map technical errors to localized user messages in AuthContext

## Development Guidelines

### Working with Supabase
- Always use `safeSupabaseOperation()` wrapper for database queries to handle connection failures gracefully
- Check `getConnectionStatus()` before critical operations
- Use `.single()` for queries expecting one row, `.maybeSingle()` if row may not exist
- Enable Realtime on tables in Supabase dashboard: Settings > Realtime
- Test RLS policies in Supabase SQL Editor using `auth.uid()` function

### Adding New Features
1. **Define Types**: Add TypeScript interfaces in `src/types/`
2. **Create API Route**: If server-side logic needed, add in `src/app/api/`
3. **Build Components**: Create feature components in `src/components/[feature]/`
4. **Add Page**: Create route in `src/app/[route]/page.tsx`
5. **Update RLS**: Modify Supabase RLS policies if new tables/permissions needed
6. **Test Roles**: Verify admin, engineer, and operator access patterns

### Real-time Subscriptions
- Subscribe in `useEffect` with proper cleanup
- Use `channelsRef` to track channels and unsubscribe on unmount
- Handle `INSERT`, `UPDATE`, `DELETE` events separately
- Throttle UI updates to avoid excessive re-renders (batch state updates)

### Testing
- Jest config: `jest.config.js`
- Setup file: `jest.setup.js`
- Run single test: `npm test -- path/to/test.ts`
- Test coverage: `npm test -- --coverage`

### Internationalization
- Translation files: Define in `LanguageContext.tsx` or external JSON
- Use `useTranslation()` hook from `src/hooks/useTranslation.ts`
- Supported languages: Korean (ko), Vietnamese (vi)
- Add new translations by updating translation objects in LanguageContext

### Styling
- **Ant Design Theme**: Customized in `src/app/globals.css`
- **CSS Modules**: Use for component-specific styles
- **Tailwind**: Available for utility classes (configured in `tailwind.config.js`)
- **Responsive Design**: Mobile-first approach, test on all breakpoints

## Environment Variables

Required in `.env.local`:
```bash
NEXT_PUBLIC_SUPABASE_URL=your_supabase_project_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key  # Server-side only
```

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

## Important Notes

- **Memory Management**: All contexts use `isMountedRef` to prevent state updates after unmount
- **AbortController**: Used in AuthContext to cancel pending API requests on unmount
- **Timeout Handling**: Auth initialization has 30-second timeout with user-friendly error messages
- **Supabase Realtime**: Connection may drop; system auto-reconnects every 5 seconds
- **OEE Caching**: OEE calculations are cached for 5 minutes; clear cache with `OEECache.clear()`
- **Shift Calculations**: Assumes 12-hour shifts with 1-hour break; configurable in `system_settings` table
