-- BUG-006 / BUG-007
--
-- downtime_entries 를 생산 실적보다 먼저 독립 저장하면 생산 저장 실패/브라우저 이탈 시
-- 공식 통계에 고아 비가동이 남는다. 또한 같은 설비·영업일·교대의 겹치는 수동 입력은
-- duration_minutes 합산 시 이중 집계된다.
--
-- 기존 save_daily_production 시그니처는 유지한다. 새 화면/API만 아래 원자적 RPC로
-- 전환할 수 있도록 별도 함수를 제공한다.

CREATE OR REPLACE FUNCTION public.validate_downtime_entry_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NEW.start_time IS NULL OR NEW.end_time IS NULL OR NEW.end_time <= NEW.start_time THEN
    RAISE EXCEPTION 'downtime end_time must be later than start_time'
      USING ERRCODE = '22007';
  END IF;

  -- 공식 비가동은 반드시 같은 설비·영업일·교대의 생산 실적에 속한다.
  -- atomic RPC 는 production_records 를 먼저 upsert하므로 같은 트랜잭션에서도 통과한다.
  IF NOT EXISTS (
    SELECT 1
    FROM public.production_records pr
    WHERE pr.machine_id = NEW.machine_id
      AND pr.date = NEW.date
      AND pr.shift = NEW.shift
  ) THEN
    RAISE EXCEPTION 'downtime entry requires a matching production record'
      USING ERRCODE = '23503';
  END IF;

  -- [start, end) 반개구간을 사용하므로 11:00 종료와 11:00 시작은 겹침이 아니다.
  IF EXISTS (
    SELECT 1
    FROM public.downtime_entries existing
    WHERE existing.machine_id = NEW.machine_id
      AND existing.date = NEW.date
      AND existing.shift = NEW.shift
      AND existing.id IS DISTINCT FROM NEW.id
      AND tstzrange(existing.start_time, existing.end_time, '[)')
          && tstzrange(NEW.start_time, NEW.end_time, '[)')
  ) THEN
    RAISE EXCEPTION 'downtime entry overlaps an existing entry in the same machine/date/shift'
      USING ERRCODE = '23P01';
  END IF;

  -- 클라이언트가 보낸 duration_minutes 를 신뢰하지 않는다.
  NEW.duration_minutes := round(
    EXTRACT(EPOCH FROM (NEW.end_time - NEW.start_time)) / 60.0
  )::integer;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS validate_downtime_entry_before_write
  ON public.downtime_entries;

CREATE TRIGGER validate_downtime_entry_before_write
BEFORE INSERT OR UPDATE OF machine_id, date, shift, start_time, end_time
ON public.downtime_entries
FOR EACH ROW
EXECUTE FUNCTION public.validate_downtime_entry_write();

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
  v_shift_off boolean;
  v_entries jsonb;
  v_item jsonb;
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_entry_row public.downtime_entries%ROWTYPE;
BEGIN
  -- 기존 생산 저장/삭제 규칙을 재사용한다. 이 호출 이후 아래 비가동 교체 중 하나라도
  -- 실패하면 PostgreSQL 함수 호출 전체가 롤백된다.
  v_result := public.save_daily_production(
    p_machine_id,
    p_date,
    p_day_shift_off,
    p_night_shift_off,
    p_day_record,
    p_night_record
  );

  FOREACH v_shift IN ARRAY ARRAY['A', 'B'] LOOP
    IF v_shift = 'A' THEN
      v_shift_off := COALESCE(p_day_shift_off, false);
      v_entries := p_day_downtime_entries;
    ELSE
      v_shift_off := COALESCE(p_night_shift_off, false);
      v_entries := p_night_downtime_entries;
    END IF;

    -- NULL 은 하위 호환을 위한 "기존 비가동 유지"다. 빈 배열 []은 명시적 전체 삭제다.
    IF v_entries IS NULL THEN
      CONTINUE;
    END IF;

    IF jsonb_typeof(v_entries) <> 'array' THEN
      RAISE EXCEPTION 'downtime entries for shift % must be a JSON array', v_shift
        USING ERRCODE = '22023';
    END IF;

    IF v_shift_off AND jsonb_array_length(v_entries) > 0 THEN
      RAISE EXCEPTION 'off shift % cannot contain downtime entries', v_shift
        USING ERRCODE = '22023';
    END IF;

    -- 기존 함수가 휴무 처리 시에도 삭제하지만, [] 교체 계약을 위해 명시적으로 수행한다.
    DELETE FROM public.downtime_entries de
    WHERE de.machine_id = p_machine_id
      AND de.date = p_date
      AND de.shift = v_shift;

    IF v_shift_off THEN
      CONTINUE;
    END IF;

    -- 비가동만 있고 생산 실적이 없는 교대는 생성할 수 없다.
    IF jsonb_array_length(v_entries) > 0 AND NOT EXISTS (
      SELECT 1
      FROM public.production_records pr
      WHERE pr.machine_id = p_machine_id
        AND pr.date = p_date
        AND pr.shift = v_shift
    ) THEN
      RAISE EXCEPTION 'downtime entries require a saved production record for shift %', v_shift
        USING ERRCODE = '23503';
    END IF;

    FOR v_item IN SELECT value FROM jsonb_array_elements(v_entries) LOOP
      IF COALESCE(v_item ->> 'reason', '') = '' THEN
        RAISE EXCEPTION 'downtime reason is required for shift %', v_shift
          USING ERRCODE = '23502';
      END IF;

      v_start_time := (v_item ->> 'start_time')::timestamptz;
      v_end_time := (v_item ->> 'end_time')::timestamptz;

      INSERT INTO public.downtime_entries (
        machine_id,
        date,
        shift,
        start_time,
        end_time,
        duration_minutes,
        reason,
        description,
        operator_id
      ) VALUES (
        p_machine_id, p_date, v_shift,
        v_start_time,
        v_end_time,
        round(EXTRACT(EPOCH FROM (v_end_time - v_start_time)) / 60.0)::integer,
        v_item ->> 'reason',
        NULLIF(v_item ->> 'description', ''),
        NULLIF(v_item ->> 'operator_id', '')::uuid
      )
      RETURNING * INTO v_entry_row;

      v_saved_downtime := v_saved_downtime || to_jsonb(v_entry_row);
    END LOOP;
  END LOOP;

  RETURN v_result || jsonb_build_object(
    'saved_downtime_entries', v_saved_downtime
  );
END;
$function$;

COMMENT ON FUNCTION public.save_daily_production_with_downtime(
  uuid, date, boolean, boolean, jsonb, jsonb, jsonb, jsonb
) IS
  '생산 실적과 교대별 수동 비가동을 한 트랜잭션으로 저장한다. downtime NULL=유지, []=전체 삭제.';

REVOKE ALL ON FUNCTION public.save_daily_production_with_downtime(
  uuid, date, boolean, boolean, jsonb, jsonb, jsonb, jsonb
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_daily_production_with_downtime(
  uuid, date, boolean, boolean, jsonb, jsonb, jsonb, jsonb
) TO service_role;
