-- 설비 상태를 쓰는 RPC 는 `machines` 를 **행 잠금과 함께** 읽는다.
-- (전방 호환: 시그니처 변경 없음. 코드 변경도 필요 없다 — 순수 DB 수정이다)
--
-- [배경] 20260729030000 이 네 RPC 를 advisory lock 하나로 묶었다. 그런데 advisory lock 은
-- **RPC 끼리만** 상호 배제한다. RPC 를 거치지 않고 `machines` 를 직접 UPDATE 하는 경로에는
-- 아무 효력이 없다. 그런 경로가 앱에 둘 있다(둘 다 관리자용 설비 비활성화):
--   src/app/api/machines/route.ts               DELETE  .update({ is_active:false })
--   src/app/api/admin/machines/[machineId]/route.ts DELETE  .update({ is_active:false })
-- 이들은 Node 에서 문장 하나로 실행되므로 트랜잭션 범위 advisory lock 을 잡을 수 없다.
--
-- [결함] 잠금 없이 `machines` 를 **읽는** RPC 는 그 UPDATE 에 끼어들기를 허용한다.
--   1. andon(start): advisory 확보. is_active=true 를 읽는다.  <-- 행 잠금 없음
--   2. 비활성화: `update machines set is_active=false` 가 **차단되지 않고** 커밋된다.
--      zz_close_machine_activity_when_inactive 가 열린 로그·항목을 전부 닫는다.
--   3. andon: 이미 낡은 판단(active=true) 위에서 downtime_entries 를 넣고
--      current_state 를 바꾼다. 그 UPDATE 가 zz 트리거를 다시 발동시켜
--      방금 연 로그·항목을 즉시 닫는다.
--
--   실측(운영 DB, 롤백 트랜잭션에서 위 순서를 그대로 재현):
--     · machines: current_state=BREAKDOWN_REPAIR / is_active=false  (모순)
--     · 0초 유령 행: downtime_entries 1건 + machine_logs 1건
--     · 열린 로그 0건 -> BREAKDOWN_REPAIR 를 담은 로그가 하나도 없다
--       (= 20260714072100 의 "machine_logs 의 writer 는 트리거 하나" 불변조건 위반)
--   그리고 andon 은 운영자에게 **성공했다고 응답한다.**
--
-- [왜 새 RPC 가 답이 아닌가] 비활성화 경로를 RPC 로 감싸는 방법도 있지만, 그건 오늘 존재하는
-- 두 호출자만 고친다. 내일 누가 `.update()` 를 하나 더 추가하면 결함이 되살아난다.
-- 반대로 **읽는 쪽**을 고치면 잠금 없는 writer 가 몇 개든 안전하다.
--
-- [해법] apply_machine_update 와 upsert_downtime_entry 가 이미 쓰고 있는 형태로 맞춘다:
-- `machines` 를 `FOR UPDATE` 로 읽는다. 그러면 튜플의 xmax 가 이 트랜잭션으로 표시되고,
-- 동시에 들어온 UPDATE 는 그 xid 를 보고 커밋까지 **대기한다**.
-- 즉 판단(읽기)과 쓰기 사이에 남이 끼어들 틈이 사라진다.
--
--   RPC                            advisory   행 잠금(이 마이그레이션 전 -> 후)
--   apply_machine_update           ✓          ✓ -> ✓
--   upsert_downtime_entry          ✓          ✓ -> ✓
--   toggle_machine_downtime        ✓          ✗ -> ✓
--   correct_open_downtime_reason   ✓          ✗ -> ✓
--
-- 데드락 위험 없음: 둘 다 이미 advisory 를 먼저 잡으므로 잠금 순서(advisory -> 행)가
-- 나머지 둘과 동일하다.
--
-- 아래 두 함수는 `FOR UPDATE` 한 줄 외에 운영 정의와 동일하다.

-- ── 1) andon 비가동 토글 ─────────────────────────────────────────────────────
create or replace function public.toggle_machine_downtime(
  p_machine_id uuid,
  p_action text,
  p_reason text,
  p_date date,
  p_operator_id uuid
) returns jsonb language plpgsql as $$
declare
  now_ts timestamptz := now();
  v_state text;
  v_active boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
  -- FOR UPDATE: 이 판단이 유효한 동안 다른 트랜잭션이 이 설비 행을 바꾸지 못하게 한다.
  -- 없으면 아래 검사를 통과한 뒤 설비가 비활성화돼도 그대로 진행된다.
  select current_state::text, is_active into v_state, v_active
  from public.machines where id = p_machine_id
  for update;
  if v_state is null then
    return jsonb_build_object('ok', false, 'reason', 'machine_not_found');
  end if;
  -- 비활성 설비는 zz_close_machine_activity_when_inactive 가 활동을 즉시 닫아
  -- 상태·기록이 어긋난다 — andon 대상이 아니다.
  if not v_active then
    return jsonb_build_object('ok', false, 'reason', 'machine_inactive');
  end if;

  perform set_config('app.status_operator_id', coalesce(p_operator_id::text, ''), true);

  if p_action = 'start' then
    if v_state = p_reason then
      return jsonb_build_object('ok', true, 'state', v_state, 'noop', true);
    end if;
    update public.downtime_entries set end_time = now_ts
      where machine_id = p_machine_id and end_time is null;
    insert into public.downtime_entries(machine_id, date, start_time, reason, operator_id)
      values (p_machine_id, p_date, now_ts, p_reason, p_operator_id);
    update public.machines set current_state = p_reason::machine_status where id = p_machine_id;
    return jsonb_build_object('ok', true, 'state', p_reason);

  elsif p_action = 'resume' then
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

-- ── 2) 진행 중 비가동 사유 정정 ──────────────────────────────────────────────
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
  -- FOR UPDATE: 아래 "고칠 대상이 있는가" 판단이 유효한 동안 설비 행이 바뀌지 못하게 한다.
  -- 없으면 비활성화가 끼어들어 zz 트리거가 열린 로그·항목을 닫아버린 뒤에도
  -- 이 함수가 트리거를 억제한 채 current_state 만 바꿔, 그 상태를 담은 로그가 없는 채로 남는다.
  select current_state::text into v_state
    from public.machines where id = p_machine_id
    for update;

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
