-- 진척 보고의 "지금 비가동인가" 판정에서 **미래에 시작하는** 비가동을 제외한다.
--
-- ## 무엇이 문제였나
--
-- `report_shift_progress` 는 열린 비가동을 두 곳에서 본다:
--
--   machine_logs      end_time is null and state <> 'NORMAL_OPERATION'
--   downtime_entries  end_time is null
--
-- 둘 다 `start_time <= now()` 조건이 없다. 그래서 **시작 시각이 미래인** 열린 비가동이
-- 하나라도 있으면, 설비가 지금 정상 가동 중이어도 진척 저장이 409 `machine_in_downtime`
-- 으로 거부된다.
--
-- 화면은 이 상황을 비가동으로 보지 않는다(콘솔은 `current_state` 와 열린 비가동의 시작
-- 시각으로 잠금을 판단한다). 그래서 작업자에게는 **입력칸이 멀쩡히 열려 있는데 저장만
-- 계속 실패하는** 것으로 보인다 — 원인이 화면 어디에도 없다.
--
-- 미래 시각 비가동은 입력 API 에서도 막지만(이 마이그레이션과 같은 변경),
-- 판정 쪽도 함께 고친다. 한쪽만 고치면 이미 들어와 있는 미래 행이 계속 같은 증상을 낸다.
--
-- ## 함께 한 것
--
-- `set search_path` 를 고정한다. Supabase advisor 가 이 함수를 `function_search_path_mutable`
-- 로 표시하고 있었다. SECURITY INVOKER 라 권한 상승 경로는 아니지만, 어차피 함수를
-- 다시 쓰는 김에 닫는다. 함수 본문은 모든 이름을 `public.` 으로 한정하므로 영향이 없다.
--
-- `create or replace` 는 PUBLIC EXECUTE 를 되돌려 부여한다 — 이 함수는 서비스 롤만
-- 부르므로 아래에서 전수로 회수한다.

create or replace function public.report_shift_progress(
  p_machine_id uuid,
  p_date date,
  p_shift text,
  p_qty integer,
  p_operator_id uuid
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  prev integer;
  down_state text;
  v_active boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
  perform pg_advisory_xact_lock(
    hashtextextended(p_machine_id::text || p_date::text || p_shift, 0)
  );

  select is_active into v_active
  from public.machines
  where id = p_machine_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'machine_not_found');
  end if;

  if not v_active then
    return jsonb_build_object('ok', false, 'reason', 'machine_inactive');
  end if;

  if exists (
    select 1 from public.production_records
    where machine_id = p_machine_id and date = p_date and shift = p_shift
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_closed');
  end if;

  -- 아직 시작하지 않은 비가동은 "지금 비가동"이 아니다.
  select ml.state into down_state
  from public.machine_logs ml
  where ml.machine_id = p_machine_id
    and ml.end_time is null
    and ml.start_time <= now()
    and ml.state <> 'NORMAL_OPERATION'
  order by ml.start_time desc
  limit 1;

  if down_state is not null then
    return jsonb_build_object('ok', false, 'reason', 'machine_in_downtime', 'state', down_state);
  end if;

  if exists (
    select 1 from public.downtime_entries de
    where de.machine_id = p_machine_id
      and de.end_time is null
      and de.start_time <= now()
  ) then
    return jsonb_build_object('ok', false, 'reason', 'machine_in_downtime', 'state', 'downtime_entry');
  end if;

  select max(shift_output_qty) into prev
  from public.production_progress_reports
  where machine_id = p_machine_id
    and date = p_date
    and shift = p_shift;

  if prev is not null and p_qty < prev then
    return jsonb_build_object('ok', false, 'reason', 'decreased', 'last_reported_qty', prev);
  end if;

  insert into public.production_progress_reports(machine_id, date, shift, shift_output_qty, operator_id)
  values (p_machine_id, p_date, p_shift, p_qty, p_operator_id);

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.report_shift_progress(uuid, date, text, integer, uuid) from public;
revoke all on function public.report_shift_progress(uuid, date, text, integer, uuid) from anon;
revoke all on function public.report_shift_progress(uuid, date, text, integer, uuid) from authenticated;
