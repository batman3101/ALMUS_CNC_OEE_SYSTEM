-- F6(감사): andon 비가동 토글을 멱등하게 만든다.
-- 000003 은 start 중복 호출 시 첫 구간을 0초로 닫고 새 구간을 열어 유령 짧은 구간을 만들고,
-- resume 중복 호출 시 열린 NORMAL 로그를 계속 새로 쌓았다. 네트워크 재시도·더블탭에서 발생.
--
-- 해결: 진입 시 machines.current_state 를 읽어(v_state) 실제 전이가 있을 때만 write 한다.
--   start  → 이미 같은 사유로 비가동 중(v_state = p_reason)이면 no-op.
--            다른 비정상 사유면 정상 전이(사유 변경 — 구간 닫고 새로 연다).
--   resume → 이미 NORMAL(또는 상태 미상)이면 no-op.
-- current_state 는 000003·상태변경 제거 이후 유일한 권위 있는 상태 소스라 판단 기준으로 안전하다.
-- advisory lock 은 유지(동시 호출 직렬화). create or replace 로 000003 함수를 그대로 대체한다.
create or replace function public.toggle_machine_downtime(
  p_machine_id uuid,
  p_action text,           -- 'start' | 'resume'
  p_reason text,           -- start 시 machine_status 값(INSPECTION 등). resume 시 무시.
  p_date date,             -- downtime_entries.date(NOT NULL).
  p_operator_id uuid
) returns jsonb language plpgsql as $$
declare
  now_ts timestamptz := now();
  v_state text;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
  select current_state::text into v_state from public.machines where id = p_machine_id;

  if p_action = 'start' then
    -- 멱등: 이미 같은 사유로 비가동 중이면 아무것도 하지 않는다(유령 구간 방지).
    if v_state = p_reason then
      return jsonb_build_object('ok', true, 'state', v_state, 'noop', true);
    end if;
    update public.machine_logs set end_time = now_ts
      where machine_id = p_machine_id and end_time is null;
    insert into public.machine_logs(machine_id, state, start_time, operator_id)
      values (p_machine_id, p_reason, now_ts, p_operator_id);
    insert into public.downtime_entries(machine_id, date, start_time, reason, operator_id)
      values (p_machine_id, p_date, now_ts, p_reason, p_operator_id);
    update public.machines set current_state = p_reason::machine_status where id = p_machine_id;
    return jsonb_build_object('ok', true, 'state', p_reason);

  elsif p_action = 'resume' then
    -- 멱등: 이미 가동(또는 상태 미상)이면 아무것도 하지 않는다(NORMAL 로그 중복 적재 방지).
    if v_state = 'NORMAL_OPERATION' or v_state is null then
      return jsonb_build_object('ok', true, 'state', 'NORMAL_OPERATION', 'noop', true);
    end if;
    update public.machine_logs set end_time = now_ts
      where machine_id = p_machine_id and end_time is null;
    insert into public.machine_logs(machine_id, state, start_time, operator_id)
      values (p_machine_id, 'NORMAL_OPERATION', now_ts, p_operator_id);
    update public.downtime_entries set end_time = now_ts
      where machine_id = p_machine_id and end_time is null;
    update public.machines set current_state = 'NORMAL_OPERATION'::machine_status where id = p_machine_id;
    return jsonb_build_object('ok', true, 'state', 'NORMAL_OPERATION');
  end if;

  return jsonb_build_object('ok', false, 'reason', 'invalid_action');
end; $$;

revoke all on function public.toggle_machine_downtime(uuid, text, text, date, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.toggle_machine_downtime(uuid, text, text, date, uuid) to service_role;
