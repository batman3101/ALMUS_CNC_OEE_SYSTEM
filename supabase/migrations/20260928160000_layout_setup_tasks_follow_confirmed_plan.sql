-- 셋업 작업과 확정 계획의 정합성·잠금 순서 (Codex 감사 2026-09-28, docs/AUDIT_LAYOUT_STUDIO_2026-09-28_F38167C.md).
--
-- F-01 새 계획을 확정해도 그 계획이 **그대로 두는** 설비의 옛 미완료 셋업이 살아남았다. 나중에 완료하면 확정 계획과
--      반대로 설비를 바꿨다(로컬 재현: P1 A→B 진행 중, P2 가 A 유지로 확정, P1 완료 → 설비 B).
--      → 확정 때 공장의 이전 미완료 셋업을 전부 이 계획과 대조: 출발·목표가 같으면 이어받고(진행 상태 유지), 아니면 취소.
--        완료 함수는 확정 계획의 작업만 시작·완료한다(SETUP_PLAN_NOT_CURRENT).
-- F-02 확정은 설비 → 작업, 완료는 작업 → 설비 순으로 잠가 동시 실행 시 교착(40P01)이 났다.
--      → 완료도 설비 advisory → 설비 행 → 작업 행. 확정은 그대로 설비 FOR SHARE(id 순) → 작업(설비 id 순).
--
-- 두 함수 모두 **시그니처가 같다**(create or replace 가 덮어쓴다). 코드보다 먼저 적용돼도 안전하다: 새 오류 코드
-- SETUP_PLAN_NOT_CURRENT 는 코드가 몰라도 일반 실패로 보이고, 정상 경로의 입력·출력은 같다.

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
  v_task public.machine_setup_tasks%rowtype;
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

  -- 이전 계획의 미완료 셋업은 **모두** 이 계획과 대조한다(감사 F-01, 2026-09-28). 예전에는 이 계획이 바꾸는 설비의
  -- 작업만 취소해서, 이 계획이 그대로 두는 설비의 옛 작업이 살아남았다가 나중에 완료되면 확정 계획과 반대로 설비를
  -- 바꿨다. 이제
  --   · 출발(before)·목표(target)가 이 계획의 기준·최종과 똑같은 작업 → 이 계획으로 이어받는다(진행 상태 유지)
  --   · 그 밖(이 계획이 유지하는 설비, 다른 목표, 계획에 없는 설비) → 취소
  -- 잠금 순서는 설비(위 FOR SHARE) → 작업(설비 id 순)이다. 셋업 완료도 같은 순서로 잡는다(감사 F-02).
  for v_task in
    select t.* from public.machine_setup_tasks t
     where t.factory_id = p_factory_id and t.plan_id <> p_plan_id and t.status in ('pending', 'in_progress')
     order by t.machine_id, t.id
       for update of t
  loop
    select a.* into v_row from public.layout_plan_assignments a
     where a.plan_id = p_plan_id and a.factory_id = p_factory_id and a.machine_id = v_task.machine_id;
    if found
       and (v_row.final_model_id is distinct from v_row.base_model_id or v_row.final_process_id is distinct from v_row.base_process_id)
       and v_task.before_model_id is not distinct from v_row.base_model_id and v_task.before_process_id is not distinct from v_row.base_process_id
       and v_task.target_model_id is not distinct from v_row.final_model_id and v_task.target_process_id is not distinct from v_row.final_process_id then
      update public.machine_setup_tasks
         set plan_id = p_plan_id, revision = revision + 1
       where id = v_task.id and factory_id = p_factory_id;
      insert into public.machine_setup_events (factory_id, task_id, from_status, to_status, actor, reason)
      values (p_factory_id, v_task.id, v_task.status, v_task.status, p_actor, 'carried over to layout plan ' || p_plan_id);
    else
      insert into public.machine_setup_events (factory_id, task_id, from_status, to_status, actor, reason)
      values (p_factory_id, v_task.id, v_task.status, 'cancelled', p_actor, 'superseded by layout plan ' || p_plan_id);
      update public.machine_setup_tasks
         set status = 'cancelled', cancelled_by = p_actor, cancelled_at = v_now,
             cancel_reason = 'superseded by layout plan ' || p_plan_id, revision = revision + 1
       where id = v_task.id and factory_id = p_factory_id;
    end if;
  end loop;

  -- 바뀌는 설비마다 셋업 작업 하나(이어받은 작업이 있으면 새로 만들지 않는다).
  for v_row in
    select a.* from public.layout_plan_assignments a
     where a.plan_id = p_plan_id and a.factory_id = p_factory_id
       and (a.final_model_id is distinct from a.base_model_id or a.final_process_id is distinct from a.base_process_id)
       and not exists (select 1 from public.machine_setup_tasks t
                        where t.plan_id = p_plan_id and t.machine_id = a.machine_id and t.status in ('pending', 'in_progress'))
     order by a.machine_id
  loop
    insert into public.machine_setup_tasks (
      factory_id, plan_id, machine_id, before_model_id, before_process_id, target_model_id, target_process_id
    ) values (
      p_factory_id, p_plan_id, v_row.machine_id, v_row.base_model_id, v_row.base_process_id,
      v_row.final_model_id, v_row.final_process_id
    ) returning id into v_task_id;
    insert into public.machine_setup_events (factory_id, task_id, from_status, to_status, actor, reason)
    values (p_factory_id, v_task_id, null, 'pending', p_actor, 'layout plan confirmed');
  end loop;

  select count(*) into v_changed from public.machine_setup_tasks
   where plan_id = p_plan_id and factory_id = p_factory_id and status in ('pending', 'in_progress');

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
  -- 잠금 순서: 설비 advisory → 설비 행 → 작업 행. 확정(설비 FOR SHARE → 작업)과 같은 순서라야 교착이 없다(감사 F-02:
  -- 예전에는 작업을 먼저 잡고 설비를 기다려, 설비를 잡고 작업을 기다리는 확정과 서로 막혔다).
  if p_to_status = 'completed' then
    perform pg_advisory_xact_lock(hashtextextended(v_machine_id::text, 0));
    perform 1 from public.machines where id = v_machine_id and factory_id = p_factory_id for update;
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
  -- 시작·완료는 지금 확정된 계획의 작업만(감사 F-01 보강). 새 확정이 이 작업을 이어받지 않았다면 취소됐어야 한다.
  if p_to_status in ('in_progress', 'completed')
     and not exists (select 1 from public.layout_plans p where p.id = v_task.plan_id and p.factory_id = p_factory_id and p.status = 'confirmed') then
    raise exception 'SETUP_PLAN_NOT_CURRENT %', v_task.plan_id using errcode = '55000';
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

revoke all on function public.confirm_layout_plan(uuid, uuid, integer, uuid) from public, anon, authenticated;
revoke all on function public.transition_machine_setup_task(uuid, uuid, integer, text, uuid, text) from public, anon, authenticated;
grant execute on function public.confirm_layout_plan(uuid, uuid, integer, uuid) to service_role;
grant execute on function public.transition_machine_setup_task(uuid, uuid, integer, text, uuid, text) to service_role;

commit;
