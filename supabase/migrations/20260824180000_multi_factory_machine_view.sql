-- machines_with_production_info 뷰에 factory_id 를 싣는다
--
-- ## 왜 필요한가
--
-- 이 뷰는 tact time 의 출처다. 라우트 5곳이 설비 id 하나로 조회한다:
--
--   production-progress, production-records, production-records/[recordId],
--   production-records/daily, production-records/close-shift
--
-- 그런데 뷰에 `factory_id` 컬럼이 **없어서** 공장으로 좁힐 방법이 아예 없었다. 필터를
-- 깜빡한 것이 아니라 걸 수 있는 컬럼이 없었다 — 그래서 다섯 곳 모두 다른 공장 설비의
-- tact 를 id 만으로 읽을 수 있었다.
--
-- tact 는 OEE 의 분자다(`ideal_runtime = output_qty × tact / 60`). 남의 공장 tact 로 계산된
-- 성능 지표는 틀렸다는 표시조차 없이 저장된다 — `production_records` 는 tact 를 저장 시점
-- 스냅샷으로 박아 두므로, 나중에 고쳐도 그 행은 그대로 남는다.
--
-- ## 조인에도 공장을 건다
--
-- `m.production_model_id = pm.id` 만으로 조인하면, 모델 id 가 공장을 넘을 때 조용히 다른
-- 공장의 모델명·tact 를 붙인다. 지금은 복합 FK `(factory_id, production_model_id)` 가 그런
-- 참조 자체를 막지만(20260821110000), 조인이 그 사실에 **기대고 있는** 상태로 두지 않는다.
-- 제약이 언젠가 완화되면 이 조인은 조용히 틀린 답을 내기 시작한다.
--
-- ## security_invoker 는 유지한다
--
-- 20260715210000 이 켜 둔 값이다. 뷰를 다시 만들면 옵션이 날아가므로 여기서 다시 건다 —
-- 빠뜨리면 뷰가 정의자 권한으로 돌아 RLS 를 우회하고, 그것은 이 마이그레이션이 좁히려는
-- 경계를 정반대로 넓히는 결과가 된다.
--
-- ## 왜 replace 가 아니라 drop 인가
--
-- `create or replace view` 는 컬럼을 **맨 뒤에만** 붙일 수 있다. `factory_id` 를 `id` 다음에
-- 두려 하면 "cannot change name of view column" 로 거부된다(실측). 컬럼을 맨 뒤로 밀면
-- 통과하지만, 그러면 이 뷰를 `select *` 로 읽는 곳의 컬럼 순서가 바뀐다.
--
-- 의존 객체가 없음을 확인하고(이 뷰를 참조하는 다른 뷰는 없다) drop 한다. `cascade` 는
-- 쓰지 않는다 — 나중에 의존 객체가 생기면 조용히 지워지는 대신 여기서 멈춰야 한다.

begin;

drop view if exists public.machines_with_production_info;

create view public.machines_with_production_info as
  select
    m.id,
    -- 이 컬럼 하나가 이 마이그레이션의 요점이다. 나머지는 원본과 같다.
    m.factory_id,
    m.name,
    m.location,
    m.equipment_type,
    m.current_state,
    m.is_active,
    m.created_at,
    m.updated_at,
    m.production_model_id,
    m.current_process_id,
    pm.model_name as production_model_name,
    pm.description as production_model_description,
    mp.process_name as current_process_name,
    mp.process_order as current_process_order,
    mp.tact_time_seconds as current_tact_time,
    mp.cavity_count as current_cavity_count
  from public.machines m
    left join public.product_models pm
      on m.production_model_id = pm.id
     and pm.factory_id = m.factory_id
    left join public.model_processes mp
      on m.current_process_id = mp.id
     and mp.factory_id = m.factory_id;

alter view public.machines_with_production_info set (security_invoker = true);

-- 뷰를 다시 만들면 권한도 초기화된다. 원래 상태(service_role + authenticated 읽기)를
-- 복원한다 — 빠뜨리면 tact 조회가 42501 로 죽는다.
grant select on public.machines_with_production_info to service_role, authenticated;

/**
 * factory_id 가 실제로 실렸는지 확인한다.
 *
 * `create or replace view` 는 컬럼을 **뒤에만** 추가할 수 있다. 중간에 끼워 넣으면 실패한다
 * — 그래서 위 정의는 실은 `replace` 가 아니라 drop+create 가 필요할 수도 있었다. 통과했다는
 * 사실만으로 컬럼이 생겼다고 단정하지 않고 직접 본다.
 */
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'machines_with_production_info'
      and column_name = 'factory_id'
  ) then
    raise exception 'machines_with_production_info 에 factory_id 가 없습니다';
  end if;
end $$;

commit;
