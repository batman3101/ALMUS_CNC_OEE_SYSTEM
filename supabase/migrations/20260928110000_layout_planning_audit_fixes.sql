-- Layout 계획: Codex 감사(docs/AUDIT_LAYOUT_STUDIO_2026-09-28_CODEX.md) 수정 중 DB 가 필요한 두 건.
--
-- BUG-01  오류 셀뿐인 Forecast 수요가 0 으로 저장돼 설비가 다른 모델로 방출됐다. 앱은 이제 그런 수요를
--         '수요 불명'으로 다루고, 계획에 경고를 남긴다 → layout_plan_requirements.warnings 추가,
--         create_layout_plan 이 저장한다.
-- BUG-02  확정 시 유지 설비의 기준 비교가 잠금 없이 이뤄져 경합 창이 있었다 → confirm_layout_plan 이
--         유지 설비를 id 순 FOR SHARE 로 잡은 뒤 비교한다.
--
-- 두 함수 모두 **같은 이름·같은 인자**로 교체한다(create or replace). 인자를 바꾸면 오버로드가 생기므로
-- 바꾸지 않았다(CLAUDE.md). 앱 코드와 적용 순서가 바뀌어도 안전하다: 새 앱이 warnings 를 보내기 전에는
-- 빈 배열이 저장되고, 옛 앱이 새 함수를 불러도 warnings 누락은 빈 배열로 처리된다.

begin;

alter table public.layout_plan_requirements
  add column if not exists warnings text[] not null default '{}'::text[];

