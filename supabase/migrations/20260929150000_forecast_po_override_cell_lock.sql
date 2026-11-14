-- Forecast 실제 PO 수정: 같은 칸의 적용·원복 직렬화 (Codex 감사 PO-02, 2026-09-29).
--
-- 20260929130000 의 apply/revert 는 접수 행에 FOR SHARE 를 잡고 수정값 행을 SELECT ... FOR UPDATE 로 읽는다. 기존 수정값이
-- 있는 칸은 잠기지만, **처음 입력하는 칸은 잠글 행이 없다** - 접수 행의 공유 잠금은 다른 수정 요청과 양립한다. 그래서 같은 칸에
-- 두 요청이 동시에 처음 들어오면 둘 다 '이전 값 없음'을 읽고, 뒤 요청의 변경 이력에 잘못된 이전 값(또는 같은 값 중복 이벤트)이
-- 남았다. 최종 수량·공장 경계는 영향이 없고, 누가·언제·몇 → 몇 감사 이력과 '같은 값 재적용은 변경이 아니다' 계약이 깨지는 문제다.
--
-- 고침: 두 함수 모두, 인자 검증 직후 같은 칸의 advisory 트랜잭션 잠금을 먼저 잡고 그 뒤에 이전 값을 읽는다. 시그니처·반환 형태·
-- 오류 규약·권한은 그대로다(create or replace 로 본문만 바꾼다 - 인자가 같으므로 오버로드가 생기지 않는다).
-- 이미 적용된 20260929130000 파일은 고치지 않는다(원장 해시 드리프트 방지) - 그 위에 덧쓴다.

begin;

