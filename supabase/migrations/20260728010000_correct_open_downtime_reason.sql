-- 진행 중인 비가동의 **사유 정정**. 분할이 아니라 덮어쓰기다.
--
-- [문제] toggle_machine_downtime 은 비가동 중 다른 사유로 start 를 부르면 기존 구간을
-- now() 에 닫고 새 구간을 연다(20260718000004, 88~101행). "상황이 바뀌었다"에는 정확하지만
-- "버튼을 잘못 눌렀다"에는 틀리다 — 존재한 적 없는 구간이 이력에 남고 OEE 에 반영된다.
--
-- [걸림돌] machines.current_state 를 UPDATE 하면 log_machine_status_change() 트리거가
-- **무조건** 열린 로그를 닫고 새 로그를 연다. 즉 트리거가 분할을 강제한다.
--
-- [해결] 트랜잭션 로컬 GUC 로 트리거에 "이건 전환이 아니라 정정"이라고 알린다.
-- app.status_operator_id 가 이미 같은 방식으로 쓰이고 있다(20260718000004).
--
-- ⚠️ 이 트리거는 machine_logs 의 **유일한 writer** 다(20260714 일원화 원칙). 플래그가 잘못
-- 켜지면 상태 변경이 조용히 기록되지 않는다. 방어:
--   1) set_config(..., true) 는 트랜잭션 로컬이라 다른 트랜잭션으로 새지 못한다
--   2) 이 파일의 correct_open_downtime_reason 외에는 아무도 설정하지 않는다
--   3) 일반 전환이 여전히 로그를 남기는지 회귀 테스트로 고정한다

-- 1) 트리거 함수: 정정 플래그가 켜져 있으면 로그를 분할하지 않는다.
--    나머지 동작은 20260718000004 와 동일하다(create or replace 로 대체).
create or replace function public.log_machine_status_change()
returns trigger
language plpgsql
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
    log_state text;
    v_operator uuid;
begin
    -- 사유 정정: 상태 전이가 아니므로 열린 로그를 닫지 않는다. 정정 RPC 가 machine_logs.state
    -- 를 직접 갱신하고, 이 트리거는 비켜선다.
    if coalesce(nullif(current_setting('app.suppress_status_log', true), ''), '0') = '1' then
        return new;
    end if;

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

-- 2) 정정 RPC. toggle_machine_downtime 과 **같은 advisory lock 키**를 잡아 정정과 토글이
--    경쟁하지 않게 한다.
create or replace function public.correct_open_downtime_reason(
  p_machine_id uuid,
  p_reason text,           -- machine_status 의 비정상 값(INSPECTION 등)
  p_operator_id uuid
) returns jsonb language plpgsql as $$
declare
  v_state text;
  v_entry_id uuid;
  v_old_reason text;
  v_logs_updated int := 0;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
  select current_state::text into v_state from public.machines where id = p_machine_id;

  if v_state is null then
    return jsonb_build_object('ok', false, 'reason', 'machine_not_found');
  end if;
  -- 진행 중인 비가동만 정정한다. 종료된 비가동은 확정 OEE 스냅샷을 건드리게 되므로 범위 밖.
  if v_state = 'NORMAL_OPERATION' then
    return jsonb_build_object('ok', false, 'reason', 'not_in_downtime');
  end if;
  if v_state = p_reason then
    return jsonb_build_object('ok', true, 'state', v_state, 'noop', true);
  end if;

  -- 트리거에게 "전환이 아니라 정정"이라고 알린다(트랜잭션 로컬).
  perform set_config('app.suppress_status_log', '1', true);

  update public.machine_logs
    set state = p_reason
    where machine_id = p_machine_id and end_time is null and state <> 'NORMAL_OPERATION';
  get diagnostics v_logs_updated = row_count;

  -- 열린 항목 중 **가장 최근 것 하나만** 고친다. 지금 운영 데이터에 유령 열린 항목은 없지만
  -- (2026-07-28 확인), 있더라도 무관한 행의 사유를 덮지 않게 하는 값싼 보험이다.
  select id, reason into v_entry_id, v_old_reason
    from public.downtime_entries
    where machine_id = p_machine_id and end_time is null
    order by start_time desc
    limit 1;

  if v_entry_id is not null then
    update public.downtime_entries set reason = p_reason where id = v_entry_id;
  end if;

  update public.machines set current_state = p_reason::machine_status where id = p_machine_id;

  -- 정정은 이력 수정이다. 누가 무엇을 언제 바꿨는지 남긴다.
  -- ⚠️ audit_log.action 은 varchar(20) 이다. 23자짜리 'correct_downtime_reason' 을 넣었더니
  -- RPC 가 22001 로 **항상** 실패했다(2026-07-28 운영 적용 직후 라이브 검증에서 발견).
  -- SQL 텍스트 계약 테스트는 컬럼 폭을 알 수 없어 이걸 잡지 못한다. 값을 바꿀 때 길이를 확인할 것.
  -- table_name='downtime_entries' 가 이미 맥락을 주므로 'correct_reason'(14자)으로 충분하다.
  insert into public.audit_log (table_name, record_id, action, old_values, new_values, changed_by)
  values (
    'downtime_entries',
    v_entry_id,
    'correct_reason',
    jsonb_build_object('reason', coalesce(v_old_reason, v_state), 'current_state', v_state),
    jsonb_build_object('reason', p_reason, 'current_state', p_reason),
    p_operator_id
  );

  return jsonb_build_object(
    'ok', true,
    'state', p_reason,
    'entry_updated', v_entry_id is not null,
    'logs_updated', v_logs_updated
  );
end; $$;

revoke all on function public.correct_open_downtime_reason(uuid, text, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.correct_open_downtime_reason(uuid, text, uuid) to service_role;
