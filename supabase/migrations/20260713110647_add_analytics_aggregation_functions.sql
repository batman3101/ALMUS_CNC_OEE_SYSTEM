-- 분석 API(생산성/품질/OEE 집계)의 집계 연산을 Postgres로 이관한다.
--
-- 배경: productivity-analysis / quality-analysis / oee-data/aggregated 라우트는
-- production_records 원본 행을 전부 Node로 가져와 JS 루프로 집계했다.
-- 30일·전체 설비 기준 37,000~46,000행(13~16MB)을 전송했고, 90일이면 120,000행을 넘었다.
-- 아래 함수들은 동일한 필터를 받아 이미 집계된 결과만 돌려준다.
--
-- ★ 응답 하위호환성(byte-for-byte)을 위한 설계 원칙 ★
-- 1) 기존 라우트는 PostgREST가 돌려준 행 순서(ORDER BY date DESC)대로 JS에서
--    float64 덧셈을 누적했다. 부동소수점 덧셈은 결합법칙이 성립하지 않으므로
--    합계의 마지막 비트는 "누적 순서"에 의존한다. 또한 정렬 키가 동률일 때
--    Array.prototype.sort(안정 정렬)는 "삽입 순서"로 순위를 정한다.
--    (실제 데이터에서 A/B 교대의 oee 합계는 numeric 기준 완전히 동일하고,
--     품질 분석에서는 800대 중 744대가 avg_quality=100으로 동률이다.)
-- 2) 따라서 여기서는
--      - 원본 스캔에 row_number() OVER () 로 rn(행 순번)을 부여하고,
--      - 모든 부동소수점 합계를 sum(x::float8 ORDER BY rn) 로 계산하여
--        JS의 누적 순서와 비트 단위까지 동일하게 맞추고,
--      - 각 그룹의 min(rn)(= 최초 등장 순번)을 함께 반환해
--        Node가 삽입 순서를 그대로 복원할 수 있게 한다.
--    idx_production_records_date 가 (date DESC) 인덱스라 스캔이 Sort 없이
--    인덱스 순서로 나오므로 rn 은 결정적이다.
-- 3) 반올림/라벨/정렬 등 최종 표현 로직은 라우트(Node)에 그대로 남긴다.
--
-- 스케일 주의: availability/performance/quality/oee 는 DB에 0~1 비율로 저장된다.
-- quality-analysis 만 응답 전체를 0~100 퍼센트로 노출하므로, 해당 함수에서만
-- q_pct = quality * 100 을 계산해 넘긴다(라우트의 toQualityPercent()와 동일).

