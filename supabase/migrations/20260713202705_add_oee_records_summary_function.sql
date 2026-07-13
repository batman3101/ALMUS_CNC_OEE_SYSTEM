-- OEE 원시 행 조회(/api/oee-data)의 통계 집계를 DB로 이관한다.
--
-- 배경:
--   /api/oee-data 는 production_records 를 필터해서 원시 행 배열(oee_data)과
--   그 평균치(statistics)를 함께 돌려준다. 그런데 조회에 .limit() 이 없어
--   PostgREST 의 max-rows(이 프로젝트는 100,000) 에 걸려 응답이 조용히 잘렸다.
--
--   .order('date', desc) 가 걸려 있으므로 잘린 뒤 남는 건 "가장 최근 100,000행"이다.
--   즉 연간(365일) 조회 시:
--     - 실제 대상 325,088행 중 100,000행만 반환 (69% 소실)
--     - 응답이 커버하는 실제 기간이 1년이 아니라 약 2개월(2026-05-03~)로 축소
--     - statistics 는 그 잘린 조각 위에서 계산되는데도 전체 평균인 것처럼 반환
--       (avg_oee 0.7329 vs 실제 0.7549, avg_availability 0.9635 vs 실제 0.9379)
--     - total_records 는 100000 으로 보고되어 절삭 사실 자체가 드러나지 않음
--
--   행을 더 가져오는 것으로는 해결되지 않는다. 전체 집합의 평균을 구하려면
--   전체 행을 전송해야 하는데 그 순간 다시 같은 한도에 걸리기 때문이다.
--   따라서 집계는 DB에서 수행하고, 라우트는 행을 명시적으로 페이지네이션한다.
--
-- 이 함수는 행을 전송하지 않고 필터 조건에 해당하는 "전체" 집합의
-- 건수와 평균을 돌려준다. 필터 의미는 라우트와 정확히 일치시킨다:
--   - date >= p_start_date (하한은 항상 존재)
--   - p_end_date / p_machine_id / p_shift 는 NULL 이면 미적용
--   - machines 와의 inner join 의미를 EXISTS 로 보존
--     (현재 고아 행은 0건이지만, 라우트가 !inner 를 쓰는 한
--      통계 집합과 행 집합이 갈라지지 않도록 조건을 맞춰 둔다)
--
-- 평균은 COALESCE(컬럼, 0) 위에서 계산해 라우트의 Number(x || 0) 과 동일하게 맞추고,
-- 빈 집합에서 avg() 가 NULL 을 반환하는 것을 0 으로 접어 기존 응답 형태를 보존한다.
CREATE OR REPLACE FUNCTION public.analytics_oee_records_summary(
  p_start_date date,
  p_end_date   date DEFAULT NULL,
  p_machine_id uuid DEFAULT NULL,
  p_shift      text DEFAULT NULL
)
RETURNS TABLE (
  total_records    bigint,
  avg_availability float8,
  avg_performance  float8,
  avg_quality      float8,
  avg_oee          float8
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    count(*)::bigint                                                AS total_records,
    COALESCE(avg(COALESCE(pr.availability, 0)::float8), 0::float8)  AS avg_availability,
    COALESCE(avg(COALESCE(pr.performance,  0)::float8), 0::float8)  AS avg_performance,
    COALESCE(avg(COALESCE(pr.quality,      0)::float8), 0::float8)  AS avg_quality,
    COALESCE(avg(COALESCE(pr.oee,          0)::float8), 0::float8)  AS avg_oee
  FROM production_records pr
  WHERE pr.date >= p_start_date
    AND (p_end_date   IS NULL OR pr.date       <= p_end_date)
    AND (p_machine_id IS NULL OR pr.machine_id  = p_machine_id)
    AND (p_shift      IS NULL OR pr.shift       = p_shift)
    AND EXISTS (SELECT 1 FROM machines m WHERE m.id = pr.machine_id);
$$;

-- 이 함수는 service_role 로 동작하는 API Route 에서만 호출한다.
REVOKE ALL ON FUNCTION public.analytics_oee_records_summary(date, date, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_oee_records_summary(date, date, uuid, text)
  TO service_role;
