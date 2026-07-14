-- 설비 상태 변경 경로의 두 가지 결함을 함께 고친다.
--
-- [결함 1] machines 테이블에 log_machine_status_change() 를 실행하는 트리거가 두 개 걸려 있었다.
--
--   1) trigger_log_machine_status_change : BEFORE UPDATE, WHEN 절 없음   <-- 결함
--   2) machines_status_change_trigger    : AFTER UPDATE OF current_state,
--                                          WHEN (old.current_state IS DISTINCT FROM new.current_state)
--
--   log_machine_status_change() 는 "열린 로그를 모두 닫고 새 로그를 연다".
--   1) 은 가드가 없어 이름/모델/활성여부만 바꾸는 UPDATE 에도 발동했다.
--     -> 상태가 그대로인데 로그가 끊기고 같은 상태의 새 로그가 열린다 (로그 파편화).
--   실제 상태 변경 시에는 1) 과 2) 가 연달아 발동해 로그가 두 벌 생겼다.
--     -> 적용 시점 기준 동일 start_time 로그쌍 352건,
--        duration=0 이고 end_time=start_time 인 "순간" 로그 352건이 그 흔적이다.
--   (기존 데이터는 이 마이그레이션이 정리하지 않는다. 신규 발생만 차단한다)
--
-- [결함 2] API Route(PUT/PATCH)가 아래 4개를 개별 왕복으로 순차 실행하고
--          앞 3개의 실패는 콘솔 로그만 남긴 채 진행했다.
--            1) 열린 machine_logs 닫기  2) 새 machine_logs 삽입
--            3) machine_status_history 삽입  4) machines 갱신
--          4)가 실패하면 500을 반환하지만 1~3은 이미 커밋되어, current_state 와 로그가 어긋났다.
--          한 번 어긋나면 다음 변경 때 state 로 좁혀 열린 로그를 찾으므로 그 행을 찾지 못하고,
--          end_time=null 인 고아 로그가 영구히 남는다.
--          게다가 1)2) 는 위 트리거가 이미 하고 있던 일이라 writer 가 셋이었다.
--
-- 해법:
--   - 가드 없는 트리거를 제거하여 machine_logs 의 writer 를 트리거 하나로 일원화한다.
--     트리거는 UPDATE 와 같은 트랜잭션에서 실행되므로 원자성이 보장되고,
--     /api/admin/machines 등 다른 경로가 상태를 바꿔도 로그가 남는다.
--   - API 는 apply_machine_update() 하나만 호출한다. 이 함수는 로그를 직접 쓰지 않고,
--     트리거가 처리하지 않는 것(상태 이력 + 설비 행 갱신)만 담당한다.

-- 결함 1: 가드 없는 중복 트리거 제거 (machines_status_change_trigger 만 남긴다)
DROP TRIGGER IF EXISTS trigger_log_machine_status_change ON public.machines;

