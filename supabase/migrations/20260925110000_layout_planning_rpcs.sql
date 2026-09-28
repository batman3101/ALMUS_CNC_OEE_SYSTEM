-- Layout 계획 쓰기 함수. 20260925100000 의 표에 대한 쓰기는 전부 여기를 거친다(표에는 쓰기 정책이 없다).
--
-- 호출자는 서비스 롤 라우트뿐이다. 인가(requireFactoryUser: 관리자·엔지니어, 셋업 전환은 운영자 포함)는
-- 라우트가 하고, 함수는 p_factory_id 로 모든 문장을 공장 범위에 묶는다. p_actor 는 기록용 사용자 id.
--
--   create_layout_plan              시뮬레이션 결과를 계획(draft)으로 저장. 기준 배정은 machines 에서 직접 읽는다.
--   save_layout_plan_draft          설비별 미세조정·잠금 저장. revision 으로 동시 편집 충돌을 막는다.
--   confirm_layout_plan             확정: 바뀐 설비의 모델·공정을 즉시 반영(PRD D15) + 셋업 작업 생성.
--   apply_layout_machine_assignment 확정 내부용: 설비 1대 잠금·검사·반영. 직접 호출 권한 없음.
--   transition_machine_setup_task   셋업 대기→진행→완료, 또는 취소(사유 필수).
--
-- 오류 규약 (라우트가 메시지로 구분해 409 등으로 바꾼다)
--   MACHINE_INACTIVE        55000  비활성 설비는 상태를 바꾸지 않는다(CLAUDE.md 규약).
--   LAYOUT_BASE_STALE       40001  계획을 만든 뒤 설비의 모델·공정이 바뀌었다 → 다시 시뮬레이션.
--   PLAN_REVISION_CONFLICT  40001  다른 사람이 먼저 저장했다 → 새로 읽고 다시.
--   PLAN_NOT_DRAFT          55000  확정·폐기된 계획은 고치지 않는다.
--   ASSIGNMENT_LOCKED       55000  잠근 설비의 배정을 바꾸려 했다.
--   NO_ACTIVE_GEOMETRY      55000  공장에 활성 도면이 없다.
--   UNKNOWN_MACHINE         22023  이 공장의 활성 설비가 아니다.
--   INVALID_SETUP_TRANSITION 55000 허용되지 않는 셋업 상태 전이.
--
-- 잠금: 설비를 쓰는 곳은 apply_layout_machine_assignment 하나이고, 설비 상태 잠금 규약
-- (advisory(hashtextextended(p_machine_id::text,0)) → FOR UPDATE)을 그대로 따른다. 여러 대를 바꿀 때는
-- 설비 id 순서로 부른다 — 모든 경로가 같은 순서로 잡아야 교착이 없다.

begin;

-- ── 계획 저장 ────────────────────────────────────────────────────────────────────────────────
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

  insert into public.layout_plan_requirements (
    plan_id, factory_id, product_model_id, process_id, forecast_model_label, peak_quantity, peak_date,
    tact_time_seconds, daily_capacity_per_machine, required_machines
  )
  select v_plan_id, p_factory_id, r.product_model_id, r.process_id, r.forecast_model_label, r.peak_quantity,
         r.peak_date, r.tact_time_seconds, r.daily_capacity_per_machine, r.required_machines
    from jsonb_to_recordset(p_requirements) as r(
      product_model_id uuid, process_id uuid, forecast_model_label text, peak_quantity integer, peak_date date,
      tact_time_seconds numeric, daily_capacity_per_machine integer, required_machines integer);

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

