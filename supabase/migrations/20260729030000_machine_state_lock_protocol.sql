-- 설비 상태 쓰기 경로의 **잠금 규약을 하나로 통일**한다.
--
-- [결함] 같은 설비의 상태를 바꾸는 함수가 넷인데, 서로 **다른 종류의 잠금**을 쓰고 있었다.
--
--   함수                            advisory    FOR UPDATE
--   apply_machine_update            ✗           ✓          <-- 규약에서 벗어난 유일한 함수
--   toggle_machine_downtime         ✓           ✗
--   correct_open_downtime_reason    ✓           ✗
--   upsert_downtime_entry           ✓           ✓          <-- 올바른 본보기
--
-- Postgres 에서 advisory lock 은 **독립된 네임스페이스**(pg_locks.locktype='advisory')다.
-- 행 잠금(locktype='tuple'/'transactionid')과 **서로를 차단하지 않는다.** 따라서
-- apply_machine_update 를 실행하는 트랜잭션과 andon/정정 RPC 를 실행하는 트랜잭션은
-- 같은 설비를 동시에 다뤄도 상호 배제되지 않았다. 잠금이 있는 것처럼 보이지만 없는 것과 같다.
--
-- [실제로 깨지는 것] 정정 RPC 와 상태 변경(PATCH)이 겹칠 때:
--   1. 정정: advisory lock 확보. current_state='INSPECTION' 을 읽는다(비가동 맞음 -> 통과).
--   2. 정정: 열린 비정상 machine_logs 를 센다 -> 1건. "고칠 대상이 있다"고 판단한다.
--   3. PATCH: advisory lock 을 잡지 않으므로 **차단되지 않는다.** FOR UPDATE 후
--      current_state 를 'NORMAL_OPERATION' 으로 바꾸고 커밋한다.
--      트리거가 열린 INSPECTION 로그를 닫고 NORMAL 로그를 연다.
--   4. 정정: app.suppress_status_log 를 켠 뒤 열린 비정상 로그를 갱신 -> **0건**(이미 NORMAL).
--   5. 정정: 트리거가 억제된 채 current_state 를 'TOOL_CHANGE' 로 바꾼다.
--
--   결과: machines.current_state='TOOL_CHANGE' 인데 열린 machine_logs 는 'NORMAL_OPERATION'.
--   20260714072100 이 세운 불변조건("machine_logs 의 writer 는 트리거 하나")이 깨진 상태로 남고,
--   20260729010000 이 추가한 no_open_downtime 가드는 **이 경합을 막지 못한다** —
--   그 가드의 읽기(2단계)와 쓰기(4·5단계)가 같은 잠금 아래 있지 않기 때문이다.
--   가드는 자기 트랜잭션 안에서만 참이고, 그 사이에 세상이 바뀐다.
--
-- [해법] advisory lock 을 **설비 상태의 유일한 잠금 규약**으로 정한다. 키는 이미 나머지 셋이
-- 쓰고 있는 것과 같아야 한다: hashtextextended(p_machine_id::text, 0).
-- apply_machine_update 도 이 잠금을 잡되, 기존 FOR UPDATE 는 남긴다(upsert_downtime_entry 와
-- 같은 형태). 순서는 **항상 advisory -> 행 잠금** 이어야 데드락이 생기지 않는다.
--
-- [함께 고치는 것] PATCH /api/machines/[machineId] 는 is_active 를 Node 에서 **먼저 조회한 뒤**
-- RPC 를 호출했다. 그 조회는 트랜잭션 밖이라 잠금과 무관하고, 조회와 쓰기 사이에 설비가
-- 비활성화될 수 있다(= 4단계와 같은 종류의 결함). 판단을 잠금 안으로 옮긴다:
-- p_require_active 를 받아 잠금을 잡은 뒤 확인하고 MACHINE_INACTIVE(55000)를 던진다.
-- 이는 upsert_downtime_entry 가 이미 쓰는 규약과 같아서 라우트의 매핑도 그대로 재사용된다.
-- p_require_active 의 기본값은 false 라 PUT/admin 경로의 동작은 바뀌지 않는다
-- (관리자는 비활성 설비의 정보를 계속 수정할 수 있어야 한다).

-- 인자가 늘었으므로 옛 4-인자 함수는 **반드시 지운다.** 남겨 두면 오버로드로 공존하고,
-- 잠금 없는 그 버전이 계속 호출될 수 있다 — 고치려던 결함이 그대로 살아남는다.
DROP FUNCTION IF EXISTS public.apply_machine_update(uuid, jsonb, text, uuid);

CREATE OR REPLACE FUNCTION public.apply_machine_update(
  p_machine_id uuid,
  p_updates jsonb,
  p_change_reason text DEFAULT NULL,
  p_changed_by uuid DEFAULT NULL,
  p_require_active boolean DEFAULT false
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
  v_new_active boolean;
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

  -- 설비 상태의 공용 잠금. toggle_machine_downtime / correct_open_downtime_reason /
  -- upsert_downtime_entry 와 **같은 키여야** 상호 배제가 성립한다. 키가 다르면 잠금은 무의미하다.
  -- 반드시 행 잠금보다 먼저 잡는다(모든 경로가 같은 순서 -> 데드락 없음).
  PERFORM pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));

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

  -- 아래 UPDATE 의 is_active CASE 와 **같은 규칙**으로 결과값을 미리 구한다.
  -- 이 호출이 스스로 설비를 다시 활성화하는 경우까지 비활성으로 판정하면 안 되기 때문이다.
  IF p_updates ? 'is_active' AND p_updates ->> 'is_active' IS NOT NULL THEN
    v_new_active := (p_updates ->> 'is_active')::boolean;
  ELSE
    v_new_active := v_machine.is_active;
  END IF;

  -- 운영 경로(PATCH)는 비활성 설비를 건드리지 않는다. 이 판단이 잠금 **안**에 있다는 점이 핵심 —
  -- 잠금 밖(Node)에서 미리 조회하면 조회 시점과 쓰기 시점 사이에 설비가 비활성화될 수 있다.
  -- 코드는 upsert_downtime_entry 와 같은 55000/MACHINE_INACTIVE 를 쓴다(라우트 매핑 재사용).
  IF p_require_active AND NOT v_new_active THEN
    RAISE EXCEPTION 'MACHINE_INACTIVE' USING ERRCODE = '55000';
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
         is_active = v_new_active,
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
REVOKE ALL ON FUNCTION public.apply_machine_update(uuid, jsonb, text, uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_machine_update(uuid, jsonb, text, uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.apply_machine_update(uuid, jsonb, text, uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_machine_update(uuid, jsonb, text, uuid, boolean) TO service_role;
