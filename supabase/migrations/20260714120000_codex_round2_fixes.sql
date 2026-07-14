-- Codex 2차 점검 대응 (데이터 무결성 + 집계 정확도)
--
-- 1) 과거 기록을 수정하면 "현재" Tact Time/Cavity 로 그때의 OEE 가 다시 계산되던 문제
-- 2) 생산 기록을 지워도 downtime_entries 가 고아로 남던 문제
-- 3) 엔지니어 화면의 설비별 표가 기간/교대 필터를 무시하던 문제 (설비별 집계 RPC 부재)

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Tact Time / Cavity 스냅샷
--
--    production_records 에는 tact 를 보존하는 컬럼이 아예 없었다(실측 확인).
--    그래서 기록을 수정할 때 서버는 설비의 "현재" 공정에서 tact 를 읽어 ideal_runtime,
--    performance, oee 를 다시 계산했다. 제품/공정이 바뀐 뒤 과거 수량을 한 번만 고쳐도
--    그 교대의 역사가 오늘의 조건으로 덮여버리고, 원래 값은 복구할 수 없다.
--
--    NULL = 스냅샷 없음(레거시). 이 경우 애플리케이션은 저장된 ideal_runtime/output_qty 에서
--    당시의 단위당 생산시간을 역산해 사용한다 (아래 API 주석 참고).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.production_records
  ADD COLUMN IF NOT EXISTS tact_time_seconds numeric,
  ADD COLUMN IF NOT EXISTS cavity_count integer;

COMMENT ON COLUMN public.production_records.tact_time_seconds IS
  '기록 시점의 Tact Time(초). NULL=레거시(스냅샷 없음). 과거 기록 수정 시 현재 공정 값으로 역사가 덮이는 것을 막는다.';
COMMENT ON COLUMN public.production_records.cavity_count IS
  '기록 시점의 Cavity 수. NULL=레거시(스냅샷 없음).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. 저장 RPC 가 tact/cavity 스냅샷을 함께 기록하도록 갱신 (시그니처 변경 없음)
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
      -- 휴무 처리: 생산 기록과 함께 그 교대의 비가동 입력도 지운다.
      -- (생산 기록만 지우면 downtime_entries 가 고아로 남아, 다음 저장 때 되살아나
      --  생산 0짜리 유령 레코드를 만든다)
      DELETE FROM public.downtime_entries de
      WHERE de.machine_id = p_machine_id
        AND de.date = p_date
        AND de.shift = v_shift;

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
        -- 스냅샷은 한 번 남으면 유지한다. 재저장 시에도 최초 기록 시점의 조건을 보존한다.
        tact_time_seconds = COALESCE(public.production_records.tact_time_seconds, EXCLUDED.tact_time_seconds),
        cavity_count      = COALESCE(public.production_records.cavity_count, EXCLUDED.cavity_count)
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. 생산 기록 삭제 시 비가동 입력도 함께 삭제 (원자적)
--
--    기존 DELETE /api/production-records/[recordId] 는 production_records 만 지웠다.
--    남은 downtime_entries 는 (machine_id, date, shift) 로 다시 로드되어, 같은 날짜를
--    재저장할 때 "비가동은 있는데 생산은 0" 인 레코드를 만들었다.
--    실측: 고아 downtime_entries 225건, 생산 0 + 비가동>0 레코드 4,840건.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.delete_production_record(p_record_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.production_records%ROWTYPE;
  v_deleted_entries integer := 0;
BEGIN
  SELECT * INTO v_row
  FROM public.production_records
  WHERE record_id = p_record_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'RECORD_NOT_FOUND';
  END IF;

  WITH deleted AS (
    DELETE FROM public.downtime_entries de
    WHERE de.machine_id = v_row.machine_id
      AND de.date = v_row.date
      AND de.shift = v_row.shift
    RETURNING de.id
  )
  SELECT count(*) INTO v_deleted_entries FROM deleted;

  DELETE FROM public.production_records
  WHERE record_id = p_record_id;

  RETURN jsonb_build_object(
    'record_id', v_row.record_id,
    'machine_id', v_row.machine_id,
    'date', v_row.date,
    'shift', v_row.shift,
    'output_qty', v_row.output_qty,
    'deleted_downtime_entries', v_deleted_entries
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.delete_production_record(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_production_record(uuid) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. 설비별 OEE 집계 (기간 + 교대 필터 적용)
--
--    엔지니어 화면의 설비별 표는 useRealtimeData 의 "설비별 최신 실적 1건" 과
--    "전역 최근 로그 100개" 로 계산되고 있었다. 실측상 그 100개가 커버하는 설비는
--    800대 중 34대뿐이라 나머지 766대는 비가동 0시간으로 표시됐고, 화면 상단의
--    기간/교대 필터는 이 표에 아예 적용되지 않았다.
--    화면과 같은 필터로 SQL 에서 집계해 내려준다.
-- ─────────────────────────────────────────────────────────────────────────────
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
  SELECT
    pr.machine_id,
    count(*)::bigint                                                AS total_records,
    COALESCE(avg(COALESCE(pr.availability, 0)::float8), 0::float8)  AS avg_availability,
    COALESCE(avg(COALESCE(pr.performance,  0)::float8), 0::float8)  AS avg_performance,
    COALESCE(avg(COALESCE(pr.quality,      0)::float8), 0::float8)  AS avg_quality,
    COALESCE(avg(COALESCE(pr.oee,          0)::float8), 0::float8)  AS avg_oee,
    COALESCE(sum(pr.output_qty), 0)::bigint                         AS total_output,
    COALESCE(sum(pr.defect_qty), 0)::bigint                         AS total_defect,
    count(*) FILTER (WHERE pr.downtime_minutes IS NULL)::bigint     AS unreported_records
  FROM production_records pr
  WHERE pr.date >= p_start_date
    AND (p_end_date    IS NULL OR pr.date       <= p_end_date)
    AND (p_machine_ids IS NULL OR pr.machine_id = ANY(p_machine_ids))
    AND (p_shifts      IS NULL OR pr.shift       = ANY(p_shifts))
    AND EXISTS (SELECT 1 FROM machines m WHERE m.id = pr.machine_id)
  GROUP BY pr.machine_id;
$function$;

REVOKE ALL ON FUNCTION public.analytics_oee_by_machine(date, date, uuid[], text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.analytics_oee_by_machine(date, date, uuid[], text[]) TO service_role, authenticated;
