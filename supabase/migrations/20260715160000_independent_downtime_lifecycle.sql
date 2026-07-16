-- Independent downtime lifecycle
--
-- IMPORTANT DEPLOYMENT CONTRACT
--   This migration is intentionally file-only until the application branch is merged.
--   It supersedes the production-coupled behavior introduced by
--   20260714120000_codex_round2_fixes.sql and
--   20260715120000_atomic_downtime_save.sql.
--
-- Operational invariants:
--   1. A downtime event is an original machine event, not a child of production input.
--   2. An event may start before production is reported and may remain open (end_time NULL).
--   3. Production correction, deletion, OFF, or HOLIDAY never deletes downtime history.
--   4. Writes address one event ID and use a version precondition; no list replacement.
--   5. Reporting assigns overlapping machine_logs/manual intervals to one union. Manual
--      entries own an overlap because they carry the operator's more specific reason.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Downtime rows support an open lifecycle and optimistic concurrency.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.downtime_entries
  ALTER COLUMN end_time DROP NOT NULL,
  ALTER COLUMN duration_minutes DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1;

UPDATE public.downtime_entries
SET updated_at = COALESCE(updated_at, created_at, now())
WHERE updated_at IS NULL;

ALTER TABLE public.downtime_entries
  ALTER COLUMN updated_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET NOT NULL;

DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'downtime_entries_version_positive'
      AND conrelid = 'public.downtime_entries'::regclass
  ) THEN
    ALTER TABLE public.downtime_entries
      ADD CONSTRAINT downtime_entries_version_positive CHECK (version > 0);
  END IF;
END;
$constraint$;

CREATE INDEX IF NOT EXISTS idx_downtime_entries_machine_interval
  ON public.downtime_entries (machine_id, start_time, end_time);

CREATE OR REPLACE FUNCTION public.validate_downtime_entry_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.start_time IS NULL THEN
    RAISE EXCEPTION 'downtime start_time is required'
      USING ERRCODE = '23502';
  END IF;

  IF NEW.end_time IS NOT NULL AND NEW.end_time <= NEW.start_time THEN
    RAISE EXCEPTION 'downtime end_time must be later than start_time'
      USING ERRCODE = '22007';
  END IF;

  -- Validate real time overlap across the whole machine timeline. date/shift are reporting
  -- labels for the start of an event; they must not hide a cross-day/cross-shift collision.
  IF EXISTS (
    SELECT 1
    FROM public.downtime_entries existing
    WHERE existing.machine_id = NEW.machine_id
      AND existing.id IS DISTINCT FROM NEW.id
      AND tstzrange(
            existing.start_time,
            COALESCE(existing.end_time, 'infinity'::timestamptz),
            '[)'
          ) && tstzrange(
            NEW.start_time,
            COALESCE(NEW.end_time, 'infinity'::timestamptz),
            '[)'
          )
  ) THEN
    RAISE EXCEPTION 'downtime entry overlaps an existing event for this machine'
      USING ERRCODE = '23P01';
  END IF;

  IF NEW.end_time IS NULL THEN
    NEW.duration_minutes := NULL;
  ELSE
    NEW.duration_minutes := round(
      EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 60.0
    )::integer;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.version := OLD.version + 1;
    NEW.updated_at := clock_timestamp();
  ELSE
    NEW.version := COALESCE(NEW.version, 1);
    NEW.updated_at := COALESCE(NEW.updated_at, clock_timestamp());
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_downtime_entry_before_write
  ON public.downtime_entries;

CREATE TRIGGER validate_downtime_entry_before_write
BEFORE INSERT OR UPDATE OF machine_id, date, shift, start_time, end_time,
  reason, description, operator_id
ON public.downtime_entries
FOR EACH ROW
EXECUTE FUNCTION public.validate_downtime_entry_write();

COMMENT ON COLUMN public.downtime_entries.end_time IS
  'NULL while the machine event is ongoing. Close the same event ID when operation resumes.';
COMMENT ON COLUMN public.downtime_entries.version IS
  'Optimistic concurrency token. PATCH/DELETE must include the version last read by the client.';

