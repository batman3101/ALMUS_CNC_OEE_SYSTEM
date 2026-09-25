-- Layout 계획 RPC 불변조건 실행 테스트 (20260925100000 ~ 120000).
--
-- **모든 쓰기는 롤백된다**: 마지막에 `ALL_INVARIANTS_PASSED` 예외를 던져 트랜잭션 전체를 되돌린다.
-- 실행: psql "$DATABASE_URL" -f supabase/tests/layout_planning_invariants.sql
-- 판정: 에러 메시지가 'ALL_INVARIANTS_PASSED' 로 시작하면 성공, 그 외 예외는 실패 원인.
--
-- 검사
--   L1  계획 저장: 활성 설비 전부에 행, 기준은 machines 값, 추천안 밖 설비는 keep
--   L2  다른 공장·비활성 설비는 추천안에 넣을 수 없다(UNKNOWN_MACHINE)
--   L3  미세조정: revision 증가, 오래된 revision 거부, 잠긴 설비 변경 거부, 잠금 해제+변경은 허용
--   L4  (모델, 공정) 짝이 안 맞는 배정은 FK 로 거부
--   L5  확정: 바뀐 설비만 machines 반영 + 셋업 작업·이벤트·감사 기록, 계획 confirmed
--   L6  두 번째 확정: 이전 확정은 superseded, 미완료 셋업은 cancelled 로 대체
--   L7  기준이 바뀐 계획은 확정 거부(LAYOUT_BASE_STALE), machines 는 그대로
--   L8  셋업 전이: 순서 강제, 이벤트 기록, 이벤트 수정 불가
--   L9  권한: RPC 는 anon/authenticated 실행 불가, 내부 함수는 service_role 도 불가
--   L10 도면: ALT 활성 도면 1개, 800대, 셀 중복 없음

do $$
declare
  v_alt uuid;
  v_alv uuid;
  v_m1 uuid; v_m2 uuid; v_m3 uuid;          -- ALT 설비 3대
  v_alv_machine uuid;
  v_model_a uuid; v_proc_a1 uuid; v_proc_a2 uuid;
  v_model_b uuid; v_proc_b1 uuid;
  v_plan uuid; v_plan2 uuid; v_plan3 uuid;
  v_task uuid;
  r jsonb;
  n integer;
  v_rev integer;
  v_active integer;
  v_ok boolean;