-- ---------------------------------------------------------------------------
-- 생산성 분석
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_productivity(
  p_start_date  date,
  p_end_date    date,
  p_machine_ids uuid[] DEFAULT NULL,
  p_shifts      text[] DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH scan AS (
  SELECT s.*, row_number() OVER () AS rn
  FROM (
    SELECT
      pr.machine_id,
      pr.date,
      pr.shift,
      COALESCE(pr.availability, 0)::float8 AS availability,
      COALESCE(pr.performance,  0)::float8 AS performance,
      COALESCE(pr.quality,      0)::float8 AS quality,
      COALESCE(pr.oee,          0)::float8 AS oee,
      COALESCE(pr.planned_runtime, 0)      AS planned_runtime,
      COALESCE(pr.actual_runtime,  0)      AS actual_runtime,
      COALESCE(pr.output_qty,      0)      AS output_qty,
      COALESCE(pr.defect_qty,      0)      AS defect_qty,
      CASE WHEN COALESCE(m.name, '') = '' THEN 'Unknown' ELSE m.name END AS machine_name,
      CASE WHEN COALESCE(m.equipment_type, '') = '' THEN 'Unknown' ELSE m.equipment_type END AS equipment_type
    FROM production_records pr
    JOIN machines m ON m.id = pr.machine_id
    WHERE pr.date >= p_start_date
      AND pr.date <= p_end_date
      AND (p_machine_ids IS NULL OR pr.machine_id = ANY (p_machine_ids))
      AND (p_shifts      IS NULL OR pr.shift      = ANY (p_shifts))
    ORDER BY pr.date DESC
  ) s
),
totals AS (
  SELECT
    count(*)                        AS records_count,
    sum(availability ORDER BY rn)   AS sum_availability,
    sum(performance  ORDER BY rn)   AS sum_performance,
    sum(quality      ORDER BY rn)   AS sum_quality,
    sum(oee          ORDER BY rn)   AS sum_oee,
    sum(planned_runtime)::bigint    AS total_planned_runtime,
    sum(actual_runtime)::bigint     AS total_actual_runtime,
    sum(output_qty)::bigint         AS total_output_qty,
    sum(defect_qty)::bigint         AS total_defect_qty,
    count(DISTINCT machine_id)::int AS unique_machines,
    count(DISTINCT shift)::int      AS shifts_analyzed
  FROM scan
),
-- 설비별 최고/최저 성과 교대: 교대별 평균 oee 내림차순, 동률이면 최초 등장 순.
machine_shift AS (
  SELECT machine_id, shift,
         sum(oee ORDER BY rn) / count(*)::float8 AS avg_oee,
         min(rn) AS first_rn
  FROM scan
  GROUP BY machine_id, shift
),
machine_shift_rank AS (
  SELECT machine_id,
         (array_agg(shift ORDER BY avg_oee DESC, first_rn ASC))[1]  AS best_shift,
         (array_agg(shift ORDER BY avg_oee ASC,  first_rn DESC))[1] AS worst_shift
  FROM machine_shift
  GROUP BY machine_id
),
machines_agg AS (
  SELECT
    machine_id,
    min(machine_name)                    AS machine_name,
    min(equipment_type)                  AS equipment_type,
    count(*)                             AS records_count,
    sum(performance ORDER BY rn)         AS sum_performance,
    sum(quality     ORDER BY rn)         AS sum_quality,
    sum(output_qty)::bigint              AS total_output,
    sum(defect_qty)::bigint              AS total_defect_qty,
    sum(output_qty - defect_qty)::bigint AS total_good_qty,
    sum(planned_runtime)::bigint         AS total_planned_runtime,
    sum(actual_runtime)::bigint          AS total_actual_runtime,
    min(rn)                              AS first_rn
  FROM scan
  GROUP BY machine_id
),
shifts_agg AS (
  SELECT
    shift,
    count(*)                             AS records_count,
    sum(oee          ORDER BY rn)        AS sum_oee,
    sum(availability ORDER BY rn)        AS sum_availability,
    sum(performance  ORDER BY rn)        AS sum_performance,
    sum(quality      ORDER BY rn)        AS sum_quality,
    sum(output_qty)::bigint              AS total_output,
    sum(output_qty - defect_qty)::bigint AS total_good_qty,
    count(DISTINCT machine_id)::int      AS machines_count,
    min(rn)                              AS first_rn
  FROM scan
  GROUP BY shift
),
daily_agg AS (
  SELECT
    date,
    count(*)                             AS records_count,
    sum(oee          ORDER BY rn)        AS sum_oee,
    sum(availability ORDER BY rn)        AS sum_availability,
    sum(performance  ORDER BY rn)        AS sum_performance,
    sum(quality      ORDER BY rn)        AS sum_quality,
    sum(output_qty)::bigint              AS total_output,
    sum(output_qty - defect_qty)::bigint AS total_good_qty,
    count(DISTINCT machine_id)::int      AS active_machines
  FROM scan
  GROUP BY date
)
SELECT json_build_object(
  'totals', (SELECT row_to_json(t) FROM totals t),
  'machines', COALESCE((
    SELECT json_agg(row_to_json(x) ORDER BY x.first_rn)
    FROM (
      SELECT ma.machine_id, ma.machine_name, ma.equipment_type, ma.records_count,
             ma.sum_performance, ma.sum_quality, ma.total_output, ma.total_defect_qty,
             ma.total_good_qty, ma.total_planned_runtime, ma.total_actual_runtime,
             msr.best_shift, msr.worst_shift, ma.first_rn
      FROM machines_agg ma
      LEFT JOIN machine_shift_rank msr ON msr.machine_id = ma.machine_id
    ) x
  ), '[]'::json),
  'shifts', COALESCE((SELECT json_agg(row_to_json(s) ORDER BY s.first_rn) FROM shifts_agg s), '[]'::json),
  'daily',  COALESCE((SELECT json_agg(row_to_json(d) ORDER BY d.date)     FROM daily_agg d),  '[]'::json)
);
$$;

-- ---------------------------------------------------------------------------
-- 품질 분석 (응답 전체가 0~100 퍼센트 스케일)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_quality(
  p_start_date        date,
  p_end_date          date,
  p_machine_ids       uuid[] DEFAULT NULL,
  p_shifts            text[] DEFAULT NULL,
  p_quality_threshold float8 DEFAULT 95
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
WITH scan AS (
  SELECT s.*, row_number() OVER () AS rn
  FROM (
    SELECT
      pr.machine_id,
      pr.date,
      pr.shift,
      COALESCE(pr.quality, 0)::float8                AS q_raw,
      COALESCE(pr.quality, 0)::float8 * 100::float8  AS q_pct,
      COALESCE(pr.output_qty, 0)                     AS output_qty,
      COALESCE(pr.defect_qty, 0)                     AS defect_qty,
      CASE WHEN COALESCE(m.name, '') = '' THEN 'Unknown' ELSE m.name END AS machine_name,
      CASE WHEN COALESCE(m.equipment_type, '') = '' THEN 'Unknown' ELSE m.equipment_type END AS equipment_type
    FROM production_records pr
    JOIN machines m ON m.id = pr.machine_id
    WHERE pr.date >= p_start_date
      AND pr.date <= p_end_date
      AND pr.output_qty IS NOT NULL
      AND pr.defect_qty IS NOT NULL
      AND pr.output_qty > 0
      AND (p_machine_ids IS NULL OR pr.machine_id = ANY (p_machine_ids))
      AND (p_shifts      IS NULL OR pr.shift      = ANY (p_shifts))
    ORDER BY pr.date DESC
  ) s
),
totals AS (
  SELECT
    count(*)                             AS records_count,
    sum(output_qty)::bigint              AS total_output_qty,
    sum(defect_qty)::bigint              AS total_defect_qty,
    sum(output_qty - defect_qty)::bigint AS total_good_qty,
    sum(q_pct ORDER BY rn)               AS quality_sum,
    count(*) FILTER (WHERE q_pct >= p_quality_threshold)       AS records_above_threshold,
    count(*) FILTER (WHERE NOT (q_pct >= p_quality_threshold)) AS records_below_threshold,
    count(DISTINCT machine_id)::int      AS unique_machines,
    count(DISTINCT shift)::int           AS shifts_analyzed
  FROM scan
),
-- 설비별 변동성/추세는 라우트가 날짜 오름차순(안정 정렬)으로 재정렬한 배열 위에서
-- 계산하므로, 여기서도 (date ASC, rn ASC) 순서를 그대로 재현한다.
machine_ord AS (
  SELECT s.*,
         row_number() OVER (PARTITION BY s.machine_id ORDER BY s.date ASC, s.rn ASC) AS k,
         count(*)     OVER (PARTITION BY s.machine_id) AS n,
         sum(s.q_pct) OVER (PARTITION BY s.machine_id ORDER BY s.date ASC, s.rn ASC
                            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS sum_q_all
  FROM scan s
),
machines_agg AS (
  SELECT
    machine_id,
    min(machine_name)                    AS machine_name,
    min(equipment_type)                  AS equipment_type,
    count(*)                             AS records_count,
    sum(output_qty)::bigint              AS total_output,
    sum(defect_qty)::bigint              AS total_defects,
    sum(output_qty - defect_qty)::bigint AS total_good,
    count(*) FILTER (WHERE q_pct >= p_quality_threshold) AS compliant_count,
    -- 모집단 표준편차(퍼센트 포인트). 라우트의 2-pass 계산과 동일한 누적 순서를 사용.
    sqrt(
      sum( (q_pct - (sum_q_all / n::float8)) * (q_pct - (sum_q_all / n::float8))
           ORDER BY date ASC, rn ASC )
      / count(*)::float8
    )                                    AS quality_variance,
    -- 최고 품질일: 품질 내림차순 안정 정렬의 첫 원소(동률이면 가장 이른 날짜)
    (array_agg(date ORDER BY q_raw DESC, date ASC,  rn ASC))[1]  AS best_quality_day,
    -- 최저 품질일: 같은 정렬의 마지막 원소(동률이면 가장 늦은 날짜)
    (array_agg(date ORDER BY q_raw ASC,  date DESC, rn DESC))[1] AS worst_quality_day,
    -- 추세: 전반부(k <= floor(n/2)) 대 후반부 평균 비교
    (sum(q_pct ORDER BY date ASC, rn ASC) FILTER (WHERE k <= n / 2))
      / NULLIF(count(*) FILTER (WHERE k <= n / 2), 0)::float8 AS first_half_avg,
    (sum(q_pct ORDER BY date ASC, rn ASC) FILTER (WHERE k > n / 2))
      / NULLIF(count(*) FILTER (WHERE k > n / 2), 0)::float8 AS second_half_avg,
    min(rn)                              AS first_rn
  FROM machine_ord
  GROUP BY machine_id, n
),
shifts_agg AS (
  SELECT
    shift,
    count(*)                        AS records_count,
    sum(output_qty)::bigint         AS total_output,
    sum(defect_qty)::bigint         AS total_defects,
    sum(q_pct ORDER BY rn)          AS sum_quality,
    count(*) FILTER (WHERE q_pct >= p_quality_threshold) AS compliant_count,
    count(DISTINCT machine_id)::int AS machines_count,
    min(rn)                         AS first_rn
  FROM scan
  GROUP BY shift
),
daily_agg AS (
  SELECT
    date,
    count(*)                        AS records_count,
    sum(output_qty)::bigint         AS total_output,
    sum(defect_qty)::bigint         AS total_defects,
    sum(q_pct ORDER BY rn)          AS sum_quality,
    count(*) FILTER (WHERE q_pct >= p_quality_threshold) AS compliant_count,
    count(DISTINCT machine_id)::int AS active_machines
  FROM scan
  GROUP BY date
)
SELECT json_build_object(
  'totals',   (SELECT row_to_json(t) FROM totals t),
  'machines', COALESCE((SELECT json_agg(row_to_json(m) ORDER BY m.first_rn) FROM machines_agg m), '[]'::json),
  'shifts',   COALESCE((SELECT json_agg(row_to_json(s) ORDER BY s.first_rn) FROM shifts_agg s),   '[]'::json),
  'daily',    COALESCE((SELECT json_agg(row_to_json(d) ORDER BY d.date)     FROM daily_agg d),    '[]'::json)
);
$$;

-- ---------------------------------------------------------------------------
-- OEE 기간 집계 (oee-data/aggregated)
-- 기간 키(주/월/년) 산출과 라벨 생성은 로컬 타임존 의존 로직이라 라우트에 남겨둔다.
-- 여기서는 일 단위 사전집계만 돌려주고, 라우트가 이를 기간별로 롤업한다.
-- planned_runtime 이 NULL/0 인 행은 라우트와 동일하게 480분으로 간주한다.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.analytics_oee_daily(
  p_start_date date,
  p_machine_id uuid DEFAULT NULL
)
RETURNS TABLE (
  date            date,
  records_count   bigint,
  sum_availability float8,
  sum_performance  float8,
  sum_quality      float8,
  sum_oee          float8,
  total_output     bigint,
  total_defects    bigint,
  total_runtime    bigint,
  planned_runtime  bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    pr.date,
    count(*)                                     AS records_count,
    sum(COALESCE(pr.availability, 0)::float8)    AS sum_availability,
    sum(COALESCE(pr.performance,  0)::float8)    AS sum_performance,
    sum(COALESCE(pr.quality,      0)::float8)    AS sum_quality,
    sum(COALESCE(pr.oee,          0)::float8)    AS sum_oee,
    sum(COALESCE(pr.output_qty,    0))::bigint   AS total_output,
    sum(COALESCE(pr.defect_qty,    0))::bigint   AS total_defects,
    sum(COALESCE(pr.actual_runtime, 0))::bigint  AS total_runtime,
    sum(CASE WHEN COALESCE(pr.planned_runtime, 0) = 0 THEN 480 ELSE pr.planned_runtime END)::bigint AS planned_runtime
  FROM production_records pr
  WHERE pr.date >= p_start_date
    AND (p_machine_id IS NULL OR pr.machine_id = p_machine_id)
  GROUP BY pr.date;
$$;

REVOKE ALL ON FUNCTION public.analytics_productivity(date, date, uuid[], text[])         FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_quality(date, date, uuid[], text[], float8)      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_oee_daily(date, uuid)                            FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.analytics_productivity(date, date, uuid[], text[])      TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_quality(date, date, uuid[], text[], float8)   TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_oee_daily(date, uuid)                         TO service_role;