-- 결함 2: 설비 갱신을 단일 트랜잭션 RPC 로 통합
CREATE OR REPLACE FUNCTION public.apply_machine_update(
  p_machine_id uuid,
  p_updates jsonb,
  p_change_reason text DEFAULT NULL,
  p_changed_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_machine public.machines%ROWTYPE;
  v_result jsonb;
  v_new_state public.machine_status;
  v_now timestamptz := now();
  v_prev_started_at timestamptz;
  v_duration_minutes integer;
  v_state_changed boolean := false;
BEGIN
  IF p_machine_id IS NULL THEN
    RAISE EXCEPTION 'machine_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_updates IS NULL OR jsonb_typeof(p_updates) <> 'object' THEN
    RAISE EXCEPTION 'updates must be a json object' USING ERRCODE = '22023';
  END IF;

  -- 같은 설비에 대한 동시 상태 변경을 직렬화한다.
  SELECT * INTO v_machine
    FROM public.machines
   WHERE id = p_machine_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MACHINE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;

  -- 요청에 current_state 가 없으면 기존 상태를 유지한다.
  -- machine_status enum 에 없는 값이면 여기서 캐스팅 예외(22P02)가 나고 전체가 롤백된다.
  IF p_updates ? 'current_state' AND p_updates ->> 'current_state' IS NOT NULL THEN
    v_new_state := (p_updates ->> 'current_state')::public.machine_status;
  ELSE
    v_new_state := v_machine.current_state;
  END IF;

  v_state_changed := v_new_state IS DISTINCT FROM v_machine.current_state;

  -- 이전 상태의 지속 시간은 반드시 UPDATE 이전에 읽어야 한다.
  -- UPDATE 직후 트리거가 열린 로그를 닫아버리기 때문이다.
  -- machines.updated_at 은 상태와 무관한 수정으로도 갱신되므로 열린 로그의 시작 시각을 우선한다.
  IF v_state_changed THEN
    SELECT max(start_time) INTO v_prev_started_at
      FROM public.machine_logs
     WHERE machine_id = p_machine_id
       AND end_time IS NULL;

    v_prev_started_at := COALESCE(v_prev_started_at, v_machine.updated_at, v_now);
    v_duration_minutes := GREATEST(
      0,
      FLOOR(EXTRACT(EPOCH FROM (v_now - v_prev_started_at)) / 60)
    )::integer;
  END IF;

  -- 설비 행 갱신. 요청에 포함된 화이트리스트 키만 반영한다.
  -- current_state 가 바뀌면 machines_status_change_trigger 가 같은 트랜잭션에서
  -- 열린 로그를 닫고 새 로그를 연다 (machine_logs 는 여기서 직접 건드리지 않는다).
  UPDATE public.machines m
     SET name = CASE
                  WHEN p_updates ? 'name' AND p_updates ->> 'name' IS NOT NULL
                  THEN p_updates ->> 'name'
                  ELSE m.name
                END,
         location = CASE
                      WHEN p_updates ? 'location' THEN p_updates ->> 'location'
                      ELSE m.location
                    END,
         equipment_type = CASE
                            WHEN p_updates ? 'equipment_type' THEN p_updates ->> 'equipment_type'
                            ELSE m.equipment_type
                          END,
         is_active = CASE
                       WHEN p_updates ? 'is_active' AND p_updates ->> 'is_active' IS NOT NULL
                       THEN (p_updates ->> 'is_active')::boolean
                       ELSE m.is_active
                     END,
         current_state = v_new_state,
         production_model_id = CASE
                                 WHEN p_updates ? 'production_model_id'
                                 THEN NULLIF(p_updates ->> 'production_model_id', '')::uuid
                                 ELSE m.production_model_id
                               END,
         current_process_id = CASE
                                WHEN p_updates ? 'current_process_id'
                                THEN NULLIF(p_updates ->> 'current_process_id', '')::uuid
                                ELSE m.current_process_id
                              END,
         updated_at = v_now
   WHERE m.id = p_machine_id
  RETURNING to_jsonb(m.*) INTO v_result;

  -- 상태 변경 이력 (트리거는 이력을 남기지 않으므로 여기서 기록한다)
  IF v_state_changed THEN
    INSERT INTO public.machine_status_history (
      machine_id, previous_status, new_status, changed_by, change_reason, duration_minutes, created_at
    )
    VALUES (
      p_machine_id, v_machine.current_state, v_new_state, p_changed_by, p_change_reason,
      v_duration_minutes, v_now
    );
  END IF;

  RETURN jsonb_build_object(
    'machine', v_result,
    'state_changed', v_state_changed,
    'duration_minutes', CASE WHEN v_state_changed THEN v_duration_minutes ELSE NULL END
  );
END;
$function$;

-- 이 함수는 서버(API Route)의 service_role 클라이언트에서만 호출한다.
-- SECURITY DEFINER 이므로 브라우저에서 직접 호출 가능한 역할에는 권한을 주지 않는다.
REVOKE ALL ON FUNCTION public.apply_machine_update(uuid, jsonb, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_machine_update(uuid, jsonb, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.apply_machine_update(uuid, jsonb, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_machine_update(uuid, jsonb, text, uuid) TO service_role;