begin
  select id into v_alt from public.factories where code = 'ALT';
  select id into v_alv from public.factories where code = 'ALV';
  if v_alt is null then raise exception 'SETUP: ALT missing'; end if;

  -- 테스트 전용 모델 2개와 공정을 만든다(끝에 함께 롤백). 운영·로컬 어느 DB 에서 돌려도 같은 조건이 된다.
  insert into public.product_models (factory_id, model_name, is_active) values (v_alt, 'ZZ_LAYOUT_TEST_A', true) returning id into v_model_a;
  insert into public.product_models (factory_id, model_name, is_active) values (v_alt, 'ZZ_LAYOUT_TEST_B', true) returning id into v_model_b;
  insert into public.model_processes (factory_id, model_id, process_name, process_order, tact_time_seconds)
    values (v_alt, v_model_a, 'CNC #1', 1, 500) returning id into v_proc_a1;
  insert into public.model_processes (factory_id, model_id, process_name, process_order, tact_time_seconds)
    values (v_alt, v_model_a, 'CNC #2', 2, 450) returning id into v_proc_a2;
  insert into public.model_processes (factory_id, model_id, process_name, process_order, tact_time_seconds)
    values (v_alt, v_model_b, 'CNC #1', 1, 600) returning id into v_proc_b1;

  select id into v_m1 from public.machines where factory_id = v_alt and is_active
     and production_model_id is distinct from v_model_a order by name limit 1;
  select id into v_m2 from public.machines where factory_id = v_alt and is_active and id <> v_m1
     and production_model_id is distinct from v_model_a order by name limit 1;
  select id into v_m3 from public.machines where factory_id = v_alt and is_active and id not in (v_m1, v_m2)
   order by name limit 1;
  select id into v_alv_machine from public.machines where factory_id = v_alv limit 1;
  select count(*) into v_active from public.machines where factory_id = v_alt and is_active;

  -- [L10] 도면
  select count(*) into n from public.layout_geometries where factory_id = v_alt and is_active;
  if n <> 1 then raise exception 'L10 FAIL: active geometries %', n; end if;
  select count(*) into n from public.machine_layout_positions p
    join public.layout_geometries g on g.id = p.geometry_id and g.is_active where g.factory_id = v_alt;
  if n <> 800 then raise exception 'L10 FAIL: positions %', n; end if;

  -- [L1] 계획 저장: m1 → A/공정1, m2 → A/공정2 추천
  r := public.create_layout_plan(v_alt, null,
    jsonb_build_object('title', 'T', 'forecast_file_name', 'f.xlsx', 'forecast_file_hash', 'h', 'target_week', '2099-W01',
                       'period_start', '2099-01-01', 'period_end', '2099-01-07', 'capacity_policy', '{"breakMinutes":110}'),
    jsonb_build_array(jsonb_build_object('product_model_id', v_model_a, 'process_id', v_proc_a1, 'forecast_model_label', 'A',
                                         'peak_quantity', 1000, 'tact_time_seconds', 500, 'daily_capacity_per_machine', 146,
                                         'required_machines', 7)),
    jsonb_build_array(
      jsonb_build_object('machine_id', v_m1, 'recommended_model_id', v_model_a, 'recommended_process_id', v_proc_a1, 'recommendation_reason', 'shortage_fill'),
      jsonb_build_object('machine_id', v_m2, 'recommended_model_id', v_model_a, 'recommended_process_id', v_proc_a2, 'recommendation_reason', 'shortage_fill')));
  v_plan := (r->>'plan_id')::uuid;
  select count(*) into n from public.layout_plan_assignments where plan_id = v_plan;
  if n <> v_active then raise exception 'L1 FAIL: % rows for % active machines', n, v_active; end if;
  select count(*) into n from public.layout_plan_assignments a join public.machines m on m.id = a.machine_id
   where a.plan_id = v_plan and (a.base_model_id is distinct from m.production_model_id or a.base_process_id is distinct from m.current_process_id);
  if n <> 0 then raise exception 'L1 FAIL: base differs from machines on % rows', n; end if;
  select count(*) into n from public.layout_plan_assignments where plan_id = v_plan and machine_id = v_m3
     and recommendation_reason = 'keep' and final_model_id is not distinct from base_model_id;
  if n <> 1 then raise exception 'L1 FAIL: machine outside recommendation not kept'; end if;

  -- [L2] 다른 공장 설비는 거부
  v_ok := false;
  begin
    perform public.create_layout_plan(v_alt, null,
      jsonb_build_object('title', 'T', 'forecast_file_name', 'f', 'forecast_file_hash', 'h', 'target_week', 'w', 'period_start', '2099-01-01', 'period_end', '2099-01-01'),
      '[]'::jsonb, jsonb_build_array(jsonb_build_object('machine_id', v_alv_machine, 'recommended_model_id', v_model_a, 'recommended_process_id', v_proc_a1)));
  exception when others then v_ok := sqlerrm like 'UNKNOWN_MACHINE%';
  end;
  if not v_ok then raise exception 'L2 FAIL: cross-factory machine accepted'; end if;

  -- [L3] 미세조정: m3 → B, 잠금
  r := public.save_layout_plan_draft(v_alt, v_plan, 1, null,
    jsonb_build_array(jsonb_build_object('machine_id', v_m3, 'final_model_id', v_model_b, 'final_process_id', v_proc_b1, 'is_locked', true)));
  if (r->>'revision')::int <> 2 then raise exception 'L3 FAIL: revision %', r->>'revision'; end if;
  v_ok := false;
  begin
    perform public.save_layout_plan_draft(v_alt, v_plan, 1, null, '[]'::jsonb);
  exception when others then v_ok := sqlerrm = 'PLAN_REVISION_CONFLICT';
  end;
  if not v_ok then raise exception 'L3 FAIL: stale revision accepted'; end if;
  v_ok := false;
  begin
    perform public.save_layout_plan_draft(v_alt, v_plan, 2, null,
      jsonb_build_array(jsonb_build_object('machine_id', v_m3, 'final_model_id', v_model_a, 'final_process_id', v_proc_a1)));
  exception when others then v_ok := sqlerrm like 'ASSIGNMENT_LOCKED%';
  end;
  if not v_ok then raise exception 'L3 FAIL: locked machine changed'; end if;
  -- 잠금 해제 + 변경은 한 요청에서 허용, 그다음 다시 B 로 되돌리고 잠금
  r := public.save_layout_plan_draft(v_alt, v_plan, 2, null,
    jsonb_build_array(jsonb_build_object('machine_id', v_m3, 'final_model_id', v_model_a, 'final_process_id', v_proc_a1, 'is_locked', false)));
  r := public.save_layout_plan_draft(v_alt, v_plan, 3, null,
    jsonb_build_array(jsonb_build_object('machine_id', v_m3, 'final_model_id', v_model_b, 'final_process_id', v_proc_b1, 'is_locked', true)));
  v_rev := (r->>'revision')::int;

  -- [L4] 다른 모델의 공정을 붙이면 FK 로 거부
  v_ok := false;
  begin
    perform public.save_layout_plan_draft(v_alt, v_plan, v_rev, null,
      jsonb_build_array(jsonb_build_object('machine_id', v_m1, 'final_model_id', v_model_b, 'final_process_id', v_proc_a1)));
  exception when foreign_key_violation then v_ok := true;
  end;
  if not v_ok then raise exception 'L4 FAIL: mismatched model/process accepted'; end if;

  -- [L5] 확정
  r := public.confirm_layout_plan(v_alt, v_plan, v_rev, null);
  if (r->>'changed_machines')::int <> 3 then raise exception 'L5 FAIL: changed %', r->>'changed_machines'; end if;
  select count(*) into n from public.machines where id = v_m1 and production_model_id = v_model_a and current_process_id = v_proc_a1;
  if n <> 1 then raise exception 'L5 FAIL: m1 not applied'; end if;
  select count(*) into n from public.machines where id = v_m3 and production_model_id = v_model_b and current_process_id = v_proc_b1;
  if n <> 1 then raise exception 'L5 FAIL: m3 fine-tune not applied'; end if;
  select count(*) into n from public.machine_setup_tasks where plan_id = v_plan and status = 'pending';
  if n <> 3 then raise exception 'L5 FAIL: setup tasks %', n; end if;
  select count(*) into n from public.audit_log where factory_id = v_alt and action = 'LAYOUT_APPLY' and new_values->>'layout_plan_id' = v_plan::text;
  if n <> 3 then raise exception 'L5 FAIL: audit rows %', n; end if;
  select count(*) into n from public.layout_plans where id = v_plan and status = 'confirmed' and confirmed_at is not null;
  if n <> 1 then raise exception 'L5 FAIL: plan not confirmed'; end if;

  -- [L6] 두 번째 계획: m1 을 다시 B 로 → 이전 확정 superseded, m1 의 대기 셋업은 cancelled
  r := public.create_layout_plan(v_alt, null,
    jsonb_build_object('title', 'T2', 'forecast_file_name', 'f', 'forecast_file_hash', 'h', 'target_week', 'w', 'period_start', '2099-01-08', 'period_end', '2099-01-14'),
    '[]'::jsonb, jsonb_build_array(jsonb_build_object('machine_id', v_m1, 'recommended_model_id', v_model_b, 'recommended_process_id', v_proc_b1)));
  v_plan2 := (r->>'plan_id')::uuid;
  r := public.confirm_layout_plan(v_alt, v_plan2, 1, null);
  select count(*) into n from public.layout_plans where id = v_plan and status = 'superseded';
  if n <> 1 then raise exception 'L6 FAIL: first plan not superseded'; end if;
  select count(*) into n from public.machine_setup_tasks where plan_id = v_plan and machine_id = v_m1 and status = 'cancelled';
  if n <> 1 then raise exception 'L6 FAIL: old setup task not cancelled'; end if;
  select count(*) into n from public.machine_setup_tasks where factory_id = v_alt and machine_id = v_m1 and status in ('pending', 'in_progress');
  if n <> 1 then raise exception 'L6 FAIL: active tasks for m1 = %', n; end if;

  -- [L7] 기준이 바뀐 계획은 확정 거부
  r := public.create_layout_plan(v_alt, null,
    jsonb_build_object('title', 'T3', 'forecast_file_name', 'f', 'forecast_file_hash', 'h', 'target_week', 'w', 'period_start', '2099-01-15', 'period_end', '2099-01-21'),
    '[]'::jsonb, jsonb_build_array(jsonb_build_object('machine_id', v_m2, 'recommended_model_id', v_model_b, 'recommended_process_id', v_proc_b1)));
  v_plan3 := (r->>'plan_id')::uuid;
  update public.machines set production_model_id = v_model_a, current_process_id = v_proc_a1 where id = v_m3;
  v_ok := false;
  begin
    perform public.confirm_layout_plan(v_alt, v_plan3, 1, null);
  exception when others then v_ok := sqlerrm like 'LAYOUT_BASE_STALE%';
  end;
  if not v_ok then raise exception 'L7 FAIL: stale plan confirmed'; end if;
  select count(*) into n from public.machines where id = v_m2 and production_model_id = v_model_a and current_process_id = v_proc_a2;
  if n <> 1 then raise exception 'L7 FAIL: machine changed by rejected confirm'; end if;

  -- [L8] 셋업 전이
  select id into v_task from public.machine_setup_tasks where plan_id = v_plan and machine_id = v_m2 and status = 'pending';
  v_ok := false;
  begin
    perform public.transition_machine_setup_task(v_alt, v_task, 1, 'completed', null);
  exception when others then v_ok := sqlerrm like 'INVALID_SETUP_TRANSITION%';
  end;
  if not v_ok then raise exception 'L8 FAIL: pending -> completed allowed'; end if;
  r := public.transition_machine_setup_task(v_alt, v_task, 1, 'in_progress', null);
  r := public.transition_machine_setup_task(v_alt, v_task, 2, 'completed', null);
  select count(*) into n from public.machine_setup_events where task_id = v_task;
  if n <> 3 then raise exception 'L8 FAIL: events %', n; end if;
  v_ok := false;
  begin
    update public.machine_setup_events set reason = 'x' where task_id = v_task;
  exception when others then v_ok := sqlerrm like '%append-only%';
  end;
  if not v_ok then raise exception 'L8 FAIL: event history editable'; end if;

  -- [L9] 권한
  if has_function_privilege('anon', 'public.confirm_layout_plan(uuid, uuid, integer, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.confirm_layout_plan(uuid, uuid, integer, uuid)', 'execute')
     or has_function_privilege('authenticated', 'public.create_layout_plan(uuid, uuid, jsonb, jsonb, jsonb)', 'execute')
     or has_function_privilege('service_role', 'public.apply_layout_machine_assignment(uuid, uuid, uuid, uuid, uuid, uuid)', 'execute')
     or has_table_privilege('anon', 'public.layout_plans', 'select')
     or has_table_privilege('authenticated', 'public.layout_plans', 'insert') then
    raise exception 'L9 FAIL: privilege leak';
  end if;
  if not has_function_privilege('service_role', 'public.confirm_layout_plan(uuid, uuid, integer, uuid)', 'execute') then
    raise exception 'L9 FAIL: service_role cannot confirm';
  end if;

  raise exception 'ALL_INVARIANTS_PASSED (L1-L10)';
end;
$$;