create or replace function public.apply_forecast_po_override(
  p_factory_id uuid,
  p_submission_id uuid,
  p_actor uuid,
  p_source_row integer,
  p_work_date date,
  p_model text,
  p_quantity integer,
  p_forecast_quantity numeric,
  p_forecast_state text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_before integer;
  v_at timestamptz;
begin
  if p_factory_id is null or p_submission_id is null then
    raise exception 'p_factory_id and p_submission_id are required' using errcode = '22023';
  end if;
  if p_quantity is null or p_quantity < 0 or p_quantity > 100000000 then
    raise exception 'INVALID_PO_QUANTITY' using errcode = '22023';
  end if;

  -- 같은 칸(공장·접수·원본 행·날짜)의 적용·원복을 한 줄로 세운다 (감사 PO-02, 2026-09-29).
  -- 표에 행이 아직 없으면 아래 FOR UPDATE 가 잠글 것이 없어, 두 요청이 모두 '이전 값 없음'으로 읽는다. 그러면 뒤 요청의 이력에
  -- 잘못된 이전 값이 남거나(null → 200, 실제 직전 값은 100) 같은 값의 이벤트가 중복된다. 이 칸을 트랜잭션이 끝날 때까지 쥐고,
  -- 이전 값은 그 뒤에 읽는다. 잠금 순서: 칸(advisory) → 접수 행(FOR SHARE) → 수정값 행(FOR UPDATE). 적용·원복이 같은 순서다.
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', 'forecast_po_override', p_factory_id, p_submission_id, p_source_row, p_work_date), 0));

  -- 접수가 그사이 바뀌었으면 거부한다. FOR SHARE 는 이 쓰기가 끝날 때까지 접수 교체(UPDATE)를 막는다 —
  -- 새 접수가 들어온 뒤에 옛 접수의 수정값이 쓰이는 일이 없다.
  perform 1 from public.forecast_submissions
   where factory_id = p_factory_id and submission_id = p_submission_id
     for share;
  if not found then
    raise exception 'SUBMISSION_CHANGED' using errcode = '55000';
  end if;

  select quantity, updated_at into v_before, v_at from public.forecast_po_overrides
   where factory_id = p_factory_id and submission_id = p_submission_id
     and source_row = p_source_row and work_date = p_work_date
     for update;

  -- 같은 값을 다시 적용하는 것은 변경이 아니다: 표도 이력도 건드리지 않는다(기존 수정 시각만 돌려준다).
  if v_before is not null and v_before = p_quantity then
    return jsonb_build_object('quantity', p_quantity, 'previous', v_before, 'unchanged', true, 'updated_at', v_at);
  end if;

  insert into public.forecast_po_overrides
    (factory_id, submission_id, source_row, work_date, model, quantity, forecast_quantity, forecast_state, updated_by, updated_at)
  values
    (p_factory_id, p_submission_id, p_source_row, p_work_date, p_model, p_quantity, p_forecast_quantity, p_forecast_state, p_actor, now())
  on conflict (factory_id, submission_id, source_row, work_date) do update
    set model = excluded.model, quantity = excluded.quantity,
        forecast_quantity = excluded.forecast_quantity, forecast_state = excluded.forecast_state,
        updated_by = excluded.updated_by, updated_at = excluded.updated_at
  returning updated_at into v_at;

  insert into public.forecast_po_override_events
    (factory_id, submission_id, source_row, work_date, model, action, quantity_before, quantity_after,
     forecast_quantity, forecast_state, actor, occurred_at)
  values
    (p_factory_id, p_submission_id, p_source_row, p_work_date, p_model, 'apply', v_before, p_quantity,
     p_forecast_quantity, p_forecast_state, p_actor, v_at);

  return jsonb_build_object('quantity', p_quantity, 'previous', v_before, 'unchanged', false, 'updated_at', v_at);
end;
$$;

-- ── 원복 ─────────────────────────────────────────────────────────────────────────────────────
create or replace function public.revert_forecast_po_override(
  p_factory_id uuid,
  p_submission_id uuid,
  p_actor uuid,
  p_source_row integer,
  p_work_date date
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old public.forecast_po_overrides%rowtype;
begin
  if p_factory_id is null or p_submission_id is null then
    raise exception 'p_factory_id and p_submission_id are required' using errcode = '22023';
  end if;

  -- 같은 칸(공장·접수·원본 행·날짜)의 적용·원복을 한 줄로 세운다 (감사 PO-02, 2026-09-29).
  -- 표에 행이 아직 없으면 아래 FOR UPDATE 가 잠글 것이 없어, 두 요청이 모두 '이전 값 없음'으로 읽는다. 그러면 뒤 요청의 이력에
  -- 잘못된 이전 값이 남거나(null → 200, 실제 직전 값은 100) 같은 값의 이벤트가 중복된다. 이 칸을 트랜잭션이 끝날 때까지 쥐고,
  -- 이전 값은 그 뒤에 읽는다. 잠금 순서: 칸(advisory) → 접수 행(FOR SHARE) → 수정값 행(FOR UPDATE). 적용·원복이 같은 순서다.
  perform pg_advisory_xact_lock(hashtextextended(
    concat_ws(':', 'forecast_po_override', p_factory_id, p_submission_id, p_source_row, p_work_date), 0));

  perform 1 from public.forecast_submissions
   where factory_id = p_factory_id and submission_id = p_submission_id
     for share;
  if not found then
    raise exception 'SUBMISSION_CHANGED' using errcode = '55000';
  end if;

  delete from public.forecast_po_overrides
   where factory_id = p_factory_id and submission_id = p_submission_id
     and source_row = p_source_row and work_date = p_work_date
  returning * into v_old;

  -- 되돌릴 수정값이 없으면 할 일이 없다(이미 원복됐거나 처음부터 없었다).
  if not found then
    return jsonb_build_object('reverted', false);
  end if;

  insert into public.forecast_po_override_events
    (factory_id, submission_id, source_row, work_date, model, action, quantity_before, quantity_after,
     forecast_quantity, forecast_state, actor)
  values
    (p_factory_id, p_submission_id, p_source_row, p_work_date, v_old.model, 'revert', v_old.quantity, null,
     v_old.forecast_quantity, v_old.forecast_state, p_actor);

  return jsonb_build_object('reverted', true, 'previous', v_old.quantity);
end;
$$;

-- 함수 실행 권한: 새 함수에는 Supabase 가 PUBLIC EXECUTE 를 되돌려 부여한다 — 전수 회수 뒤 서비스 롤에만 준다.
revoke all on function public.apply_forecast_po_override(uuid, uuid, uuid, integer, date, text, integer, numeric, text)
  from public, anon, authenticated;
grant execute on function public.apply_forecast_po_override(uuid, uuid, uuid, integer, date, text, integer, numeric, text)
  to service_role;
revoke all on function public.revert_forecast_po_override(uuid, uuid, uuid, integer, date)
  from public, anon, authenticated;
grant execute on function public.revert_forecast_po_override(uuid, uuid, uuid, integer, date)
  to service_role;

commit;
