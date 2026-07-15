-- Performance: fix auth_rls_initplan advisory.
--
-- RLS policies that call auth.uid()/auth.jwt()/auth.role()/is_admin() directly re-evaluate
-- those functions once PER ROW. Those functions are row-independent (they depend on the session,
-- not the scanned row), so wrapping each call in a scalar subquery `(select ...)` makes Postgres
-- evaluate it once per query (init-plan) instead of per row. This is semantically a no-op
-- (identical authorization result) and only improves performance — significant on
-- production_records (~327k rows).
--
-- Implemented programmatically so each policy's exact name/roles/command and the rest of its
-- expression are preserved verbatim; only the function calls are wrapped. Idempotent: policies
-- already wrapped are skipped.

DO $$
DECLARE
  r record;
  nq text;
  nc text;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        coalesce(qual, '')       ~ '(auth\.(uid|jwt|role)\(|is_admin\()' OR
        coalesce(with_check, '') ~ '(auth\.(uid|jwt|role)\(|is_admin\()'
      )
      AND coalesce(qual, '')       !~ '\(\s*[Ss][Ee][Ll][Ee][Cc][Tt]\s+(auth\.|is_admin)'
      AND coalesce(with_check, '') !~ '\(\s*[Ss][Ee][Ll][Ee][Cc][Tt]\s+(auth\.|is_admin)'
  LOOP
    nq := r.qual;
    nc := r.with_check;

    IF nq IS NOT NULL THEN
      nq := regexp_replace(nq, 'auth\.uid\(\)',  '(select auth.uid())',  'g');
      nq := regexp_replace(nq, 'auth\.jwt\(\)',  '(select auth.jwt())',  'g');
      nq := regexp_replace(nq, 'auth\.role\(\)', '(select auth.role())', 'g');
      nq := regexp_replace(nq, 'is_admin\(\)',   '(select is_admin())',  'g');
    END IF;
    IF nc IS NOT NULL THEN
      nc := regexp_replace(nc, 'auth\.uid\(\)',  '(select auth.uid())',  'g');
      nc := regexp_replace(nc, 'auth\.jwt\(\)',  '(select auth.jwt())',  'g');
      nc := regexp_replace(nc, 'auth\.role\(\)', '(select auth.role())', 'g');
      nc := regexp_replace(nc, 'is_admin\(\)',   '(select is_admin())',  'g');
    END IF;

    IF r.qual IS NOT NULL AND r.with_check IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s) WITH CHECK (%s)',
                     r.policyname, r.schemaname, r.tablename, nq, nc);
    ELSIF r.qual IS NOT NULL THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)',
                     r.policyname, r.schemaname, r.tablename, nq);
    ELSE
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)',
                     r.policyname, r.schemaname, r.tablename, nc);
    END IF;

    RAISE NOTICE 'rls_initplan: rewrote %.% policy %', r.schemaname, r.tablename, r.policyname;
  END LOOP;
END $$;
