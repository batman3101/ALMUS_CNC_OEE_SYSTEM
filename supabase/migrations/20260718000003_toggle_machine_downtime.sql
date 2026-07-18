-- andon 비가동: 한 동작이 machine_logs(상태 구간) + downtime_entries(비가동 구간)를 함께 기록.
-- 두 소스는 OEE 계산이 유니온으로 한 번만 센다(calculateVerifiedDowntimeMinutesForWindow).
-- 설비별 advisory lock 으로 중복 open 을 막는다.
--
-- 실측 반영: downtime_entries.date·reason NOT NULL(is_planned 컬럼 없음). machine_logs.state
-- text NOT NULL. machines.current_state 는 ENUM machine_status → 캐스트. p_reason 은 라우트가
-- 8개 비정상 값으로 검증해 넘긴다. p_date 는 업무일자(라우트 계산).
create or replace function public.toggle_machine_downtime(
  p_machine_id uuid,
  p_action text,           -- 'start' | 'resume'
  p_reason text,           -- start 시 machine_status 값(INSPECTION 등). resume 시 무시.
  p_date date,             -- downtime_entries.date(NOT NULL).
  p_operator_id uuid
) returns jsonb language plpgsql as $$
declare now_ts timestamptz := now();
begin
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));

  if p_action = 'start' then
    update public.machine_logs set end_time = now_ts
      where machine_id = p_machine_id and end_time is null;
    insert into public.machine_logs(machine_id, state, start_time, operator_id)
      values (p_machine_id, p_reason, now_ts, p_operator_id);
    insert into public.downtime_entries(machine_id, date, start_time, reason, operator_id)
      values (p_machine_id, p_date, now_ts, p_reason, p_operator_id);
    update public.machines set current_state = p_reason::machine_status where id = p_machine_id;
    return jsonb_build_object('ok', true, 'state', p_reason);

  elsif p_action = 'resume' then
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
