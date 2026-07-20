-- F6(감사): andon 비가동 토글을 멱등하게 만들고, machine_logs 이중 기록을 제거한다.
--
-- [결함 1 — 멱등] 000003 은 start 중복 호출 시 첫 구간을 0초로 닫고 새 구간을 열어 유령 짧은
-- 구간을 만들고, resume 중복 호출 시 열린 NORMAL 로그를 계속 새로 쌓았다. 네트워크 재시도·
-- 더블탭에서 발생.
--
-- [결함 2 — 이중 기록] 000003 RPC 는 machine_logs 를 직접 닫고/삽입한 뒤 machines.current_state
-- 를 갱신하는데, 그 갱신이 machines_status_change_trigger(log_machine_status_change())를
-- 발동시켜 같은 트랜잭션에서 한 번 더 닫고/삽입한다. 결과: 상태 전환 1회당 로그 2행
-- (RPC 행은 트리거가 같은 시각으로 닫아 duration=0 유령이 되고, 트리거 행이 살아남는다).
-- 2026-07-20 실측: 7/13 이후 로그 135건 중 36건(27%)이 이 패턴의 0분 유령 행이었고,
-- 운영자 화면 '최근 작업' 피드에 모든 전환이 두 번씩 표시됐다.
--
-- 해결:
--   멱등   → 진입 시 machines.current_state(v_state)를 읽어 실제 전이가 있을 때만 write.
--            start: 이미 같은 사유로 비가동 중이면 no-op. 다른 비정상 사유면 정상 전이.
--            resume: 이미 NORMAL(또는 설비 없음)이면 no-op.
--   이중기록 → 20260714 원칙("machine_logs 의 writer 는 트리거 하나로 일원화")을 RPC 에도
--            적용한다. RPC 는 machine_logs 를 직접 쓰지 않고 current_state 갱신으로 트리거에
--            위임한다. operator_id 는 트랜잭션-로컬 GUC(app.status_operator_id)로 전달하고
--            log_machine_status_change() 가 auth.uid() 대신 우선 사용한다
--            (service_role 경유 호출에서는 auth.uid() 가 NULL 이라 GUC 없이는 유실된다).
--
-- advisory lock 은 유지(동시 호출 직렬화). create or replace 로 기존 함수를 그대로 대체한다.
-- 기존 유령 행(end_time = start_time 쌍둥이)은 이 마이그레이션이 정리하지 않는다 —
-- 신규 발생만 차단한다. 정리 SQL 은 docs/MIGRATION_APPLY_PLAN_2026-07-15.md 참조.

-- 1) 트리거 함수: operator 를 GUC 에서 우선 읽는다. 나머지 동작(열린 로그 닫기 + duration
--    계산 + 새 로그 열기)은 운영 배포본과 동일하다.
create or replace function public.log_machine_status_change()
returns trigger
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
    log_state text;
    v_operator uuid;
begin
    -- machine_status ENUM 값은 machine_logs 허용 값과 1:1 이다. 알 수 없는 값만 방어한다.
    log_state := case
        when new.current_state::text in (
            'NORMAL_OPERATION', 'INSPECTION', 'BREAKDOWN_REPAIR', 'PM_MAINTENANCE',
            'MODEL_CHANGE', 'PLANNED_STOP', 'PROGRAM_CHANGE', 'TOOL_CHANGE', 'TEMPORARY_STOP'
        ) then new.current_state::text
        else 'NORMAL_OPERATION'
    end;

    -- service_role 경유(RPC)에서는 auth.uid() 가 NULL 이므로 호출자가 심은 GUC 를 우선한다.
    v_operator := coalesce(
        nullif(current_setting('app.status_operator_id', true), '')::uuid,
        auth.uid()
    );

    update machine_logs
    set end_time = now(),
        duration = extract(epoch from (now() - start_time)) / 60
    where machine_id = new.id
      and end_time is null;

    insert into machine_logs (machine_id, state, start_time, end_time, operator_id, created_at)
    values (new.id, log_state, now(), null, v_operator, now());

    return new;
end;
$function$;

-- 2) andon RPC: 멱등 + machine_logs 는 트리거에 위임(직접 기록 없음).
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
  if v_state is null then
    return jsonb_build_object('ok', false, 'reason', 'machine_not_found');
  end if;

  -- 트리거(log_machine_status_change)가 이 트랜잭션의 operator 를 읽을 수 있게 심는다.
  perform set_config('app.status_operator_id', coalesce(p_operator_id::text, ''), true);

  if p_action = 'start' then
    -- 멱등: 이미 같은 사유로 비가동 중이면 아무것도 하지 않는다(유령 구간 방지).
    if v_state = p_reason then
      return jsonb_build_object('ok', true, 'state', v_state, 'noop', true);
    end if;
    -- 사유 변경(비정상→다른 비정상) 시 이전 비가동 구간이 열린 채 남지 않게 닫는다.
    update public.downtime_entries set end_time = now_ts
      where machine_id = p_machine_id and end_time is null;
    insert into public.downtime_entries(machine_id, date, start_time, reason, operator_id)
      values (p_machine_id, p_date, now_ts, p_reason, p_operator_id);
    -- machine_logs 는 여기서 직접 쓰지 않는다 — 아래 UPDATE 가 트리거를 발동시켜
    -- 같은 트랜잭션에서 열린 로그를 닫고 새 로그를 연다(writer 일원화).
    update public.machines set current_state = p_reason::machine_status where id = p_machine_id;
    return jsonb_build_object('ok', true, 'state', p_reason);

  elsif p_action = 'resume' then
    -- 멱등: 이미 가동 중이면 아무것도 하지 않는다(NORMAL 로그 중복 적재 방지).
    if v_state = 'NORMAL_OPERATION' then
      return jsonb_build_object('ok', true, 'state', 'NORMAL_OPERATION', 'noop', true);
    end if;
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
