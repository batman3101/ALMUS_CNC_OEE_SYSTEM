-- Layout 확정은 설비 정보를 바꾸지 않는다. 현장에서 설비별로 셋업 '완료'를 누를 때 그 설비만 바꾼다
-- (사용자 결정 2026-09-28).
--
-- ## 왜
--
-- 예전 confirm_layout_plan 은 확정 순간 바뀐 설비 전부를 machines 에 반영했다. 그런데 현장 교체는 하루 약
-- 30대씩, 생산과 병행한다(W40 추천이면 약 4일). 그동안 DB 는 새 모델인데 설비는 옛 모델로 돌고, 운영자가
-- 넣는 생산 실적은 새 모델의 T/T 로 계산돼 성능·OEE 가 틀린 값으로 저장된다(스냅샷이라 나중에 고쳐지지 않는다).
-- Forecast 의 '현재 배치' 대수도 실제와 달라진다.
--
-- ## 무엇이 바뀌나
--
--   confirm_layout_plan         계획 고정 + 바뀐 설비의 셋업 작업(before → target) 생성. machines 는 쓰지 않는다.
--                               판단 재료인 계획 설비 전부를 FOR SHARE 로 잡고 기준이 그대로인지 확인한다(감사 BUG-02 유지).
--   transition_machine_setup_task
--                               '완료'로 바꿀 때 그 설비의 잠금(advisory → FOR UPDATE, 설비 잠금 규약)을 잡고:
--                                 · 설비가 셋업 시작 때(before) 그대로 → 목표로 바꾸고 LAYOUT_APPLY 감사 기록
--                                 · 이미 목표와 같다            → 쓰기 없이 완료
--                                 · 그 밖(누가 설비 현황에서 다른 모델로 바꿈) → SETUP_MACHINE_CHANGED 로 거부
--                                   (사용자 결정: 목표와 같으면 완료, 다르면 막고 알림)
--                               비활성 설비는 MACHINE_INACTIVE.
--
-- 두 함수 모두 **시그니처가 같다**(create or replace 가 덮어쓴다 — CLAUDE.md: 인자를 늘리면 오버로드가 생긴다).
-- 적용 순서는 상관없다: 코드는 같은 함수를 같은 인자로 부르고, 새 오류 코드만 추가로 알아듣는다.

begin;

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

  -- 계획의 모든 설비가 기준과 같아야 한다: 그 상태가 CAPA 계산과 셋업 작업(before)의 전제다.
  -- 확정은 이제 설비를 쓰지 않으므로 바뀌는 설비도 함께 FOR SHARE 로 잡는다(설비 id 순, 감사 BUG-02).
  perform 1
    from public.machines m
    join public.layout_plan_assignments a on a.machine_id = m.id and a.factory_id = m.factory_id
   where a.plan_id = p_plan_id and a.factory_id = p_factory_id
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
  v_machine_id uuid;
  v_machine public.machines%rowtype;
  v_applied boolean := false;
begin
  if p_factory_id is null then
    raise exception 'p_factory_id is required';
  end if;

  -- 완료는 설비를 쓸 수 있으므로 설비 잠금 규약대로 advisory 를 먼저 잡는다(같은 키 — apply_layout_machine_assignment
  -- 가 다시 잡아도 같은 트랜잭션이라 막히지 않는다). 설비 id 는 작업에서 바뀌지 않는 값이라 잠금 전에 읽어도 된다.
  select machine_id into v_machine_id from public.machine_setup_tasks
   where id = p_task_id and factory_id = p_factory_id;
  if not found then
    raise exception 'TASK_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_to_status = 'completed' then
    perform pg_advisory_xact_lock(hashtextextended(v_machine_id::text, 0));
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

  -- 완료 = 그 설비만 목표 모델·공정으로. 판단(지금 설비 상태)과 쓰기가 같은 잠금 아래 있다.
  if p_to_status = 'completed' then
    select * into v_machine from public.machines
     where id = v_task.machine_id and factory_id = p_factory_id
       for update;
    if not found then
      raise exception 'UNKNOWN_MACHINE %', v_task.machine_id using errcode = '22023';
    end if;
    if not v_machine.is_active then
      raise exception 'MACHINE_INACTIVE' using errcode = '55000';
    end if;
    if v_machine.production_model_id is not distinct from v_task.target_model_id
       and v_machine.current_process_id is not distinct from v_task.target_process_id then
      null; -- 이미 목표 상태(누가 설비 현황에서 먼저 바꿈) — 쓰지 않고 완료만 기록한다.
    elsif v_machine.production_model_id is not distinct from v_task.before_model_id
       and v_machine.current_process_id is not distinct from v_task.before_process_id then
      perform public.apply_layout_machine_assignment(
        v_task.machine_id, p_factory_id, v_task.before_model_id, v_task.before_process_id,
        v_task.target_model_id, v_task.target_process_id);
      v_applied := true;
      insert into public.audit_log (factory_id, table_name, record_id, action, old_values, new_values, changed_by)
      values (p_factory_id, 'machines', v_task.machine_id, 'LAYOUT_APPLY',
              jsonb_build_object('production_model_id', v_task.before_model_id, 'current_process_id', v_task.before_process_id),
              jsonb_build_object('production_model_id', v_task.target_model_id, 'current_process_id', v_task.target_process_id,
                                 'layout_plan_id', v_task.plan_id, 'setup_task_id', v_task.id),
              p_actor);
    else
      -- 셋업 시작 때와도, 목표와도 다르다: 덮어쓰면 누군가의 변경이 사라진다. 사람이 확인해야 한다.
      raise exception 'SETUP_MACHINE_CHANGED %', v_task.machine_id using errcode = '40001';
    end if;
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

  return jsonb_build_object('task_id', p_task_id, 'status', p_to_status, 'revision', v_task.revision + 1,
                            'machine_applied', v_applied);
end;
$$;

-- Supabase 가 PUBLIC EXECUTE 를 되돌려 주는 경우가 있어(2026-07-29 실측) 전수 회수 후 서비스 롤에만 준다.
-- apply_layout_machine_assignment 는 내부용이라 여전히 누구에게도 주지 않는다.
revoke all on function public.confirm_layout_plan(uuid, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.transition_machine_setup_task(uuid, uuid, integer, text, uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_layout_plan(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.transition_machine_setup_task(uuid, uuid, integer, text, uuid, text) to service_role;

commit;
