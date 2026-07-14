-- 가동률(availability) 신뢰도 문제를 스키마 수준에서 해결한다.
--
-- 배경:
--   비가동 시간과 생산 수량은 작업자가 직접 입력하는 시스템이다.
--   가동률 = (planned_runtime - 비가동) / planned_runtime 인데, 비가동을 입력하지 않으면
--   actual_runtime = planned_runtime 이 되어 가동률이 100% 로 기록된다.
--   즉 "무중단이었다"와 "아직 입력하지 않았다"가 DB 에서 똑같이 보였다.
--
--   적용 시점 실측:
--     전체 326,179건 중 비가동이 기록된 것은 19,068건(5.8%)뿐이고
--     나머지 307,111건(94.2%)은 가동률이 100% 로 잡혀 있었다.
--     비가동이 기록된 교대의 평균 가동률은 65.8% / OEE 43.5%,
--     기록되지 않은 교대는 가동률 95.6% / OEE 77.3% 로 집계되었다.
--     -> 대시보드의 평균 OEE 는 실제보다 크게 부풀려져 있었다.
--
-- 해법: "미입력"과 "0분"을 구분해 저장하고, 통계가 그 비율을 함께 노출한다.

-- 1) 미입력과 0분을 구분하는 컬럼
--    NULL : 미입력 (비가동을 확인하지 않음 -> 가동률을 신뢰할 수 없음)
--    0    : 무중단으로 확인됨 (작업자가 명시적으로 확인)
--    > 0  : 비가동 있음
ALTER TABLE public.production_records
  ADD COLUMN IF NOT EXISTS downtime_minutes integer;

COMMENT ON COLUMN public.production_records.downtime_minutes IS
  'NULL=미입력(가동률 미확인), 0=무중단 확인됨, >0=비가동 분. availability 의 신뢰 여부를 판별하는 데 사용한다.';

-- 2) 백필: 비가동이 실제로 반영된 기록만 값을 채운다.
--    planned = actual 인 기록은 "무중단"인지 "미입력"인지 소급 판별할 수 없으므로 NULL 로 남긴다.
--    (모르는 것을 0 으로 채우면 지금의 왜곡을 그대로 굳히게 된다)
UPDATE public.production_records
   SET downtime_minutes = planned_runtime - actual_runtime
 WHERE planned_runtime > 0
   AND actual_runtime IS NOT NULL
   AND actual_runtime < planned_runtime
   AND downtime_minutes IS NULL;

CREATE INDEX IF NOT EXISTS idx_production_records_downtime_unreported
  ON public.production_records (date)
  WHERE downtime_minutes IS NULL;

-- 3) 저장 RPC 가 downtime_minutes 를 함께 기록하도록 갱신.
--    폼은 저장 전 비가동 0분을 확인받으므로 신규 저장분은 항상 값이 채워진다.
--    (0 은 "확인된 무중단", NULL 은 레거시 미입력)
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
SET search_path TO 'public'
AS $function$
DECLARE
  v_saved jsonb := '[]'::jsonb;
  v_deleted jsonb := '[]'::jsonb;
  v_shift text;
  v_shift_off boolean;
  v_record jsonb;
  v_deleted_count integer;
  v_row public.production_records%ROWTYPE;
BEGIN
  IF p_machine_id IS NULL OR p_date IS NULL THEN
    RAISE EXCEPTION 'machine_id and date are required';
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

    ELSIF v_record IS NOT NULL THEN
      INSERT INTO public.production_records (
        machine_id, date, shift,
        planned_runtime, actual_runtime, ideal_runtime,
        output_qty, defect_qty,
        availability, performance, quality, oee,
        downtime_minutes
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
        (v_record ->> 'downtime_minutes')::integer
      )
      ON CONFLICT (machine_id, date, shift) DO UPDATE SET
        planned_runtime  = EXCLUDED.planned_runtime,
        actual_runtime   = EXCLUDED.actual_runtime,
        ideal_runtime    = EXCLUDED.ideal_runtime,
        output_qty       = EXCLUDED.output_qty,
        defect_qty       = EXCLUDED.defect_qty,
        availability     = EXCLUDED.availability,
        performance      = EXCLUDED.performance,
        quality          = EXCLUDED.quality,
        oee              = EXCLUDED.oee,
        downtime_minutes = EXCLUDED.downtime_minutes
      RETURNING * INTO v_row;

      v_saved := v_saved || to_jsonb(v_row);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'saved_records', v_saved,
    'deleted_shifts', v_deleted
  );
END;
$function$;

-- 4) 통계가 "이 평균을 얼마나 믿을 수 있는가"를 함께 반환하도록 갱신.
--    평균값만 내려주면 위 왜곡이 화면에서 보이지 않는다.
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
  unreported_records bigint,
  reported_records bigint,
  avg_availability_reported double precision,
  avg_oee_reported double precision
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT
    count(*)::bigint                                                AS total_records,
    COALESCE(avg(COALESCE(pr.availability, 0)::float8), 0::float8)  AS avg_availability,
    COALESCE(avg(COALESCE(pr.performance,  0)::float8), 0::float8)  AS avg_performance,
    COALESCE(avg(COALESCE(pr.quality,      0)::float8), 0::float8)  AS avg_quality,
    COALESCE(avg(COALESCE(pr.oee,          0)::float8), 0::float8)  AS avg_oee,

    count(*) FILTER (WHERE pr.downtime_minutes IS NULL)::bigint     AS unreported_records,
    count(*) FILTER (WHERE pr.downtime_minutes IS NOT NULL)::bigint AS reported_records,

    COALESCE(
      avg(COALESCE(pr.availability, 0)::float8) FILTER (WHERE pr.downtime_minutes IS NOT NULL),
      0::float8
    ) AS avg_availability_reported,
    COALESCE(
      avg(COALESCE(pr.oee, 0)::float8) FILTER (WHERE pr.downtime_minutes IS NOT NULL),
      0::float8
    ) AS avg_oee_reported
  FROM production_records pr
  WHERE pr.date >= p_start_date
    AND (p_end_date   IS NULL OR pr.date       <= p_end_date)
    AND (p_machine_id IS NULL OR pr.machine_id  = p_machine_id)
    AND (p_shift      IS NULL OR pr.shift       = p_shift)
    AND EXISTS (SELECT 1 FROM machines m WHERE m.id = pr.machine_id);
$function$;