-- Soft deactivation is an operational stop. Close any open status/downtime intervals in the
-- same transaction so inactive equipment cannot accumulate an infinite ongoing event.
CREATE OR REPLACE FUNCTION public.close_machine_activity_on_deactivation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
BEGIN
  IF NOT NEW.is_active THEN
    UPDATE public.machine_logs ml
    SET end_time = v_now,
        duration = GREATEST(
          0,
          round(EXTRACT(EPOCH FROM (v_now - ml.start_time)) / 60.0)::integer
        )
    WHERE ml.machine_id = NEW.id
      AND ml.end_time IS NULL
      AND ml.start_time < v_now;

    UPDATE public.downtime_entries de
    SET end_time = v_now
    WHERE de.machine_id = NEW.id
      AND de.end_time IS NULL
      AND de.start_time < v_now;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS close_machine_activity_after_deactivation
  ON public.machines;
DROP TRIGGER IF EXISTS zz_close_machine_activity_when_inactive
  ON public.machines;
-- PostgreSQL runs same-kind triggers alphabetically. The zz prefix makes this run after the
-- existing machines_status_change_trigger, closing any status log that trigger may open.
CREATE TRIGGER zz_close_machine_activity_when_inactive
AFTER UPDATE OF is_active, current_state ON public.machines
FOR EACH ROW
WHEN (
  NOT NEW.is_active
  AND (
    OLD.is_active IS DISTINCT FROM NEW.is_active
    OR OLD.current_state IS DISTINCT FROM NEW.current_state
  )
)
EXECUTE FUNCTION public.close_machine_activity_on_deactivation();

-- The trigger only protects future deactivations. Close legacy open intervals for machines
-- that were already inactive when this migration starts, before the write RPCs below begin
-- rejecting those machines. Both statements are idempotent because they only touch open rows.
UPDATE public.machine_logs ml
SET end_time = statement_timestamp(),
    duration = GREATEST(
      0,
      round(EXTRACT(EPOCH FROM (statement_timestamp() - ml.start_time)) / 60.0)::integer
    )
FROM public.machines m
WHERE m.id = ml.machine_id
  AND NOT m.is_active
  AND ml.end_time IS NULL
  AND ml.start_time < statement_timestamp();

UPDATE public.downtime_entries de
SET end_time = statement_timestamp()
FROM public.machines m
WHERE m.id = de.machine_id
  AND NOT m.is_active
  AND de.end_time IS NULL
  AND de.start_time < statement_timestamp();

-- One-event write API. Passing p_id=NULL creates a server-ID row. A client-generated p_id is
-- accepted for offline retry safety. Existing rows require p_expected_version.
CREATE OR REPLACE FUNCTION public.upsert_downtime_entry(
  p_id uuid,
  p_machine_id uuid,
  p_date date,
  p_shift text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_reason text,
  p_description text DEFAULT NULL::text,
  p_operator_id uuid DEFAULT NULL::uuid,
  p_expected_version bigint DEFAULT NULL::bigint
)
RETURNS public.downtime_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.downtime_entries%ROWTYPE;
  v_machine_active boolean;
