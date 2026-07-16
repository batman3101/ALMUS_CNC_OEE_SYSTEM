-- This migration is intentionally an artifact only until the application branch is merged.
-- Do not apply it to the live database before the matching API/UI changes are deployed.

-- ---------------------------------------------------------------------------
-- Persist alert acknowledgement per authenticated user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.alert_acknowledgements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_key text NOT NULL,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('acknowledge', 'dismiss')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_key, user_id)
);

CREATE INDEX IF NOT EXISTS alert_acknowledgements_user_id_idx
  ON public.alert_acknowledgements (user_id, updated_at DESC);

ALTER TABLE public.alert_acknowledgements ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.alert_acknowledgements FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.alert_acknowledgements TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.alert_acknowledgements_id_seq TO service_role;

COMMENT ON TABLE public.alert_acknowledgements IS
  'Stable alert keys acknowledged or dismissed by a specific authenticated administrator/engineer.';

-- ---------------------------------------------------------------------------
-- Headline OEE uses only shifts whose downtime, planned/actual runtime, and process
-- standard (ideal runtime) are all known. Incomplete and impossible legacy records
-- remain visible through separate coverage counters instead of disappearing silently.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_oee_records_summary(
  p_start_date date,
  p_end_date date DEFAULT NULL::date,
  p_machine_id uuid DEFAULT NULL::uuid,
  p_shift text DEFAULT NULL::text
)
RETURNS TABLE(
  total_records bigint,
  avg_availability double precision,
  avg_performance double precision,
  avg_quality double precision,
  avg_oee double precision,
  total_output bigint,
  total_defect bigint,
  total_good bigint,
  total_planned_runtime bigint,
  total_actual_runtime bigint,
  total_ideal_runtime bigint,
  unreported_records bigint,
  reported_records bigint,
  avg_availability_reported double precision,
  avg_oee_reported double precision,
  impossible_records bigint,
  avg_oee_excluding_impossible double precision,
  avg_quality_excluding_impossible double precision
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH raw AS MATERIALIZED (
    SELECT
      pr.planned_runtime,
      pr.actual_runtime,
      pr.ideal_runtime,
      pr.output_qty,
      pr.defect_qty,
      pr.downtime_minutes,
      (
        COALESCE(pr.planned_runtime, 0) < 0 OR
        COALESCE(pr.actual_runtime, 0) < 0 OR
        COALESCE(pr.ideal_runtime, 0) < 0 OR
        COALESCE(pr.output_qty, 0) < 0 OR
        COALESCE(pr.defect_qty, 0) < 0 OR
        COALESCE(pr.defect_qty, 0) > COALESCE(pr.output_qty, 0) OR
        (COALESCE(pr.output_qty, 0) = 0 AND (
          COALESCE(pr.oee, 0) <> 0 OR
          COALESCE(pr.quality, 0) <> 0 OR
          COALESCE(pr.ideal_runtime, 0) <> 0
        ))
      ) AS impossible
    FROM public.production_records pr
    WHERE pr.date >= p_start_date
      AND (p_end_date IS NULL OR pr.date <= p_end_date)
      AND (p_machine_id IS NULL OR pr.machine_id = p_machine_id)
      AND (p_shift IS NULL OR pr.shift = p_shift)
      AND EXISTS (SELECT 1 FROM public.machines m WHERE m.id = pr.machine_id)
  ), base AS MATERIALIZED (
    SELECT
      raw.*,
      (
        downtime_minutes IS NOT NULL
        AND planned_runtime IS NOT NULL
        AND actual_runtime IS NOT NULL
        AND ideal_runtime IS NOT NULL
        AND NOT impossible
      ) AS oee_reported
    FROM raw
  ), trusted AS (
    SELECT *
    FROM base
    WHERE oee_reported
  ), totals AS (
    SELECT
      (SELECT count(*) FROM base)::bigint AS total_records,
      (SELECT count(*) FROM base WHERE NOT oee_reported AND NOT impossible)::bigint AS unreported_records,
      (SELECT count(*) FROM base WHERE oee_reported)::bigint AS reported_records,
      (SELECT count(*) FROM base WHERE impossible)::bigint AS impossible_records,
      COALESCE((SELECT sum(output_qty) FROM base WHERE NOT impossible), 0)::bigint AS total_output,
      COALESCE((SELECT sum(defect_qty) FROM base WHERE NOT impossible), 0)::bigint AS total_defect,
      COALESCE((SELECT sum(planned_runtime) FROM base WHERE NOT impossible), 0)::bigint AS total_planned_runtime,
      COALESCE((SELECT sum(actual_runtime) FROM base WHERE NOT impossible), 0)::bigint AS total_actual_runtime,
      COALESCE((SELECT sum(ideal_runtime) FROM base WHERE NOT impossible), 0)::bigint AS total_ideal_runtime,
      COALESCE((SELECT sum(planned_runtime) FROM trusted), 0)::float8 AS metric_planned,
      COALESCE((SELECT sum(actual_runtime) FROM trusted), 0)::float8 AS metric_actual,
      COALESCE((SELECT sum(ideal_runtime) FROM trusted), 0)::float8 AS metric_ideal,
      COALESCE((SELECT sum(output_qty) FROM trusted), 0)::float8 AS metric_output,
      COALESCE((SELECT sum(defect_qty) FROM trusted), 0)::float8 AS metric_defect
  ), metrics AS (
    SELECT
      t.*,
      CASE
        WHEN reported_records = 0 OR metric_planned <= 0 OR metric_actual < 0 THEN NULL
        ELSE LEAST(1::float8, GREATEST(0::float8, metric_actual / metric_planned))
      END AS availability,
      CASE
        WHEN reported_records = 0 OR metric_actual < 0 OR metric_ideal < 0 THEN NULL
        WHEN metric_actual = 0 THEN 0::float8
        ELSE LEAST(1::float8, GREATEST(0::float8, metric_ideal / metric_actual))
      END AS performance,
      CASE
        WHEN reported_records = 0
          OR metric_output < 0
          OR metric_defect < 0
          OR metric_defect > metric_output THEN NULL
        WHEN metric_output = 0 THEN 0::float8
        ELSE LEAST(1::float8, GREATEST(0::float8, (metric_output - metric_defect) / metric_output))
      END AS quality
    FROM totals t
  )
  SELECT
    total_records,
    availability,
    performance,
    quality,
    availability * performance * quality,
    total_output,
    total_defect,
    total_output - total_defect,
    total_planned_runtime,
    total_actual_runtime,
    total_ideal_runtime,
    unreported_records,
    reported_records,
    availability,
    availability * performance * quality,
    impossible_records,
    availability * performance * quality,
    quality
  FROM metrics;
$function$;

REVOKE ALL ON FUNCTION public.analytics_oee_records_summary(date, date, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_oee_records_summary(date, date, uuid, text)
  TO service_role;

DROP FUNCTION IF EXISTS public.analytics_oee_by_machine(date, date, uuid[], text[]);

CREATE FUNCTION public.analytics_oee_by_machine(
  p_start_date date,
  p_end_date date DEFAULT NULL::date,
  p_machine_ids uuid[] DEFAULT NULL::uuid[],
  p_shifts text[] DEFAULT NULL::text[]
)
RETURNS TABLE(
  machine_id uuid,
  total_records bigint,
  avg_availability double precision,
  avg_performance double precision,
  avg_quality double precision,
  avg_oee double precision,
  total_output bigint,
  total_defect bigint,
  unreported_records bigint,
  reported_records bigint,
  impossible_records bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH raw AS MATERIALIZED (
    SELECT
      pr.*,
      (
        COALESCE(pr.planned_runtime, 0) < 0 OR
        COALESCE(pr.actual_runtime, 0) < 0 OR
        COALESCE(pr.ideal_runtime, 0) < 0 OR
        COALESCE(pr.output_qty, 0) < 0 OR
        COALESCE(pr.defect_qty, 0) < 0 OR
        COALESCE(pr.defect_qty, 0) > COALESCE(pr.output_qty, 0) OR
        (COALESCE(pr.output_qty, 0) = 0 AND (
          COALESCE(pr.oee, 0) <> 0 OR
          COALESCE(pr.quality, 0) <> 0 OR
          COALESCE(pr.ideal_runtime, 0) <> 0
        ))
      ) AS impossible
    FROM public.production_records pr
    WHERE pr.date >= p_start_date
      AND (p_end_date IS NULL OR pr.date <= p_end_date)
      AND (p_machine_ids IS NULL OR pr.machine_id = ANY(p_machine_ids))
      AND (p_shifts IS NULL OR pr.shift = ANY(p_shifts))
      AND EXISTS (SELECT 1 FROM public.machines m WHERE m.id = pr.machine_id)
  ), base AS MATERIALIZED (
    SELECT
      raw.*,
      (
        downtime_minutes IS NOT NULL
        AND planned_runtime IS NOT NULL
        AND actual_runtime IS NOT NULL
        AND ideal_runtime IS NOT NULL
        AND NOT impossible
      ) AS oee_reported
    FROM raw
  ), grouped AS (
    SELECT
      machine_id,
      count(*)::bigint AS total_records,
      count(*) FILTER (WHERE NOT oee_reported AND NOT impossible)::bigint AS unreported_records,
      count(*) FILTER (WHERE oee_reported)::bigint AS reported_records,
      count(*) FILTER (WHERE impossible)::bigint AS impossible_records,
      COALESCE(sum(planned_runtime) FILTER (WHERE oee_reported), 0)::float8 AS planned_runtime,
      COALESCE(sum(actual_runtime) FILTER (WHERE oee_reported), 0)::float8 AS actual_runtime,
      COALESCE(sum(ideal_runtime) FILTER (WHERE oee_reported), 0)::float8 AS ideal_runtime,
      COALESCE(sum(output_qty) FILTER (WHERE NOT impossible), 0)::bigint AS total_output,
      COALESCE(sum(defect_qty) FILTER (WHERE NOT impossible), 0)::bigint AS total_defect,
      COALESCE(sum(output_qty) FILTER (WHERE oee_reported), 0)::float8 AS metric_output,
      COALESCE(sum(defect_qty) FILTER (WHERE oee_reported), 0)::float8 AS metric_defect
    FROM base
    GROUP BY machine_id
  ), metrics AS (
    SELECT
      g.*,
      CASE
        WHEN reported_records = 0 OR planned_runtime <= 0 OR actual_runtime < 0 THEN NULL
        ELSE LEAST(1::float8, GREATEST(0::float8, actual_runtime / planned_runtime))
      END AS availability,
      CASE
        WHEN reported_records = 0 OR actual_runtime < 0 OR ideal_runtime < 0 THEN NULL
        WHEN actual_runtime = 0 THEN 0::float8
        ELSE LEAST(1::float8, GREATEST(0::float8, ideal_runtime / actual_runtime))
      END AS performance,
      CASE
        WHEN reported_records = 0
          OR metric_output < 0
          OR metric_defect < 0
          OR metric_defect > metric_output THEN NULL
        WHEN metric_output = 0 THEN 0::float8
        ELSE LEAST(1::float8, GREATEST(0::float8, (metric_output - metric_defect) / metric_output))
      END AS quality
    FROM grouped g
  )
  SELECT
    machine_id,
    total_records,
    availability,
    performance,
    quality,
    availability * performance * quality,
    total_output,
    total_defect,
    unreported_records,
    reported_records,
    impossible_records
  FROM metrics;
$function$;

REVOKE ALL ON FUNCTION public.analytics_oee_by_machine(date, date, uuid[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_oee_by_machine(date, date, uuid[], text[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.analytics_productivity(
  p_start_date date,
  p_end_date date,
  p_machine_ids uuid[] DEFAULT NULL,
  p_shifts text[] DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH raw AS MATERIALIZED (
  SELECT
    pr.machine_id,
    pr.date,
    pr.shift,
    pr.downtime_minutes,
    pr.planned_runtime::bigint AS planned_runtime,
    pr.actual_runtime::bigint AS actual_runtime,
    pr.ideal_runtime::bigint AS ideal_runtime,
    COALESCE(pr.output_qty, 0)::bigint AS output_qty,
    COALESCE(pr.defect_qty, 0)::bigint AS defect_qty,
    (
      COALESCE(pr.planned_runtime, 0) < 0 OR
      COALESCE(pr.actual_runtime, 0) < 0 OR
      COALESCE(pr.ideal_runtime, 0) < 0 OR
      COALESCE(pr.output_qty, 0) < 0 OR
      COALESCE(pr.defect_qty, 0) < 0 OR
      COALESCE(pr.defect_qty, 0) > COALESCE(pr.output_qty, 0) OR
      (COALESCE(pr.output_qty, 0) = 0 AND (
        COALESCE(pr.oee, 0) <> 0 OR
        COALESCE(pr.quality, 0) <> 0 OR
        COALESCE(pr.ideal_runtime, 0) <> 0
      ))
    ) AS invalid,
    CASE WHEN COALESCE(m.name, '') = '' THEN 'Unknown' ELSE m.name END AS machine_name,
    CASE WHEN COALESCE(m.equipment_type, '') = '' THEN 'Unknown' ELSE m.equipment_type END AS equipment_type
  FROM public.production_records pr
  JOIN public.machines m ON m.id = pr.machine_id
  WHERE pr.date >= p_start_date
    AND pr.date <= p_end_date
    AND (p_machine_ids IS NULL OR pr.machine_id = ANY(p_machine_ids))
    AND (p_shifts IS NULL OR pr.shift = ANY(p_shifts))
), base AS MATERIALIZED (
  SELECT
    raw.*,
    (
      downtime_minutes IS NOT NULL
      AND planned_runtime IS NOT NULL
      AND actual_runtime IS NOT NULL
      AND ideal_runtime IS NOT NULL
      AND NOT invalid
    ) AS oee_reported
  FROM raw
), scan AS (
  SELECT * FROM base WHERE oee_reported AND NOT invalid
), coverage AS (
  SELECT
    count(*)::bigint AS total_records,
    count(*) FILTER (WHERE NOT oee_reported AND NOT invalid)::bigint AS unreported_records,
    count(*) FILTER (WHERE oee_reported AND NOT invalid)::bigint AS reported_records,
    count(*) FILTER (WHERE invalid)::bigint AS invalid_records
  FROM base
), totals AS (
  SELECT
    count(*)::bigint AS records_count,
    count(*) FILTER (WHERE oee_reported AND NOT invalid)::bigint AS reported_records,
    count(*) FILTER (WHERE NOT oee_reported AND NOT invalid)::bigint AS unreported_records,
    count(*) FILTER (WHERE invalid)::bigint AS invalid_records,
    COALESCE(sum(planned_runtime) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS total_planned_runtime,
    COALESCE(sum(actual_runtime) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS total_actual_runtime,
    COALESCE(sum(ideal_runtime) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS total_ideal_runtime,
    COALESCE(sum(output_qty) FILTER (WHERE NOT invalid), 0)::bigint AS total_output_qty,
    COALESCE(sum(defect_qty) FILTER (WHERE NOT invalid), 0)::bigint AS total_defect_qty,
    COALESCE(sum(output_qty) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS reported_output_qty,
    COALESCE(sum(defect_qty) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS reported_defect_qty,
    count(DISTINCT machine_id)::int AS unique_machines,
    count(DISTINCT shift)::int AS shifts_analyzed
  FROM base
), machine_shift AS (
  SELECT
    machine_id,
    shift,
    count(*)::bigint AS reported_records,
    COALESCE(sum(planned_runtime), 0)::float8 AS planned_runtime,
    COALESCE(sum(actual_runtime), 0)::float8 AS actual_runtime,
    COALESCE(sum(ideal_runtime), 0)::float8 AS ideal_runtime,
    COALESCE(sum(output_qty), 0)::float8 AS output_qty,
    COALESCE(sum(defect_qty), 0)::float8 AS defect_qty
  FROM scan
  GROUP BY machine_id, shift
), machine_shift_metrics AS (
  SELECT
    machine_id,
    shift,
    CASE
      WHEN reported_records = 0 OR planned_runtime <= 0 OR actual_runtime < 0 THEN NULL
      ELSE LEAST(1::float8, GREATEST(0::float8, actual_runtime / planned_runtime))
    END
      * CASE
          WHEN reported_records = 0 OR actual_runtime < 0 OR ideal_runtime < 0 THEN NULL
          WHEN actual_runtime = 0 THEN 0::float8
          ELSE LEAST(1::float8, GREATEST(0::float8, ideal_runtime / actual_runtime))
        END
      * CASE
          WHEN reported_records = 0
            OR output_qty < 0
            OR defect_qty < 0
            OR defect_qty > output_qty THEN NULL
          WHEN output_qty = 0 THEN 0::float8
          ELSE LEAST(1::float8, GREATEST(0::float8, (output_qty - defect_qty) / output_qty))
        END AS oee
  FROM machine_shift
), machine_shift_rank AS (
  SELECT
    machine_id,
    (array_agg(shift ORDER BY oee DESC, shift ASC) FILTER (WHERE oee IS NOT NULL))[1] AS best_shift,
    (array_agg(shift ORDER BY oee ASC, shift DESC) FILTER (WHERE oee IS NOT NULL))[1] AS worst_shift
  FROM machine_shift_metrics
  GROUP BY machine_id
), machines_agg AS (
  SELECT
    b.machine_id,
    min(b.machine_name) AS machine_name,
    min(b.equipment_type) AS equipment_type,
    count(*)::bigint AS records_count,
    count(*) FILTER (WHERE b.oee_reported AND NOT b.invalid)::bigint AS reported_records,
    count(*) FILTER (WHERE NOT b.oee_reported AND NOT b.invalid)::bigint AS unreported_records,
    count(*) FILTER (WHERE b.invalid)::bigint AS invalid_records,
    COALESCE(sum(b.planned_runtime) FILTER (WHERE b.oee_reported AND NOT b.invalid), 0)::bigint AS total_planned_runtime,
    COALESCE(sum(b.actual_runtime) FILTER (WHERE b.oee_reported AND NOT b.invalid), 0)::bigint AS total_actual_runtime,
    COALESCE(sum(b.ideal_runtime) FILTER (WHERE b.oee_reported AND NOT b.invalid), 0)::bigint AS total_ideal_runtime,
    COALESCE(sum(b.output_qty) FILTER (WHERE NOT b.invalid), 0)::bigint AS total_output,
    COALESCE(sum(b.defect_qty) FILTER (WHERE NOT b.invalid), 0)::bigint AS total_defect_qty,
    COALESCE(sum(b.output_qty - b.defect_qty) FILTER (WHERE NOT b.invalid), 0)::bigint AS total_good_qty,
    COALESCE(sum(b.output_qty) FILTER (WHERE b.oee_reported AND NOT b.invalid), 0)::bigint AS reported_output,
    COALESCE(sum(b.defect_qty) FILTER (WHERE b.oee_reported AND NOT b.invalid), 0)::bigint AS reported_defect_qty
  FROM base b
  GROUP BY b.machine_id
), shifts_agg AS (
  SELECT
    shift,
    count(*)::bigint AS records_count,
    count(*) FILTER (WHERE oee_reported AND NOT invalid)::bigint AS reported_records,
    count(*) FILTER (WHERE NOT oee_reported AND NOT invalid)::bigint AS unreported_records,
    count(*) FILTER (WHERE invalid)::bigint AS invalid_records,
    COALESCE(sum(planned_runtime) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS total_planned_runtime,
    COALESCE(sum(actual_runtime) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS total_actual_runtime,
    COALESCE(sum(ideal_runtime) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS total_ideal_runtime,
    COALESCE(sum(output_qty) FILTER (WHERE NOT invalid), 0)::bigint AS total_output,
    COALESCE(sum(defect_qty) FILTER (WHERE NOT invalid), 0)::bigint AS total_defect_qty,
    COALESCE(sum(output_qty - defect_qty) FILTER (WHERE NOT invalid), 0)::bigint AS total_good_qty,
    COALESCE(sum(output_qty) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS reported_output,
    COALESCE(sum(defect_qty) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS reported_defect_qty,
    count(DISTINCT machine_id)::int AS machines_count
  FROM base
  GROUP BY shift
), daily_agg AS (
  SELECT
    date,
    count(*)::bigint AS records_count,
    count(*) FILTER (WHERE oee_reported AND NOT invalid)::bigint AS reported_records,
    count(*) FILTER (WHERE NOT oee_reported AND NOT invalid)::bigint AS unreported_records,
    count(*) FILTER (WHERE invalid)::bigint AS invalid_records,
    COALESCE(sum(planned_runtime) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS total_planned_runtime,
    COALESCE(sum(actual_runtime) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS total_actual_runtime,
    COALESCE(sum(ideal_runtime) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS total_ideal_runtime,
    COALESCE(sum(output_qty) FILTER (WHERE NOT invalid), 0)::bigint AS total_output,
    COALESCE(sum(defect_qty) FILTER (WHERE NOT invalid), 0)::bigint AS total_defect_qty,
    COALESCE(sum(output_qty - defect_qty) FILTER (WHERE NOT invalid), 0)::bigint AS total_good_qty,
    COALESCE(sum(output_qty) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS reported_output,
    COALESCE(sum(defect_qty) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint AS reported_defect_qty,
    count(DISTINCT machine_id)::int AS active_machines
  FROM base
  GROUP BY date
)
SELECT json_build_object(
  'reporting_coverage', (SELECT row_to_json(c) FROM coverage c),
  'totals', (SELECT row_to_json(t) FROM totals t),
  'machines', COALESCE((
    SELECT json_agg(row_to_json(x) ORDER BY x.machine_name, x.machine_id)
    FROM (
      SELECT ma.*, msr.best_shift, msr.worst_shift
      FROM machines_agg ma
      LEFT JOIN machine_shift_rank msr ON msr.machine_id = ma.machine_id
    ) x
  ), '[]'::json),
  'shifts', COALESCE((SELECT json_agg(row_to_json(s) ORDER BY s.shift) FROM shifts_agg s), '[]'::json),
  'daily', COALESCE((SELECT json_agg(row_to_json(d) ORDER BY d.date) FROM daily_agg d), '[]'::json)
);
$$;

REVOKE ALL ON FUNCTION public.analytics_productivity(date, date, uuid[], text[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_productivity(date, date, uuid[], text[])
  TO service_role;

COMMENT ON FUNCTION public.analytics_productivity(date, date, uuid[], text[]) IS
  'Returns trusted OEE only from complete runtime/process-standard rows and separates incomplete and invalid coverage counts.';

-- Daily rollups expose additive runtime/output components. The API can safely roll
-- these rows into weeks, months, and years without averaging averages or inventing
-- a 480-minute fallback for missing schedule data.
CREATE OR REPLACE FUNCTION public.analytics_oee_daily(
  p_start_date date,
  p_machine_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, pg_temp
SET extra_float_digits = 3
AS $$
  SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.date), '[]'::json)
  FROM (
    SELECT
      date,
      count(*)::bigint AS records_count,
      count(*) FILTER (WHERE oee_reported AND NOT invalid)::bigint AS reported_records,
      count(*) FILTER (WHERE NOT oee_reported AND NOT invalid)::bigint AS unreported_records,
      count(*) FILTER (WHERE invalid)::bigint AS invalid_records,
      COALESCE(sum(planned_runtime) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint
        AS total_planned_runtime,
      COALESCE(sum(actual_runtime) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint
        AS total_actual_runtime,
      COALESCE(sum(ideal_runtime) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint
        AS total_ideal_runtime,
      COALESCE(sum(output_qty) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint
        AS metric_output,
      COALESCE(sum(defect_qty) FILTER (WHERE oee_reported AND NOT invalid), 0)::bigint
        AS metric_defects,
      COALESCE(sum(output_qty) FILTER (WHERE NOT invalid), 0)::bigint AS total_output,
      COALESCE(sum(defect_qty) FILTER (WHERE NOT invalid), 0)::bigint AS total_defects
    FROM (
      SELECT
        raw.*,
        (
          downtime_minutes IS NOT NULL
          AND planned_runtime IS NOT NULL
          AND actual_runtime IS NOT NULL
          AND ideal_runtime IS NOT NULL
          AND NOT invalid
        ) AS oee_reported
      FROM (
        SELECT
          pr.*,
          (
            COALESCE(pr.planned_runtime, 0) < 0 OR
            COALESCE(pr.actual_runtime, 0) < 0 OR
            COALESCE(pr.ideal_runtime, 0) < 0 OR
            COALESCE(pr.output_qty, 0) < 0 OR
            COALESCE(pr.defect_qty, 0) < 0 OR
            COALESCE(pr.defect_qty, 0) > COALESCE(pr.output_qty, 0) OR
            (COALESCE(pr.output_qty, 0) = 0 AND (
              COALESCE(pr.oee, 0) <> 0 OR
              COALESCE(pr.quality, 0) <> 0 OR
              COALESCE(pr.ideal_runtime, 0) <> 0
            ))
          ) AS invalid
        FROM public.production_records pr
        WHERE pr.date >= p_start_date
          AND (p_machine_id IS NULL OR pr.machine_id = p_machine_id)
          AND EXISTS (SELECT 1 FROM public.machines m WHERE m.id = pr.machine_id)
      ) raw
    ) base
    GROUP BY date
  ) d;
$$;

REVOKE ALL ON FUNCTION public.analytics_oee_daily(date, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_oee_daily(date, uuid)
  TO service_role;

COMMENT ON FUNCTION public.analytics_oee_daily(date, uuid) IS
  'Returns additive trusted OEE components plus incomplete/invalid coverage; never substitutes a default runtime or process standard.';
