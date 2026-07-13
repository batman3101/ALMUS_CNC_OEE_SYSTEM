-- 분석 집계 함수의 float8 라운드트립 정밀도 보정.
--
-- 문제: PostgREST 커넥션은 extra_float_digits = 0 으로 동작한다. 이 설정에서
-- Postgres 의 float8 출력 함수는 유효숫자 15자리로 잘라내므로, 함수가 만든
-- float8 합계가 JSON 으로 나갈 때 원래 double 값으로 되돌아오지 않는다.
--
-- 실측: 30일·전체 설비 구간에서 A/B 교대의 oee 합계는
--   A = 16462.469099999522
--   B = 16462.469099999533
-- 로 다르지만(기존 라우트가 JS float64 로 누적한 값과 비트 단위로 일치),
-- 15자리로 잘리면 둘 다 16462.4690999995 가 되어 완전히 동률이 된다.
-- 평균 oee 내림차순 정렬에서 동률이 되면 교대 배열 순서가 뒤집히므로
-- 기존 응답과 달라진다.
--
-- 해결: 함수 로컬로 extra_float_digits = 3 을 설정한다. Postgres 12+ 에서
-- 이 값이 1 이상이면 shortest round-trip 표현을 사용하므로 double 값이 보존된다.
-- 함수 본문 안에서 json 직렬화가 일어나야 이 설정이 적용되므로,
-- analytics_oee_daily 도 RETURNS TABLE -> RETURNS json 으로 바꾼다.

ALTER FUNCTION public.analytics_productivity(date, date, uuid[], text[])       SET extra_float_digits = 3;
ALTER FUNCTION public.analytics_quality(date, date, uuid[], text[], float8)    SET extra_float_digits = 3;

DROP FUNCTION IF EXISTS public.analytics_oee_daily(date, uuid);

CREATE FUNCTION public.analytics_oee_daily(
  p_start_date date,
  p_machine_id uuid DEFAULT NULL
)
RETURNS json
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
SET extra_float_digits = 3
AS $$
  SELECT COALESCE(json_agg(row_to_json(d) ORDER BY d.date), '[]'::json)
  FROM (
    SELECT
      pr.date,
      count(*)                                     AS records_count,
      sum(COALESCE(pr.availability, 0)::float8)    AS sum_availability,
      sum(COALESCE(pr.performance,  0)::float8)    AS sum_performance,
      sum(COALESCE(pr.quality,      0)::float8)    AS sum_quality,
      sum(COALESCE(pr.oee,          0)::float8)    AS sum_oee,
      sum(COALESCE(pr.output_qty,     0))::bigint  AS total_output,
      sum(COALESCE(pr.defect_qty,     0))::bigint  AS total_defects,
      sum(COALESCE(pr.actual_runtime, 0))::bigint  AS total_runtime,
      -- 라우트의 `Number(r.planned_runtime) || 480` 과 동일: NULL/0 은 480분으로 본다.
      sum(CASE WHEN COALESCE(pr.planned_runtime, 0) = 0 THEN 480 ELSE pr.planned_runtime END)::bigint AS planned_runtime
    FROM production_records pr
    WHERE pr.date >= p_start_date
      AND (p_machine_id IS NULL OR pr.machine_id = p_machine_id)
    GROUP BY pr.date
  ) d;
$$;

REVOKE ALL ON FUNCTION public.analytics_oee_daily(date, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_oee_daily(date, uuid) TO service_role;
