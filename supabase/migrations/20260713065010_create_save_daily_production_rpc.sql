-- Transactional daily production save
-- Migration: create_save_daily_production_rpc
-- Date: 2026-07-13
--
-- 기존에는 /api/production-records/daily 가 교대(A/B)별로 delete/upsert 를 최대 4번의
-- 독립적인 PostgREST 왕복으로 순차 실행했다. 중간에 실패하면 앞선 교대의 쓰기는 이미
-- 커밋된 상태로 남아, 클라이언트는 500(전체 실패)을 받지만 DB 에는 하루치가 반쪽만
-- 적용되는 문제가 있었다.
--
-- 이 함수는 하루(A/B 두 교대)의 삭제/저장을 하나의 트랜잭션에서 처리한다.
-- OEE 지표(availability/performance/quality/oee 및 planned/actual/ideal runtime)는
-- API 라우트가 계산해서 넘겨준다. 지표 계산 로직을 PL/pgSQL 로 복제하면
-- planned_runtime 정의가 또 하나 늘어나므로(= 이번에 고친 버그의 원인),
-- 이 함수는 원자성만 책임진다.
--
-- 입력 레코드(jsonb) 형식:
--   { planned_runtime, actual_runtime, ideal_runtime, output_qty, defect_qty,
--     availability, performance, quality, oee }
-- 반환:
--   { "saved_records": [ production_records row, ... ], "deleted_shifts": ["A","B"] }

CREATE OR REPLACE FUNCTION public.save_daily_production(
  p_machine_id uuid,
  p_date date,
  p_day_shift_off boolean DEFAULT false,
  p_night_shift_off boolean DEFAULT false,
  p_day_record jsonb DEFAULT NULL,
  p_night_record jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      -- 휴무 교대: 기존 기록 삭제
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
      -- 정상 교대: 기록 저장 (machine_id, date, shift 유니크 제약 기준 upsert)
      INSERT INTO public.production_records (
        machine_id, date, shift,
        planned_runtime, actual_runtime, ideal_runtime,
        output_qty, defect_qty,
        availability, performance, quality, oee
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
        (v_record ->> 'oee')::numeric
      )
      ON CONFLICT (machine_id, date, shift) DO UPDATE SET
        planned_runtime = EXCLUDED.planned_runtime,
        actual_runtime  = EXCLUDED.actual_runtime,
        ideal_runtime   = EXCLUDED.ideal_runtime,
        output_qty      = EXCLUDED.output_qty,
        defect_qty      = EXCLUDED.defect_qty,
        availability    = EXCLUDED.availability,
        performance     = EXCLUDED.performance,
        quality         = EXCLUDED.quality,
        oee             = EXCLUDED.oee
      RETURNING * INTO v_row;

      v_saved := v_saved || to_jsonb(v_row);
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'saved_records', v_saved,
    'deleted_shifts', v_deleted
  );
END;
$$;

COMMENT ON FUNCTION public.save_daily_production(uuid, date, boolean, boolean, jsonb, jsonb)
  IS 'Saves one day of production records (shift A and B) atomically: deletes shift-off records and upserts the rest in a single transaction. OEE metrics are computed by the API route and passed in.';

-- 서비스 롤(API 라우트)만 실행 가능
REVOKE ALL ON FUNCTION public.save_daily_production(uuid, date, boolean, boolean, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_daily_production(uuid, date, boolean, boolean, jsonb, jsonb) TO service_role;
