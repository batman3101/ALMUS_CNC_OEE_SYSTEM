-- analytics_productivity: 설비 수에 대해 O(n²) 로 폭발하던 문제 수정
--
-- 증상 (2026-07-17 실측)
--   /api/productivity-analysis 가 9.5초. RPC 자체가 6,016ms.
--   같은 SQL 을 리터럴로 직접 실행하면 69ms — 93배 차이. 쿼리가 아니라 호출이 문제였다.
--
-- 원인
--   함수 안에서 p_start_date/p_end_date 는 상수가 아니라 파라미터다. 플래너는 범위
--   조건의 선택도를 알 수 없어 기본값(0.5%)으로 잡고 rows=19 로 추정한다 (실제 3,861행,
--   200배 과소추정). rows=1~19 이면 Nested Loop 이 공짜로 보이므로,
--   machines_agg LEFT JOIN machine_shift_rank 가 Nested Loop 으로 잡히고
--   machine_shift_rank 의 GroupAggregate 가 설비마다 재실행된다.
--
--     Nested Loop Left Join (cost=... rows=1) (actual rows=800)
--       Rows Removed by Join Filter: 319600        -- 800 × 400
--       -> GroupAggregate (rows=400 loops=800)     -- 800번 재실행
--
--   설비 수가 2배면 시간은 4배가 된다 (실측 100대 110ms / 200대 397ms / 400대 1,601ms /
--   800대 6,181ms). 설비 1대로 필터하면 7ms 로, 비용이 행 수가 아니라 설비 수에 붙는다.
--
-- 처방 선택 근거
--   plan_cache_mode='force_custom_plan' 은 효과가 없었다 (6,120ms, 개선 없음).
--   대신 재실행될 수 있는 CTE 를 MATERIALIZED 로 고정한다. 플래너의 추정이 틀리더라도
--   재계산이 물리적으로 불가능해지므로, 추정 정확도에 의존하지 않는다.
--   각 CTE 는 원래도 1~2회만 쓰이므로 MATERIALIZED 로 인한 손해가 없다.
--
-- 검증
--   본문 로직은 한 글자도 바꾸지 않았다 (MATERIALIZED 키워드만 추가).
--   30일 전체 / 3일 / 설비필터 / 교대필터 / 빈범위 5개 시나리오에서 JSON 출력이
--   원본과 바이트 단위로 동일함을 확인했다.
--   30일 전체(앱이 실제로 쓰는 호출): 6,360ms -> 184ms (34.5x)
--   A교대 필터: 3,716ms -> 142ms (26.2x)
--
-- 주의: 이 함수처럼 "파라미터 날짜 범위 + CTE 끼리의 조인" 구조를 새로 만들 때는
--       같은 함정에 빠진다. 다른 analytics_* RPC 는 CTE 간 조인이 없어 28~81ms 로 정상.

CREATE OR REPLACE FUNCTION public.analytics_productivity(
  p_start_date date,
  p_end_date date,
  p_machine_ids uuid[] DEFAULT NULL::uuid[],
  p_shifts text[] DEFAULT NULL::text[]
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
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
), scan AS MATERIALIZED (
  SELECT * FROM base WHERE oee_reported AND NOT invalid
), coverage AS MATERIALIZED (
  SELECT
    count(*)::bigint AS total_records,
    count(*) FILTER (WHERE NOT oee_reported AND NOT invalid)::bigint AS unreported_records,
    count(*) FILTER (WHERE oee_reported AND NOT invalid)::bigint AS reported_records,
    count(*) FILTER (WHERE invalid)::bigint AS invalid_records
  FROM base
), totals AS MATERIALIZED (
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
), machine_shift AS MATERIALIZED (
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
), machine_shift_metrics AS MATERIALIZED (
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
), machine_shift_rank AS MATERIALIZED (
  SELECT
    machine_id,
    (array_agg(shift ORDER BY oee DESC, shift ASC) FILTER (WHERE oee IS NOT NULL))[1] AS best_shift,
    (array_agg(shift ORDER BY oee ASC, shift DESC) FILTER (WHERE oee IS NOT NULL))[1] AS worst_shift
  FROM machine_shift_metrics
  GROUP BY machine_id
), machines_agg AS MATERIALIZED (
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
), shifts_agg AS MATERIALIZED (
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
), daily_agg AS MATERIALIZED (
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
$function$;

COMMENT ON FUNCTION public.analytics_productivity(date, date, uuid[], text[]) IS
  'OEE 생산성 집계. 모든 CTE 가 MATERIALIZED 인 것은 의도된 것이다 — 파라미터 날짜 범위 '
  '때문에 플래너가 행 수를 200배 과소추정(rows=19 vs 실제 3,861)하고, 그 결과 '
  'machines_agg x machine_shift_rank 조인이 Nested Loop 으로 잡혀 설비마다 재집계가 돌아 '
  'O(설비수^2) 가 된다. MATERIALIZED 를 떼면 800대 기준 184ms -> 6,360ms 로 돌아간다. '
  '2026-07-17 수정.';
