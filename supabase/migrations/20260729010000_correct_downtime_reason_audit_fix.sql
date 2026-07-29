-- 정정 RPC 의 감사 기록이 record_id 를 NULL 로 넣어 **항상 실패하던** 경로를 고친다.
--
-- [증상] 설비 상태 입력 화면으로만 내려간 설비(= machine_logs 는 있고 열린 downtime_entries
-- 는 없는 설비)를 정정하면 RPC 전체가 롤백되고 API 가 500 을 반환한다.
--   ERROR 23502: null value in column "record_id" of relation "audit_log"
--
-- [원인] audit_log.record_id 는 NOT NULL 인데, 20260728010000 은 거기에 v_entry_id 를 넣었다.
-- 열린 항목이 없으면 그 값이 NULL 이다. 20260728010000 의 주석은 그 경우를 "올바른 동작"
-- 이라고 명시해 두고도, 바로 아래 INSERT 가 그것을 깨고 있었다. 같은 INSERT 에서 이미 한 번
-- (action 이 varchar(20) 을 넘겨) 터졌는데 그때 다른 컬럼 제약을 함께 보지 않았다.
--
-- [수정] 감사 대상을 machines 로 바꾼다. 정정은 **언제나** machines.current_state 를 바꾸므로
-- record_id 가 NULL 이 될 수 없다. 어떤 downtime_entry 가 함께 바뀌었는지는 값 payload 에
-- 싣는다(없으면 null 로 남아 "항목 없이 로그만 정정" 이 그대로 드러난다).
--
-- [추가 안전장치] 고칠 대상이 하나도 없으면(열린 비정상 로그도, 열린 항목도 없음) 아무것도
-- 쓰지 않고 no_open_downtime 을 돌려준다. 예전 순서는 트리거를 억제한 채 machines.current_state
-- 를 바꿔 버려서, 그 새 상태를 담은 machine_logs 행이 하나도 없는 상태가 될 수 있었다 —
-- 트리거가 machine_logs 의 유일한 writer 라는 불변조건(20260714)이 깨진다.
-- 그래서 쓰기 전에 먼저 읽고 판단한다.

create or replace function public.correct_open_downtime_reason(
  p_machine_id uuid,
  p_reason text,           -- machine_status 의 비정상 값(INSPECTION 등)
  p_operator_id uuid
) returns jsonb language plpgsql as $$
declare
  v_state text;
  v_entry_id uuid;
  v_old_reason text;
  v_open_logs int := 0;
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

  -- ── 먼저 읽고 판단한다(아직 아무것도 쓰지 않는다) ────────────────────────────
  select count(*) into v_open_logs
    from public.machine_logs
    where machine_id = p_machine_id and end_time is null and state <> 'NORMAL_OPERATION';

  -- 열린 항목 중 **가장 최근 것 하나만** 고친다. 무관한 행의 사유를 덮지 않게 하는 보험이다.
  select id, reason into v_entry_id, v_old_reason
    from public.downtime_entries
    where machine_id = p_machine_id and end_time is null
    order by start_time desc
    limit 1;

  -- 고칠 대상이 없으면 상태만 바꿔서는 안 된다 — 트리거를 억제한 채 current_state 를 바꾸면
  -- 그 상태를 담은 로그가 없는 채로 남는다.
  if v_open_logs = 0 and v_entry_id is null then
    return jsonb_build_object('ok', false, 'reason', 'no_open_downtime');
  end if;

  -- ── 여기서부터 쓴다 ────────────────────────────────────────────────────────
  -- 트리거에게 "전환이 아니라 정정"이라고 알린다(트랜잭션 로컬).
  perform set_config('app.suppress_status_log', '1', true);

  update public.machine_logs
    set state = p_reason
    where machine_id = p_machine_id and end_time is null and state <> 'NORMAL_OPERATION';
  get diagnostics v_logs_updated = row_count;

  if v_entry_id is not null then
    update public.downtime_entries set reason = p_reason where id = v_entry_id;
  end if;

  update public.machines set current_state = p_reason::machine_status where id = p_machine_id;

  -- 정정은 이력 수정이다. 누가 무엇을 언제 바꿨는지 남긴다.
  -- record_id 는 machine_id 다 — 정정은 언제나 machines 를 바꾸므로 NULL 이 될 수 없다.
  -- ⚠️ audit_log.action 은 varchar(20). 값을 바꿀 때 길이를 확인할 것('correct_reason' 은 14자).
  insert into public.audit_log (table_name, record_id, action, old_values, new_values, changed_by)
  values (
    'machines',
    p_machine_id,
    'correct_reason',
    jsonb_build_object(
      'current_state', v_state,
      'reason', coalesce(v_old_reason, v_state),
      'downtime_entry_id', v_entry_id
    ),
    jsonb_build_object(
      'current_state', p_reason,
      'reason', p_reason,
      'downtime_entry_id', v_entry_id
    ),
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