-- ── 미세조정 저장 ────────────────────────────────────────────────────────────────────────────
create or replace function public.save_layout_plan_draft(
  p_factory_id uuid,
  p_plan_id uuid,
  p_expected_revision integer,
  p_actor uuid,
  p_changes jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan public.layout_plans%rowtype;
  v_blocked uuid;
  v_missing uuid;
begin
  if p_factory_id is null then
    raise exception 'p_factory_id is required';
  end if;
  if jsonb_typeof(p_changes) <> 'array' then
    raise exception 'changes must be an array' using errcode = '22023';
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

  select c.machine_id into v_missing
    from jsonb_to_recordset(p_changes) as c(machine_id uuid)
   where not exists (select 1 from public.layout_plan_assignments a
                      where a.plan_id = p_plan_id and a.factory_id = p_factory_id and a.machine_id = c.machine_id)
   limit 1;
  if v_missing is not null then
    raise exception 'UNKNOWN_MACHINE %', v_missing using errcode = '22023';
  end if;

  -- 잠긴 설비는 잠금을 풀지 않는 한 배정을 바꿀 수 없다(같은 요청에서 잠금 해제 + 변경은 허용).
  select a.machine_id into v_blocked
    from public.layout_plan_assignments a
    join jsonb_to_recordset(p_changes) as c(machine_id uuid, final_model_id uuid, final_process_id uuid, is_locked boolean)
      on c.machine_id = a.machine_id
   where a.plan_id = p_plan_id and a.factory_id = p_factory_id
     and a.is_locked and coalesce(c.is_locked, true)
     and (a.final_model_id is distinct from c.final_model_id or a.final_process_id is distinct from c.final_process_id)
   limit 1;
  if v_blocked is not null then
    raise exception 'ASSIGNMENT_LOCKED %', v_blocked using errcode = '55000';
  end if;

  update public.layout_plan_assignments a
     set final_model_id = c.final_model_id,
         final_process_id = c.final_process_id,
         is_locked = coalesce(c.is_locked, a.is_locked),
         updated_by = p_actor
    from jsonb_to_recordset(p_changes) as c(machine_id uuid, final_model_id uuid, final_process_id uuid, is_locked boolean)
   where a.plan_id = p_plan_id and a.factory_id = p_factory_id and a.machine_id = c.machine_id;

  update public.layout_plans
     set revision = revision + 1, updated_by = p_actor
   where id = p_plan_id and factory_id = p_factory_id;

  return jsonb_build_object('plan_id', p_plan_id, 'revision', v_plan.revision + 1);
end;
$$;

-- ── 확정: 설비 1대 반영(내부용) ───────────────────────────────────────────────────────────────
create or replace function public.apply_layout_machine_assignment(
  p_machine_id uuid,
  p_factory_id uuid,
  p_expected_model_id uuid,
  p_expected_process_id uuid,
  p_model_id uuid,
  p_process_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_machine public.machines%rowtype;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
  select * into v_machine from public.machines where id = p_machine_id for update;

  if not found or v_machine.factory_id <> p_factory_id then
    raise exception 'UNKNOWN_MACHINE %', p_machine_id using errcode = '22023';
  end if;
  if not v_machine.is_active then
    raise exception 'MACHINE_INACTIVE' using errcode = '55000';
  end if;
  -- 판단과 쓰기가 같은 잠금 아래 있다: 계획을 만든 뒤 누가 이 설비의 배정을 바꿨으면 덮어쓰지 않는다.
  if v_machine.production_model_id is distinct from p_expected_model_id
     or v_machine.current_process_id is distinct from p_expected_process_id then
    raise exception 'LAYOUT_BASE_STALE %', p_machine_id using errcode = '40001';
  end if;

  update public.machines
     set production_model_id = p_model_id,
         current_process_id = p_process_id
   where id = p_machine_id;
end;
$$;

-- ── 확정 ─────────────────────────────────────────────────────────────────────────────────────
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

  -- 바꾸지 않는 설비도 기준과 같아야 한다: 그 설비들이 CAPA 계산의 전제다. (바뀌는 설비는 아래에서
  -- 잠금 아래 다시 검사한다.)
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

-- ── 셋업 상태 전이 ───────────────────────────────────────────────────────────────────────────
create or replace function public.transition_machine_setup_task(
  p_factory_id uuid,
  p_task_id uuid,
  p_expected_revision integer,
  p_to_status text,
  p_actor uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task public.machine_setup_tasks%rowtype;
begin
  if p_factory_id is null then
    raise exception 'p_factory_id is required';
  end if;

  select * into v_task from public.machine_setup_tasks
   where id = p_task_id and factory_id = p_factory_id
   for update;
  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_task.revision <> p_expected_revision then
    raise exception 'PLAN_REVISION_CONFLICT' using errcode = '40001';
  end if;
  -- 대기 → 진행 → 완료 순서만. 취소는 미완료에서만, 사유 필수.
  if not ((v_task.status = 'pending' and p_to_status = 'in_progress')
       or (v_task.status = 'in_progress' and p_to_status = 'completed')
       or (v_task.status in ('pending', 'in_progress') and p_to_status = 'cancelled' and coalesce(p_reason, '') <> '')) then
    raise exception 'INVALID_SETUP_TRANSITION % -> %', v_task.status, p_to_status using errcode = '55000';
  end if;

  update public.machine_setup_tasks
     set status = p_to_status,
         revision = revision + 1,
         started_by = case when p_to_status = 'in_progress' then p_actor else started_by end,
         started_at = case when p_to_status = 'in_progress' then now() else started_at end,
         completed_by = case when p_to_status = 'completed' then p_actor else completed_by end,
         completed_at = case when p_to_status = 'completed' then now() else completed_at end,
         cancelled_by = case when p_to_status = 'cancelled' then p_actor else cancelled_by end,
         cancelled_at = case when p_to_status = 'cancelled' then now() else cancelled_at end,
         cancel_reason = case when p_to_status = 'cancelled' then p_reason else cancel_reason end
   where id = p_task_id and factory_id = p_factory_id;

  insert into public.machine_setup_events (factory_id, task_id, from_status, to_status, actor, reason)
  values (p_factory_id, p_task_id, v_task.status, p_to_status, p_actor, p_reason);

  return jsonb_build_object('task_id', p_task_id, 'status', p_to_status, 'revision', v_task.revision + 1);
end;
$$;

-- ⚠️ 생략 금지: Supabase 는 새 함수에 PUBLIC EXECUTE 를 되돌려 줄 수 있다(2026-07-29 실측). 전부 회수한 뒤
-- 서비스 롤에만 준다. apply_layout_machine_assignment 는 confirm_layout_plan 안에서만 쓰므로 누구에게도 주지 않는다.
revoke all on function public.create_layout_plan(uuid, uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.save_layout_plan_draft(uuid, uuid, integer, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.apply_layout_machine_assignment(uuid, uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.confirm_layout_plan(uuid, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.transition_machine_setup_task(uuid, uuid, integer, text, uuid, text) from public, anon, authenticated;

grant execute on function public.create_layout_plan(uuid, uuid, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.save_layout_plan_draft(uuid, uuid, integer, uuid, jsonb) to service_role;
grant execute on function public.confirm_layout_plan(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.transition_machine_setup_task(uuid, uuid, integer, text, uuid, text) to service_role;

commit;
