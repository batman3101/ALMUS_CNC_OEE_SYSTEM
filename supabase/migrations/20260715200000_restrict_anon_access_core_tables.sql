-- Close anonymous (public anon key) exposure on core operational tables.
--
-- production_records / machine_logs had `FOR ALL TO public USING (true)` policies and
-- machines / machine_status_descriptions had `FOR SELECT TO public USING (true)`.
-- Because NEXT_PUBLIC_SUPABASE_ANON_KEY ships in the browser bundle, anyone on the
-- internet could read (and, for the ALL policies, insert/update/delete) every row via
-- PostgREST, bypassing the API's role/scope checks. These migrations 20260715080500..190000
-- do NOT address this; it is fixed here.
--
-- Design notes:
--   * production_records: no browser or SECURITY INVOKER trigger writes it. All writes go
--     through service_role (save_daily_production RPC / API routes). → authenticated SELECT
--     only; writes are denied to anon/authenticated and only service_role (RLS bypass) writes.
--   * machine_logs: written by the SECURITY INVOKER trigger log_machine_status_change, which
--     runs as the authenticated user updating public.machines. Removing authenticated writes
--     would break machine status changes. → keep authenticated ALL, block anon only.
--   * machines: keep existing admin/engineer modify policy; only replace the public read.

-- production_records --------------------------------------------------------
DROP POLICY IF EXISTS "Allow all access to production_records" ON public.production_records;
CREATE POLICY "Authenticated can read production_records"
  ON public.production_records
  FOR SELECT TO authenticated
  USING (true);

-- machine_logs --------------------------------------------------------------
DROP POLICY IF EXISTS "Allow all access to machine_logs" ON public.machine_logs;
CREATE POLICY "Authenticated can access machine_logs"
  ON public.machine_logs
  FOR ALL TO authenticated
  USING (true)
  WITH CHECK (true);

-- machines ------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can read machines" ON public.machines;
CREATE POLICY "Authenticated can read machines"
  ON public.machines
  FOR SELECT TO authenticated
  USING (true);

-- machine_status_descriptions ----------------------------------------------
DROP POLICY IF EXISTS "Anyone can read machine status descriptions" ON public.machine_status_descriptions;
CREATE POLICY "Authenticated can read machine status descriptions"
  ON public.machine_status_descriptions
  FOR SELECT TO authenticated
  USING (true);

-- Ghost backup table: RLS was disabled entirely (anon readable). Enable RLS with no policy so
-- only service_role (RLS bypass) can access it; revoke direct grants from anon/authenticated.
ALTER TABLE public.production_records_ghost_backup_20260714 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.production_records_ghost_backup_20260714 FROM anon, authenticated;
