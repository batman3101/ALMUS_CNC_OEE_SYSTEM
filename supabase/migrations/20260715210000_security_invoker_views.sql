-- Convert the remaining SECURITY DEFINER views to security_invoker so they enforce the
-- querying user's RLS/permissions instead of the view owner's (advisor lint 0010_security_definer_view).
--
-- Safety analysis (2026-07-15):
--   * current_machine_status, latest_oee_metrics, machine_status_statistics,
--     recent_machine_status_changes, user_profiles_rls_debug are NOT queried by application
--     code (only type references in database.types.ts) — no runtime impact.
--   * machines_with_production_info is queried only via the service_role client in
--     src/app/api/** (production-records route/[recordId]/daily). service_role bypasses RLS,
--     so the joined result is unchanged under security_invoker.
--   * user_profiles_rls_debug reads no base tables (only auth.uid()/auth.jwt()).
-- Base tables (machines, machine_logs, production_records, machine_status_descriptions) already
-- grant authenticated SELECT, so an authenticated caller would also resolve these correctly.

ALTER VIEW public.current_machine_status SET (security_invoker = true);
ALTER VIEW public.latest_oee_metrics SET (security_invoker = true);
ALTER VIEW public.machine_status_statistics SET (security_invoker = true);
ALTER VIEW public.machines_with_production_info SET (security_invoker = true);
ALTER VIEW public.recent_machine_status_changes SET (security_invoker = true);
ALTER VIEW public.user_profiles_rls_debug SET (security_invoker = true);
