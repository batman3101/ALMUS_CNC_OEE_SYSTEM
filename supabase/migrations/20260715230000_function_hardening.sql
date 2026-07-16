-- Security hardening batch (advisor: function_search_path_mutable + *_security_definer_function_executable).
--
-- (A) Set an immutable search_path on every public application function that lacks one. A mutable
--     search_path lets a caller shadow unqualified references. Value `public, extensions, pg_temp`
--     keeps public + extensions objects resolvable (pg_catalog is always searched first), so
--     function bodies are unaffected.
--
-- (B) Revoke EXECUTE on trigger functions (return type `trigger`) from anon/authenticated/public.
--     PostgreSQL does not check the invoking user's EXECUTE privilege when a trigger fires, so
--     triggers keep working; this only blocks meaningless/abusable direct RPC calls. Legitimate
--     RPCs (is_admin, get_system_setting, update_system_setting, update_my_preferences) return
--     non-trigger types and stay executable.
--
-- Extension-owned functions (e.g. btree_gist's gbt_*) are excluded — they are not owned by this
-- role and are not application code. Per-function exception handling keeps the batch resilient.

-- (A) search_path ---------------------------------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
      AND NOT EXISTS (
        SELECT 1 FROM unnest(coalesce(p.proconfig, ARRAY[]::text[])) c
        WHERE lower(c) LIKE 'search_path=%'
      )
  LOOP
    BEGIN
      EXECUTE format('ALTER FUNCTION public.%I(%s) SET search_path = public, extensions, pg_temp',
                     r.proname, r.args);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'skip search_path (not owner): %(%)', r.proname, r.args;
    END;
  END LOOP;
END $$;

-- (B) revoke EXECUTE on trigger functions ---------------------------------------------------------
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prorettype = 'pg_catalog.trigger'::regtype
      AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.deptype = 'e')
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM anon, authenticated, public',
                     r.proname, r.args);
    EXCEPTION WHEN insufficient_privilege THEN
      RAISE NOTICE 'skip revoke (not owner): %(%)', r.proname, r.args;
    END;
  END LOOP;
END $$;
