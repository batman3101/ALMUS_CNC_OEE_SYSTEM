-- ALT/ALV 멀티테넌시 P1-9a: 트리거를 factory-aware 로
--
-- 계약: docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.md 4.3
--   "trigger/RPC 는 공장을 parent 에서 파생하고 요청이 전달한 factory 값은 일치 검증에만
--    사용한다."
--
-- ## 로컬 검증이 잡은 실패
--
-- contract(NOT NULL) 적용 후 **정상 생산기록 저장이 실패했다**:
--
--   insert into production_records (factory_id, machine_id, date, shift, output_qty)
--   values (ALT, ALT설비, '2026-08-21', 'A', 10);
--   -- ERROR: null value in column "factory_id" of relation "production_shift_states"
--   --        violates not-null constraint
--
-- `sync_production_shift_state_from_record` 트리거가 `production_shift_states` 에 행을
-- 만드는데 `factory_id` 를 채우지 않았다. 스키마만 factory-aware 가 되고 트리거가 그대로면
-- **앱이 아예 동작하지 않는다.**
--
-- 이 실패는 정적 분석으로 보이지 않는다. 계약 테스트 47건도, 타입 검사도, 마이그레이션
-- 문법 검사도 통과했다. 실제 행을 넣어 봐야 드러난다 — baseline 을 복원해 로컬 재현을
-- 가능하게 만든 값어치가 여기서 두 번째로 나온다.
--
-- ## 왜 NEW.factory_id 를 그대로 쓰나
--
-- 계약은 "parent 에서 파생"을 요구한다. 여기서 parent 는 `production_records` 행 자신이고,
-- 그 행의 `factory_id` 는 **복합 FK 가 이미 검증했다**:
--
--   production_records_factory_machine_id_fkey:
--     (factory_id, machine_id) -> machines(factory_id, id)
--
-- 즉 이 트리거가 보는 `NEW.factory_id` 는 "요청이 전달한 값"이 아니라 "DB 가 설비와 일치함을
-- 확인한 값"이다. 여기서 machines 를 다시 조회하는 것은 같은 사실을 두 번 묻는 것이고,
-- 행마다 조회가 늘어난다(생산기록은 하루 ~1,100행 들어온다).

begin;

create or replace function public.sync_production_shift_state_from_record()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_record public.production_records%ROWTYPE;
  v_status text;
BEGIN
  v_record := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_status := CASE WHEN TG_OP = 'DELETE' THEN 'MISSING' ELSE 'WORKING' END;

  -- factory_id 를 함께 넘긴다. 이 값은 복합 FK 가 설비와의 일치를 이미 검증한 것이다.
  INSERT INTO public.production_shift_states (factory_id, machine_id, date, shift, status)
  VALUES (v_record.factory_id, v_record.machine_id, v_record.date, v_record.shift, v_status)
  ON CONFLICT (machine_id, date, shift) DO UPDATE SET
    status = EXCLUDED.status,
    updated_at = clock_timestamp(),
    version = public.production_shift_states.version + 1;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

-- ON CONFLICT 대상은 (machine_id, date, shift) 그대로 둔다.
-- machine_id 가 이미 공장을 함의하므로(설비는 한 공장에만 속한다) 공장을 키에 더해도
-- 유일성이 좁아지지 않는다. 오히려 더하면 같은 설비의 같은 교대가 두 공장 라벨로 두 행이
-- 될 수 있어 **위험하다** — 그 상태는 복합 FK 로도 잡히지 않는다.

commit;
