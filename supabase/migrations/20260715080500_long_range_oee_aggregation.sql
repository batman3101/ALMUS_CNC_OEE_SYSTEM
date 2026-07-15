-- 장기 기간(3개월 이상) 전체 설비 OEE를 원본 행 전송 없이 정확히 집계한다.
--
-- 레코드별 OEE/가동률/성능/품질의 단순 평균은 교대별 계획시간과 생산량 차이를
-- 무시한다. 아래 함수들은 누적 시간·수량으로 각 구성요소를 계산하고, 반환 행은
-- 전체 1행 / 설비당 1행 / 날짜당 1행 수준으로 제한해 PostgREST max_rows와 분리한다.

-- ---------------------------------------------------------------------------
-- 전체 범위 요약 (/api/oee-data)
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.analytics_oee_records_summary(date, date, uuid, text);

CREATE FUNCTION public.analytics_oee_records_summary(
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
  WITH totals AS (
    SELECT
      count(*)::bigint AS total_records,
      COALESCE(sum(pr.planned_runtime), 0)::float8 AS planned_runtime,
      COALESCE(sum(pr.actual_runtime), 0)::float8 AS actual_runtime,
      COALESCE(sum(pr.ideal_runtime), 0)::float8 AS ideal_runtime,
      COALESCE(sum(pr.output_qty), 0)::bigint AS total_output,
      COALESCE(sum(pr.defect_qty), 0)::bigint AS total_defect,
      count(*) FILTER (
        WHERE COALESCE(pr.output_qty, 0) <= 0
          AND (COALESCE(pr.oee, 0) <> 0 OR COALESCE(pr.quality, 0) <> 0 OR COALESCE(pr.ideal_runtime, 0) <> 0)
      )::bigint AS impossible_records,
      COALESCE(sum(pr.planned_runtime) FILTER (
        WHERE NOT (COALESCE(pr.output_qty, 0) <= 0
          AND (COALESCE(pr.oee, 0) <> 0 OR COALESCE(pr.quality, 0) <> 0 OR COALESCE(pr.ideal_runtime, 0) <> 0))
      ), 0)::float8 AS valid_planned,
      COALESCE(sum(pr.actual_runtime) FILTER (
        WHERE NOT (COALESCE(pr.output_qty, 0) <= 0
          AND (COALESCE(pr.oee, 0) <> 0 OR COALESCE(pr.quality, 0) <> 0 OR COALESCE(pr.ideal_runtime, 0) <> 0))
      ), 0)::float8 AS valid_actual,
      COALESCE(sum(pr.ideal_runtime) FILTER (
        WHERE NOT (COALESCE(pr.output_qty, 0) <= 0
          AND (COALESCE(pr.oee, 0) <> 0 OR COALESCE(pr.quality, 0) <> 0 OR COALESCE(pr.ideal_runtime, 0) <> 0))
      ), 0)::float8 AS valid_ideal,
      COALESCE(sum(pr.output_qty) FILTER (
        WHERE NOT (COALESCE(pr.output_qty, 0) <= 0
          AND (COALESCE(pr.oee, 0) <> 0 OR COALESCE(pr.quality, 0) <> 0 OR COALESCE(pr.ideal_runtime, 0) <> 0))
      ), 0)::float8 AS valid_output,
      COALESCE(sum(pr.defect_qty) FILTER (
        WHERE NOT (COALESCE(pr.output_qty, 0) <= 0
          AND (COALESCE(pr.oee, 0) <> 0 OR COALESCE(pr.quality, 0) <> 0 OR COALESCE(pr.ideal_runtime, 0) <> 0))
      ), 0)::float8 AS valid_defect,
      count(*) FILTER (WHERE pr.downtime_minutes IS NULL)::bigint AS unreported_records,
      count(*) FILTER (WHERE pr.downtime_minutes IS NOT NULL)::bigint AS reported_records,
      COALESCE(sum(pr.planned_runtime) FILTER (WHERE pr.downtime_minutes IS NOT NULL AND NOT (
        COALESCE(pr.output_qty, 0) <= 0 AND (COALESCE(pr.oee, 0) <> 0 OR COALESCE(pr.quality, 0) <> 0 OR COALESCE(pr.ideal_runtime, 0) <> 0)
      )), 0)::float8 AS reported_planned,
      COALESCE(sum(pr.actual_runtime) FILTER (WHERE pr.downtime_minutes IS NOT NULL AND NOT (
        COALESCE(pr.output_qty, 0) <= 0 AND (COALESCE(pr.oee, 0) <> 0 OR COALESCE(pr.quality, 0) <> 0 OR COALESCE(pr.ideal_runtime, 0) <> 0)
      )), 0)::float8 AS reported_actual,
      COALESCE(sum(pr.ideal_runtime) FILTER (WHERE pr.downtime_minutes IS NOT NULL AND NOT (
        COALESCE(pr.output_qty, 0) <= 0 AND (COALESCE(pr.oee, 0) <> 0 OR COALESCE(pr.quality, 0) <> 0 OR COALESCE(pr.ideal_runtime, 0) <> 0)
      )), 0)::float8 AS reported_ideal,
      COALESCE(sum(pr.output_qty) FILTER (WHERE pr.downtime_minutes IS NOT NULL AND NOT (
        COALESCE(pr.output_qty, 0) <= 0 AND (COALESCE(pr.oee, 0) <> 0 OR COALESCE(pr.quality, 0) <> 0 OR COALESCE(pr.ideal_runtime, 0) <> 0)
      )), 0)::float8 AS reported_output,
      COALESCE(sum(pr.defect_qty) FILTER (WHERE pr.downtime_minutes IS NOT NULL AND NOT (
        COALESCE(pr.output_qty, 0) <= 0 AND (COALESCE(pr.oee, 0) <> 0 OR COALESCE(pr.quality, 0) <> 0 OR COALESCE(pr.ideal_runtime, 0) <> 0)
      )), 0)::float8 AS reported_defect
    FROM production_records pr
    WHERE pr.date >= p_start_date
      AND (p_end_date   IS NULL OR pr.date       <= p_end_date)
      AND (p_machine_id IS NULL OR pr.machine_id  = p_machine_id)
      AND (p_shift      IS NULL OR pr.shift       = p_shift)
      AND EXISTS (SELECT 1 FROM machines m WHERE m.id = pr.machine_id)
  ), metrics AS (
    SELECT
      t.*,
      LEAST(1::float8, GREATEST(0::float8, t.valid_actual / NULLIF(t.valid_planned, 0))) AS availability,
      LEAST(1::float8, GREATEST(0::float8, t.valid_ideal / NULLIF(t.valid_actual, 0))) AS performance,
      LEAST(1::float8, GREATEST(0::float8, (t.valid_output - t.valid_defect) / NULLIF(t.valid_output, 0))) AS quality,
      LEAST(1::float8, GREATEST(0::float8, t.reported_actual / NULLIF(t.reported_planned, 0))) AS reported_availability,
      LEAST(1::float8, GREATEST(0::float8, t.reported_ideal / NULLIF(t.reported_actual, 0))) AS reported_performance,
      LEAST(1::float8, GREATEST(0::float8, (t.reported_output - t.reported_defect) / NULLIF(t.reported_output, 0))) AS reported_quality,
      LEAST(1::float8, GREATEST(0::float8, t.valid_actual / NULLIF(t.valid_planned, 0))) AS valid_availability,
      LEAST(1::float8, GREATEST(0::float8, t.valid_ideal / NULLIF(t.valid_actual, 0))) AS valid_performance,
      LEAST(1::float8, GREATEST(0::float8, (t.valid_output - t.valid_defect) / NULLIF(t.valid_output, 0))) AS valid_quality
    FROM totals t
  )
  SELECT
    m.total_records,
    COALESCE(m.availability, 0),
    COALESCE(m.performance, 0),
    COALESCE(m.quality, 0),
    COALESCE(m.availability * m.performance * m.quality, 0),
    m.valid_output::bigint,
    m.valid_defect::bigint,
    (m.valid_output - m.valid_defect)::bigint,
    m.valid_planned::bigint,
    m.valid_actual::bigint,
    m.valid_ideal::bigint,
    m.unreported_records,
    m.reported_records,
    COALESCE(m.reported_availability, 0),
    COALESCE(m.reported_availability * m.reported_performance * m.reported_quality, 0),
    m.impossible_records,
    COALESCE(m.valid_availability * m.valid_performance * m.valid_quality, 0),
    COALESCE(m.valid_quality, 0)
  FROM metrics m;
$function$;

REVOKE ALL ON FUNCTION public.analytics_oee_records_summary(date, date, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_oee_records_summary(date, date, uuid, text)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 설비별 요약 (/api/oee-data/by-machine)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_oee_by_machine(
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
  unreported_records bigint
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH grouped AS (
    SELECT
      pr.machine_id,
      count(*)::bigint AS total_records,
      COALESCE(sum(pr.planned_runtime), 0)::float8 AS planned_runtime,
      COALESCE(sum(pr.actual_runtime), 0)::float8 AS actual_runtime,
      COALESCE(sum(pr.ideal_runtime), 0)::float8 AS ideal_runtime,
      COALESCE(sum(pr.output_qty), 0)::bigint AS total_output,
      COALESCE(sum(pr.defect_qty), 0)::bigint AS total_defect,
      count(*) FILTER (WHERE pr.downtime_minutes IS NULL)::bigint AS unreported_records
    FROM production_records pr
    WHERE pr.date >= p_start_date
      AND (p_end_date    IS NULL OR pr.date       <= p_end_date)
      AND (p_machine_ids IS NULL OR pr.machine_id = ANY(p_machine_ids))
      AND (p_shifts      IS NULL OR pr.shift       = ANY(p_shifts))
      AND NOT (COALESCE(pr.output_qty, 0) <= 0
        AND (COALESCE(pr.oee, 0) <> 0 OR COALESCE(pr.quality, 0) <> 0 OR COALESCE(pr.ideal_runtime, 0) <> 0))
      AND EXISTS (SELECT 1 FROM machines m WHERE m.id = pr.machine_id)
    GROUP BY pr.machine_id
  ), metrics AS (
    SELECT
      g.*,
      LEAST(1::float8, GREATEST(0::float8, g.actual_runtime / NULLIF(g.planned_runtime, 0))) AS availability,
      LEAST(1::float8, GREATEST(0::float8, g.ideal_runtime / NULLIF(g.actual_runtime, 0))) AS performance,
      LEAST(1::float8, GREATEST(0::float8, (g.total_output - g.total_defect)::float8 / NULLIF(g.total_output, 0))) AS quality
    FROM grouped g
  )
  SELECT
    m.machine_id,
    m.total_records,
    COALESCE(m.availability, 0),
    COALESCE(m.performance, 0),
    COALESCE(m.quality, 0),
    COALESCE(m.availability * m.performance * m.quality, 0),
    m.total_output,
    m.total_defect,
    m.unreported_records
  FROM metrics m;
$function$;

REVOKE ALL ON FUNCTION public.analytics_oee_by_machine(date, date, uuid[], text[])
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_oee_by_machine(date, date, uuid[], text[])
  TO service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 전체/설비/교대/일별 생산성 집계 (/api/productivity-analysis)
-- ---------------------------------------------------------------------------
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
WITH scan AS (
  SELECT
    pr.machine_id,
    pr.date,
    pr.shift,
    COALESCE(pr.planned_runtime, 0)::bigint AS planned_runtime,
    COALESCE(pr.actual_runtime, 0)::bigint AS actual_runtime,
    COALESCE(pr.ideal_runtime, 0)::bigint AS ideal_runtime,
    COALESCE(pr.output_qty, 0)::bigint AS output_qty,
    COALESCE(pr.defect_qty, 0)::bigint AS defect_qty,
    CASE WHEN COALESCE(m.name, '') = '' THEN 'Unknown' ELSE m.name END AS machine_name,
    CASE WHEN COALESCE(m.equipment_type, '') = '' THEN 'Unknown' ELSE m.equipment_type END AS equipment_type
  FROM production_records pr
  JOIN machines m ON m.id = pr.machine_id
  WHERE pr.date >= p_start_date
    AND pr.date <= p_end_date
    AND (p_machine_ids IS NULL OR pr.machine_id = ANY(p_machine_ids))
    AND (p_shifts IS NULL OR pr.shift = ANY(p_shifts))
    AND NOT (COALESCE(pr.output_qty, 0) <= 0
      AND (COALESCE(pr.oee, 0) <> 0 OR COALESCE(pr.quality, 0) <> 0 OR COALESCE(pr.ideal_runtime, 0) <> 0))
), totals AS (
  SELECT
    count(*)::bigint AS records_count,
    COALESCE(sum(planned_runtime), 0)::bigint AS total_planned_runtime,
    COALESCE(sum(actual_runtime), 0)::bigint AS total_actual_runtime,
    COALESCE(sum(ideal_runtime), 0)::bigint AS total_ideal_runtime,
    COALESCE(sum(output_qty), 0)::bigint AS total_output_qty,
    COALESCE(sum(defect_qty), 0)::bigint AS total_defect_qty,
    count(DISTINCT machine_id)::int AS unique_machines,
    count(DISTINCT shift)::int AS shifts_analyzed
  FROM scan
), machine_shift AS (
  SELECT
    machine_id,
    shift,
    LEAST(1::float8, GREATEST(0::float8, sum(actual_runtime)::float8 / NULLIF(sum(planned_runtime), 0)))
      * LEAST(1::float8, GREATEST(0::float8, sum(ideal_runtime)::float8 / NULLIF(sum(actual_runtime), 0)))
      * LEAST(1::float8, GREATEST(0::float8, sum(output_qty - defect_qty)::float8 / NULLIF(sum(output_qty), 0))) AS oee
  FROM scan
  GROUP BY machine_id, shift
), machine_shift_rank AS (
  SELECT
    machine_id,
    (array_agg(shift ORDER BY oee DESC NULLS LAST, shift ASC))[1] AS best_shift,
    (array_agg(shift ORDER BY oee ASC NULLS LAST, shift DESC))[1] AS worst_shift
  FROM machine_shift
  GROUP BY machine_id
), machines_agg AS (
  SELECT
    s.machine_id,
    min(s.machine_name) AS machine_name,
    min(s.equipment_type) AS equipment_type,
    count(*)::bigint AS records_count,
    COALESCE(sum(s.planned_runtime), 0)::bigint AS total_planned_runtime,
    COALESCE(sum(s.actual_runtime), 0)::bigint AS total_actual_runtime,
    COALESCE(sum(s.ideal_runtime), 0)::bigint AS total_ideal_runtime,
    COALESCE(sum(s.output_qty), 0)::bigint AS total_output,
    COALESCE(sum(s.defect_qty), 0)::bigint AS total_defect_qty,
    COALESCE(sum(s.output_qty - s.defect_qty), 0)::bigint AS total_good_qty
  FROM scan s
  GROUP BY s.machine_id
), shifts_agg AS (
  SELECT
    shift,
    count(*)::bigint AS records_count,
    COALESCE(sum(planned_runtime), 0)::bigint AS total_planned_runtime,
    COALESCE(sum(actual_runtime), 0)::bigint AS total_actual_runtime,
    COALESCE(sum(ideal_runtime), 0)::bigint AS total_ideal_runtime,
    COALESCE(sum(output_qty), 0)::bigint AS total_output,
    COALESCE(sum(defect_qty), 0)::bigint AS total_defect_qty,
    COALESCE(sum(output_qty - defect_qty), 0)::bigint AS total_good_qty,
    count(DISTINCT machine_id)::int AS machines_count
  FROM scan
  GROUP BY shift
), daily_agg AS (
  SELECT
    date,
    count(*)::bigint AS records_count,
    COALESCE(sum(planned_runtime), 0)::bigint AS total_planned_runtime,
    COALESCE(sum(actual_runtime), 0)::bigint AS total_actual_runtime,
    COALESCE(sum(ideal_runtime), 0)::bigint AS total_ideal_runtime,
    COALESCE(sum(output_qty), 0)::bigint AS total_output,
    COALESCE(sum(defect_qty), 0)::bigint AS total_defect_qty,
    COALESCE(sum(output_qty - defect_qty), 0)::bigint AS total_good_qty,
    count(DISTINCT machine_id)::int AS active_machines
  FROM scan
  GROUP BY date
)
SELECT json_build_object(
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