create or replace function public.create_layout_plan(
  p_factory_id uuid,
  p_actor uuid,
  p_plan jsonb,
  p_requirements jsonb,
  p_assignments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_geometry_id uuid;
  v_plan_id uuid;
  v_hash text;
  v_unknown uuid;
begin
  if p_factory_id is null then
    raise exception 'p_factory_id is required';
  end if;
  if jsonb_typeof(p_requirements) <> 'array' or jsonb_typeof(p_assignments) <> 'array' then
    raise exception 'requirements and assignments must be arrays' using errcode = '22023';
  end if;

  select id into v_geometry_id from public.layout_geometries
   where factory_id = p_factory_id and is_active;
  if v_geometry_id is null then
    raise exception 'NO_ACTIVE_GEOMETRY' using errcode = '55000';
  end if;

  -- 추천안에 이 공장의 활성 설비가 아닌 것이 섞여 있으면 거부한다(조용히 버리면 추천 대수가 틀어진다).
  select a.machine_id into v_unknown
    from jsonb_to_recordset(p_assignments) as a(machine_id uuid)
   where not exists (select 1 from public.machines m
                      where m.id = a.machine_id and m.factory_id = p_factory_id and m.is_active)
   limit 1;
  if v_unknown is not null then
    raise exception 'UNKNOWN_MACHINE %', v_unknown using errcode = '22023';
  end if;

  select md5(coalesce(string_agg(m.id::text || ':' || coalesce(m.production_model_id::text, '-') || ':'
                                 || coalesce(m.current_process_id::text, '-'), ',' order by m.id), ''))
    into v_hash
    from public.machines m
   where m.factory_id = p_factory_id and m.is_active;

  insert into public.layout_plans (
    factory_id, geometry_id, status, title, forecast_file_name, forecast_file_hash, target_week,
    period_start, period_end, capacity_policy, base_snapshot_hash, created_by, updated_by
  ) values (
    p_factory_id, v_geometry_id, 'draft', p_plan->>'title', p_plan->>'forecast_file_name',
    p_plan->>'forecast_file_hash', p_plan->>'target_week', (p_plan->>'period_start')::date,
    (p_plan->>'period_end')::date, coalesce(p_plan->'capacity_policy', '{}'::jsonb), v_hash, p_actor, p_actor
  ) returning id into v_plan_id;

  -- warnings: Forecast 수요 품질 경고(오류 셀 등)를 계획에 남긴다(감사 BUG-01). 없으면 빈 배열.
  insert into public.layout_plan_requirements (
    plan_id, factory_id, product_model_id, process_id, forecast_model_label, peak_quantity, peak_date,
    tact_time_seconds, daily_capacity_per_machine, required_machines, warnings
  )
  select v_plan_id, p_factory_id, r.product_model_id, r.process_id, r.forecast_model_label, r.peak_quantity,
         r.peak_date, r.tact_time_seconds, r.daily_capacity_per_machine, r.required_machines,
         coalesce(array(select jsonb_array_elements_text(r.warnings)), '{}'::text[])
    from jsonb_to_recordset(p_requirements) as r(
      product_model_id uuid, process_id uuid, forecast_model_label text, peak_quantity integer, peak_date date,
      tact_time_seconds numeric, daily_capacity_per_machine integer, required_machines integer, warnings jsonb);

  -- 활성 설비 전부에 행을 만든다. 추천안에 없는 설비는 그대로 유지(keep). 기준 배정은 클라이언트 값이 아니라
  -- 지금 machines 에 걸려 있는 값이다.
  insert into public.layout_plan_assignments (
    plan_id, factory_id, machine_id, base_model_id, base_process_id,
    recommended_model_id, recommended_process_id, final_model_id, final_process_id,
    recommendation_reason, is_locked, updated_by
  )
  select v_plan_id, p_factory_id, m.id, m.production_model_id, m.current_process_id,
         case when a.machine_id is null then m.production_model_id else a.recommended_model_id end,
         case when a.machine_id is null then m.current_process_id else a.recommended_process_id end,
         case when a.machine_id is null then m.production_model_id else a.recommended_model_id end,
         case when a.machine_id is null then m.current_process_id else a.recommended_process_id end,
         coalesce(a.recommendation_reason, 'keep'), coalesce(a.is_locked, false), p_actor
    from public.machines m
    left join jsonb_to_recordset(p_assignments) as a(
      machine_id uuid, recommended_model_id uuid, recommended_process_id uuid,
      recommendation_reason text, is_locked boolean) on a.machine_id = m.id
   where m.factory_id = p_factory_id and m.is_active;

  return jsonb_build_object('plan_id', v_plan_id, 'revision', 1, 'base_snapshot_hash', v_hash);
end;
$$;

create or replace function public.confirm_layout_plan(
  p_factory_id uuid,
  p_plan_id uuid,
  p_expected_revision integer,
  p_actor uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.layout_plans%rowtype;
  v_row record;
  v_task_id uuid;
  v_stale uuid;
  v_changed integer := 0;
  v_now timestamptz := now();
begin
  if p_factory_id is null then
    raise exception 'p_factory_id is required';
  end if;

  select * into v_plan from public.layout_plans
   where id = p_plan_id and factory_id = p_factory_id
   for update;
  if not found then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_plan.status <> 'draft' then
    raise exception 'PLAN_NOT_DRAFT' using errcode = '55000';
  end if;
  if v_plan.revision <> p_expected_revision then
    raise exception 'PLAN_REVISION_CONFLICT' using errcode = '40001';
  end if;

  -- 바꾸지 않는 설비도 기준과 같아야 한다: 그 설비들이 CAPA 계산의 전제다.
  -- 감사 BUG-02: 예전에는 잠금 없이 읽어서, 이 검사와 커밋 사이에 다른 요청이 유지 설비를 바꿀 수 있었다.
  -- 이제 유지 설비를 설비 id 순으로 FOR SHARE 로 잡는다. 행 잠금이라 잠금 테이블을 쓰지 않고(800대라도
  -- max_locks 64×60 을 먹지 않음), advisory 잠금을 거치지 않는 경로(설비 비활성화 DELETE 라우트의 직접
  -- UPDATE)까지 막는다. 바뀌는 설비는 여기서 잡지 않는다 — apply_layout_machine_assignment 가 규약대로
  -- advisory → FOR UPDATE 로 잡으며, 먼저 행을 잡아 두면 그 순서가 뒤집혀 교착이 생길 수 있다.
  perform 1
    from public.machines m
    join public.layout_plan_assignments a on a.machine_id = m.id and a.factory_id = m.factory_id
   where a.plan_id = p_plan_id and a.factory_id = p_factory_id
     and a.final_model_id is not distinct from a.base_model_id
     and a.final_process_id is not distinct from a.base_process_id
   order by m.id
     for share of m;

  select a.machine_id into v_stale
    from public.layout_plan_assignments a
    join public.machines m on m.id = a.machine_id and m.factory_id = a.factory_id
   where a.plan_id = p_plan_id and a.factory_id = p_factory_id
     and (m.production_model_id is distinct from a.base_model_id
          or m.current_process_id is distinct from a.base_process_id
          or not m.is_active)
   limit 1;
  if v_stale is not null then
    raise exception 'LAYOUT_BASE_STALE %', v_stale using errcode = '40001';
  end if;

  for v_row in
    select a.* from public.layout_plan_assignments a
     where a.plan_id = p_plan_id and a.factory_id = p_factory_id
       and (a.final_model_id is distinct from a.base_model_id or a.final_process_id is distinct from a.base_process_id)
     order by a.machine_id
  loop
    perform public.apply_layout_machine_assignment(
      v_row.machine_id, p_factory_id, v_row.base_model_id, v_row.base_process_id,
      v_row.final_model_id, v_row.final_process_id);

    -- 이전 확정에서 남은 미완료 셋업은 이 확정으로 대체된다.
    for v_task_id in
      select t.id from public.machine_setup_tasks t
       where t.factory_id = p_factory_id and t.machine_id = v_row.machine_id
         and t.status in ('pending', 'in_progress')
    loop
      insert into public.machine_setup_events (factory_id, task_id, from_status, to_status, actor, reason)
      select p_factory_id, t.id, t.status, 'cancelled', p_actor, 'superseded by layout plan ' || p_plan_id
        from public.machine_setup_tasks t where t.id = v_task_id;
      update public.machine_setup_tasks
         set status = 'cancelled', cancelled_by = p_actor, cancelled_at = v_now,
             cancel_reason = 'superseded by layout plan ' || p_plan_id, revision = revision + 1
       where id = v_task_id and factory_id = p_factory_id;
    end loop;

    insert into public.machine_setup_tasks (
      factory_id, plan_id, machine_id, before_model_id, before_process_id, target_model_id, target_process_id
    ) values (
      p_factory_id, p_plan_id, v_row.machine_id, v_row.base_model_id, v_row.base_process_id,
      v_row.final_model_id, v_row.final_process_id
    ) returning id into v_task_id;
    insert into public.machine_setup_events (factory_id, task_id, from_status, to_status, actor, reason)
    values (p_factory_id, v_task_id, null, 'pending', p_actor, 'layout plan confirmed');

    insert into public.audit_log (factory_id, table_name, record_id, action, old_values, new_values, changed_by)
    values (p_factory_id, 'machines', v_row.machine_id, 'LAYOUT_APPLY',
            jsonb_build_object('production_model_id', v_row.base_model_id, 'current_process_id', v_row.base_process_id),
            jsonb_build_object('production_model_id', v_row.final_model_id, 'current_process_id', v_row.final_process_id,
                               'layout_plan_id', p_plan_id),
            p_actor);
    v_changed := v_changed + 1;
  end loop;

  -- 공장당 확정은 하나(부분 유일 인덱스): 이전 확정을 먼저 내린다.
  update public.layout_plans
     set status = 'superseded', superseded_at = v_now, updated_by = p_actor
   where factory_id = p_factory_id and status = 'confirmed';

  update public.layout_plans
     set status = 'confirmed', confirmed_by = p_actor, confirmed_at = v_now,
         revision = revision + 1, updated_by = p_actor
   where id = p_plan_id and factory_id = p_factory_id;

  return jsonb_build_object('plan_id', p_plan_id, 'revision', v_plan.revision + 1, 'changed_machines', v_changed);
end;
$$;

-- create or replace 는 기존 권한을 유지하지만, Supabase 가 PUBLIC EXECUTE 를 되돌려 주는 경우가 있어
-- (2026-07-29 실측) 다시 전수 회수 후 서비스 롤에만 준다.
revoke all on function public.create_layout_plan(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.confirm_layout_plan(uuid, uuid, integer, uuid) from public, anon, authenticated;
grant execute on function public.create_layout_plan(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.confirm_layout_plan(uuid, uuid, integer, uuid) to service_role;

commit;