BEGIN
  IF p_machine_id IS NULL OR p_date IS NULL OR p_shift NOT IN ('A', 'B')
     OR p_start_time IS NULL OR NULLIF(btrim(p_reason), '') IS NULL THEN
    RAISE EXCEPTION 'machine_id, date, shift, start_time, and reason are required'
      USING ERRCODE = '22023';
  END IF;

  -- Serialize all downtime writes for one machine before the overlap trigger runs.
  -- The advisory lock also covers callers that retry with a client-generated ID,
  -- while the machine row lock gives the following INSERT/UPDATE a fresh view of
  -- any downtime committed by a concurrent writer that was waiting ahead of it.
  PERFORM pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
  SELECT m.is_active INTO v_machine_active
  FROM public.machines m
  WHERE m.id = p_machine_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MACHINE_NOT_FOUND'
      USING ERRCODE = '23503';
  END IF;
  IF NOT v_machine_active THEN
    RAISE EXCEPTION 'MACHINE_INACTIVE'
      USING ERRCODE = '55000';
  END IF;

  IF p_id IS NULL THEN
    INSERT INTO public.downtime_entries (
      machine_id, date, shift, start_time, end_time,
      reason, description, operator_id
    ) VALUES (
      p_machine_id, p_date, p_shift, p_start_time, p_end_time,
      btrim(p_reason), NULLIF(btrim(p_description), ''), p_operator_id
    )
    RETURNING * INTO v_row;
    RETURN v_row;
  END IF;

  IF p_expected_version IS NULL THEN
    -- A supplied ID without a version means an idempotent create attempt, never an
    -- unguarded update of somebody else's newer row.
    INSERT INTO public.downtime_entries (
      id, machine_id, date, shift, start_time, end_time,
      reason, description, operator_id
    ) VALUES (
      p_id, p_machine_id, p_date, p_shift, p_start_time, p_end_time,
      btrim(p_reason), NULLIF(btrim(p_description), ''), p_operator_id
    )
    ON CONFLICT (id) DO NOTHING
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      SELECT * INTO v_row
      FROM public.downtime_entries de
      WHERE de.id = p_id;

      -- A create response may be lost after commit. Replaying the same client ID and
      -- payload is a successful idempotent retry; a different payload using that ID
      -- remains a version conflict.
      IF FOUND
         AND v_row.machine_id = p_machine_id
         AND v_row.date = p_date
         AND v_row.shift = p_shift
         AND v_row.start_time = p_start_time
         AND v_row.end_time IS NOT DISTINCT FROM p_end_time
         AND v_row.reason = btrim(p_reason)
         AND v_row.description IS NOT DISTINCT FROM NULLIF(btrim(p_description), '')
         AND v_row.operator_id IS NOT DISTINCT FROM p_operator_id THEN
        RETURN v_row;
      END IF;

      RAISE EXCEPTION 'DOWNTIME_VERSION_CONFLICT'
        USING ERRCODE = '40001';
    END IF;
    RETURN v_row;
  END IF;

  UPDATE public.downtime_entries de
  SET machine_id = p_machine_id,
      date = p_date,
      shift = p_shift,
      start_time = p_start_time,
      end_time = p_end_time,
      reason = btrim(p_reason),
      description = NULLIF(btrim(p_description), ''),
      operator_id = p_operator_id
  WHERE de.id = p_id
    AND de.version = p_expected_version
  RETURNING de.* INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DOWNTIME_VERSION_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  RETURN v_row;
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_downtime_entry(
  p_id uuid,
  p_expected_version bigint
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.downtime_entries%ROWTYPE;
BEGIN
  IF p_id IS NULL OR p_expected_version IS NULL THEN
    RAISE EXCEPTION 'id and expected_version are required'
      USING ERRCODE = '22023';
  END IF;

  DELETE FROM public.downtime_entries de
  WHERE de.id = p_id
    AND de.version = p_expected_version
  RETURNING de.* INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DOWNTIME_VERSION_CONFLICT'
      USING ERRCODE = '40001';
  END IF;

  RETURN to_jsonb(v_row);
END;
$function$;

REVOKE ALL ON FUNCTION public.upsert_downtime_entry(
  uuid, uuid, date, text, timestamptz, timestamptz, text, text, uuid, bigint
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_downtime_entry(
  uuid, uuid, date, text, timestamptz, timestamptz, text, text, uuid, bigint
) TO service_role;

REVOKE ALL ON FUNCTION public.delete_downtime_entry(uuid, bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_downtime_entry(uuid, bigint)
  TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. A shift's operating status is persistent data, not inferred from row absence.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.production_shift_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id uuid NOT NULL REFERENCES public.machines(id) ON DELETE CASCADE,
  date date NOT NULL,
  shift text NOT NULL CHECK (shift IN ('A', 'B')),
  status text NOT NULL CHECK (status IN ('WORKING', 'OFF', 'HOLIDAY', 'MISSING')),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (machine_id, date, shift)
);

ALTER TABLE public.production_shift_states ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.production_shift_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.production_shift_states TO service_role;

COMMENT ON TABLE public.production_shift_states IS
  'Persistent schedule/entry state. MISSING is distinct from OFF/HOLIDAY and from a WORKING production record.';

-- Existing production rows are known WORKING observations. Absence alone cannot be safely
-- backfilled as OFF/HOLIDAY/MISSING, so those states begin when explicitly recorded.
INSERT INTO public.production_shift_states (machine_id, date, shift, status)
SELECT DISTINCT pr.machine_id, pr.date, pr.shift, 'WORKING'
FROM public.production_records pr
WHERE pr.shift IN ('A', 'B')
ON CONFLICT (machine_id, date, shift) DO NOTHING;

-- Keep the state table correct for every production_records writer, including legacy/direct
-- API routes that do not call save_daily_production yet.
CREATE OR REPLACE FUNCTION public.sync_production_shift_state_from_record()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_record public.production_records%ROWTYPE;
  v_status text;
BEGIN
  v_record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_status := CASE WHEN TG_OP = 'DELETE' THEN 'MISSING' ELSE 'WORKING' END;

  INSERT INTO public.production_shift_states (machine_id, date, shift, status)
  VALUES (v_record.machine_id, v_record.date, v_record.shift, v_status)
  ON CONFLICT (machine_id, date, shift) DO UPDATE SET
    status = EXCLUDED.status,
    updated_at = clock_timestamp(),
    version = public.production_shift_states.version + 1;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

DROP TRIGGER IF EXISTS sync_production_shift_state_after_write
  ON public.production_records;
CREATE TRIGGER sync_production_shift_state_after_write
AFTER INSERT OR UPDATE OR DELETE ON public.production_records
FOR EACH ROW
EXECUTE FUNCTION public.sync_production_shift_state_from_record();

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Production writes maintain shift state but never mutate downtime events.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.save_daily_production(
  p_machine_id uuid,
  p_date date,
  p_day_shift_off boolean DEFAULT false,
  p_night_shift_off boolean DEFAULT false,
  p_day_record jsonb DEFAULT NULL::jsonb,
  p_night_record jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_saved jsonb := '[]'::jsonb;
  v_deleted jsonb := '[]'::jsonb;
  v_states jsonb := '[]'::jsonb;
  v_shift text;
  v_shift_off boolean;
  v_record jsonb;
  v_deleted_count integer;
  v_status text;
  v_row public.production_records%ROWTYPE;
  v_state_row public.production_shift_states%ROWTYPE;
  v_machine_active boolean;
BEGIN
  IF p_machine_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'machine_id and date are required'
      USING ERRCODE = '22023';
  END IF;

  SELECT m.is_active INTO v_machine_active
  FROM public.machines m
  WHERE m.id = p_machine_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'MACHINE_NOT_FOUND' USING ERRCODE = '23503';
  END IF;
  IF NOT v_machine_active THEN
    RAISE EXCEPTION 'MACHINE_INACTIVE' USING ERRCODE = '55000';
  END IF;

  FOREACH v_shift IN ARRAY ARRAY['A', 'B'] LOOP
    IF v_shift = 'A' THEN
      v_shift_off := COALESCE(p_day_shift_off, false);
      v_record := p_day_record;
    ELSE
      v_shift_off := COALESCE(p_night_shift_off, false);
      v_record := p_night_record;
    END IF;

    IF v_shift_off THEN
      WITH deleted AS (
        DELETE FROM public.production_records pr
        WHERE pr.machine_id = p_machine_id
          AND pr.date = p_date
          AND pr.shift = v_shift
        RETURNING pr.record_id
      )
      SELECT count(*) INTO v_deleted_count FROM deleted;

      IF v_deleted_count > 0 THEN
        v_deleted := v_deleted || to_jsonb(v_shift);
      END IF;

      v_status := CASE
        WHEN COALESCE(p_day_shift_off, false) AND COALESCE(p_night_shift_off, false)
          THEN 'HOLIDAY'
        ELSE 'OFF'
      END;

    ELSIF v_record IS NOT NULL THEN
      INSERT INTO public.production_records (
        machine_id, date, shift,
        planned_runtime, actual_runtime, ideal_runtime,
        output_qty, defect_qty,
        availability, performance, quality, oee,
        downtime_minutes,
        tact_time_seconds, cavity_count
      ) VALUES (
        p_machine_id, p_date, v_shift,
        (v_record ->> 'planned_runtime')::integer,
        (v_record ->> 'actual_runtime')::integer,
        (v_record ->> 'ideal_runtime')::integer,
        (v_record ->> 'output_qty')::integer,
        (v_record ->> 'defect_qty')::integer,
        (v_record ->> 'availability')::numeric,
        (v_record ->> 'performance')::numeric,
        (v_record ->> 'quality')::numeric,
        (v_record ->> 'oee')::numeric,
        (v_record ->> 'downtime_minutes')::integer,
        (v_record ->> 'tact_time_seconds')::numeric,
        (v_record ->> 'cavity_count')::integer
      )
      ON CONFLICT (machine_id, date, shift) DO UPDATE SET
        planned_runtime   = EXCLUDED.planned_runtime,
        actual_runtime    = EXCLUDED.actual_runtime,
        ideal_runtime     = EXCLUDED.ideal_runtime,
        output_qty        = EXCLUDED.output_qty,
        defect_qty        = EXCLUDED.defect_qty,
        availability      = EXCLUDED.availability,
        performance       = EXCLUDED.performance,
        quality           = EXCLUDED.quality,
        oee               = EXCLUDED.oee,
        downtime_minutes  = EXCLUDED.downtime_minutes,
        tact_time_seconds = COALESCE(public.production_records.tact_time_seconds, EXCLUDED.tact_time_seconds),
        cavity_count      = COALESCE(public.production_records.cavity_count, EXCLUDED.cavity_count)
      RETURNING * INTO v_row;

      v_saved := v_saved || to_jsonb(v_row);
      v_status := 'WORKING';

    ELSIF EXISTS (
      SELECT 1
      FROM public.production_records pr
      WHERE pr.machine_id = p_machine_id
        AND pr.date = p_date
        AND pr.shift = v_shift
    ) THEN
      v_status := 'WORKING';
    ELSE
      v_status := 'MISSING';
    END IF;

    INSERT INTO public.production_shift_states (
      machine_id, date, shift, status
    ) VALUES (
      p_machine_id, p_date, v_shift, v_status
    )
    ON CONFLICT (machine_id, date, shift) DO UPDATE SET
      status = EXCLUDED.status,
      updated_at = clock_timestamp(),
      version = public.production_shift_states.version + 1
    RETURNING * INTO v_state_row;

    v_states := v_states || to_jsonb(v_state_row);
  END LOOP;

  RETURN jsonb_build_object(
    'saved_records', v_saved,
    'deleted_shifts', v_deleted,
    'shift_states', v_states
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.delete_production_record(p_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_row public.production_records%ROWTYPE;
BEGIN
  SELECT * INTO v_row
  FROM public.production_records
  WHERE record_id = p_record_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECORD_NOT_FOUND';
  END IF;

  DELETE FROM public.production_records
  WHERE record_id = p_record_id;

  INSERT INTO public.production_shift_states (
    machine_id, date, shift, status
  ) VALUES (
    v_row.machine_id, v_row.date, v_row.shift, 'MISSING'
  )
  ON CONFLICT (machine_id, date, shift) DO UPDATE SET
    status = 'MISSING',
    updated_at = clock_timestamp(),
    version = public.production_shift_states.version + 1;

  RETURN jsonb_build_object(
    'record_id', v_row.record_id,
    'machine_id', v_row.machine_id,
    'date', v_row.date,
    'shift', v_row.shift,
    'output_qty', v_row.output_qty,
    'deleted_downtime_entries', 0,
    'shift_status', 'MISSING'
  );
END;
$function$;

-- Compatibility wrapper for a DB-first rolling deploy. Legacy arrays are imported additively:
-- they never replace/delete independent events, and exact retries reuse the existing row.
CREATE OR REPLACE FUNCTION public.save_daily_production_with_downtime(
  p_machine_id uuid,
  p_date date,
  p_day_shift_off boolean DEFAULT false,
  p_night_shift_off boolean DEFAULT false,
  p_day_record jsonb DEFAULT NULL::jsonb,
  p_night_record jsonb DEFAULT NULL::jsonb,
  p_day_downtime_entries jsonb DEFAULT NULL::jsonb,
  p_night_downtime_entries jsonb DEFAULT NULL::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_result jsonb;
  v_saved_downtime jsonb := '[]'::jsonb;
  v_shift text;
  v_entries jsonb;
  v_item jsonb;
  v_entry_row public.downtime_entries%ROWTYPE;
BEGIN
  v_result := public.save_daily_production(
    p_machine_id,
    p_date,
    p_day_shift_off,
    p_night_shift_off,
    p_day_record,
    p_night_record
  );

  FOREACH v_shift IN ARRAY ARRAY['A', 'B'] LOOP
    v_entries := CASE
      WHEN v_shift = 'A' THEN p_day_downtime_entries
      ELSE p_night_downtime_entries
    END;

    IF v_entries IS NULL THEN
      CONTINUE;
    END IF;
    IF jsonb_typeof(v_entries) <> 'array' THEN
      RAISE EXCEPTION 'downtime entries for shift % must be a JSON array', v_shift
        USING ERRCODE = '22023';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(v_entries) LOOP
      IF COALESCE(btrim(v_item ->> 'reason'), '') = ''
         OR COALESCE(v_item ->> 'start_time', '') = '' THEN
        RAISE EXCEPTION 'downtime start_time and reason are required for shift %', v_shift
          USING ERRCODE = '22023';
      END IF;

      SELECT * INTO v_entry_row
      FROM public.downtime_entries de
      WHERE de.machine_id = p_machine_id
        AND de.start_time = (v_item ->> 'start_time')::timestamptz
        AND de.end_time IS NOT DISTINCT FROM NULLIF(v_item ->> 'end_time', '')::timestamptz
        AND de.reason = btrim(v_item ->> 'reason')
      LIMIT 1;

      IF NOT FOUND THEN
        SELECT * INTO v_entry_row
        FROM public.upsert_downtime_entry(
          NULLIF(v_item ->> 'id', '')::uuid,
          p_machine_id,
          p_date,
          v_shift,
          (v_item ->> 'start_time')::timestamptz,
          NULLIF(v_item ->> 'end_time', '')::timestamptz,
          btrim(v_item ->> 'reason'),
          NULLIF(btrim(v_item ->> 'description'), ''),
          NULLIF(v_item ->> 'operator_id', '')::uuid,
          NULL
        );
      END IF;

      v_saved_downtime := v_saved_downtime || to_jsonb(v_entry_row);
    END LOOP;
  END LOOP;

  RETURN v_result || jsonb_build_object(
    'saved_downtime_entries', v_saved_downtime,
    'downtime_write_mode', 'independent_additive_compatibility'
  );
END;
$function$;

COMMENT ON FUNCTION public.save_daily_production_with_downtime(
  uuid, date, boolean, boolean, jsonb, jsonb, jsonb, jsonb
) IS
  'DB-first rolling-deploy compatibility. Imports legacy downtime arrays additively and never replaces or deletes independent events.';

REVOKE ALL ON FUNCTION public.save_daily_production(
  uuid, date, boolean, boolean, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_daily_production(
  uuid, date, boolean, boolean, jsonb, jsonb
) TO service_role;

REVOKE ALL ON FUNCTION public.delete_production_record(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_production_record(uuid)
  TO service_role;

REVOKE ALL ON FUNCTION public.save_daily_production_with_downtime(
  uuid, date, boolean, boolean, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_daily_production_with_downtime(
  uuid, date, boolean, boolean, jsonb, jsonb, jsonb, jsonb
) TO service_role;
