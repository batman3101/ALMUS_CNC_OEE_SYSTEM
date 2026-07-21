-- 진행 보고(production_progress_reports)는 "이 교대 누적 생산량"이라 줄어들 수 없다.
-- POST 의 앱 레벨 사전검사(마지막 값 조회 → insert)는 동시 요청에 안전하지 않다:
-- 두 요청이 같은 이전 값을 읽으면 150 저장 후 60 저장 같은 역행이 통과한다(TOCTOU).
-- 이를 DB 레벨에서 원자적으로 막는다.
--
-- 주의: 단순 BEFORE INSERT 트리거의 SELECT max 는 READ COMMITTED 에서 잠금을 걸지 않아
-- 앱 레벨과 동일한 경쟁이 반복된다. 같은 (machine_id, date, shift) 삽입을 advisory lock 으로
-- 직렬화해야 "조회 후 삽입"이 실제로 원자적이 된다. 락은 트랜잭션 커밋 시 해제된다.

create or replace function public.enforce_progress_monotonic()
returns trigger
language plpgsql
as $$
declare
  prev integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(new.machine_id::text || new.date::text || new.shift, 0)
  );

  select max(shift_output_qty) into prev
  from public.production_progress_reports
  where machine_id = new.machine_id
    and date = new.date
    and shift = new.shift;

  if prev is not null and new.shift_output_qty < prev then
    raise exception 'shift_output_qty decreased (prev=%, new=%)', prev, new.shift_output_qty
      using errcode = 'check_violation'; -- SQLSTATE 23514 → API 가 409 로 매핑
  end if;

  return new;
end;
$$;

drop trigger if exists progress_reports_monotonic on public.production_progress_reports;

create trigger progress_reports_monotonic
  before insert on public.production_progress_reports
  for each row execute function public.enforce_progress_monotonic();

-- 원자 저장 경로. 앱 레벨은 machine_logs 읽기 → last 읽기 → INSERT 가 분리돼 ① 검사 직후
-- 비가동 전환, ② 동시 요청 경쟁을 못 막았다. 통합 비가동 확인(machine_logs 열린 비정상 +
-- downtime_entries 열린 항목 — 가동률 계산과 같은 두 소스) + 단조증가 + INSERT 를 한
-- 트랜잭션(advisory lock)으로 묶는다. 감소 거부 시 현재 최댓값을 함께 돌려줘 API 가 친절한
-- 감소 안내를 만들 수 있게 한다.
create or replace function public.report_shift_progress(
  p_machine_id uuid,
  p_date date,
  p_shift text,
  p_qty integer,
  p_operator_id uuid
)
returns jsonb
language plpgsql
as $$
declare
  prev integer;
  down_state text;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_machine_id::text || p_date::text || p_shift, 0)
  );

  -- 통합 비가동 확인. "지금 열려 있으면 비가동".
  select ml.state into down_state
  from public.machine_logs ml
  where ml.machine_id = p_machine_id
    and ml.end_time is null
    and ml.state <> 'NORMAL_OPERATION'
  order by ml.start_time desc
  limit 1;

  if down_state is not null then
    return jsonb_build_object('ok', false, 'reason', 'machine_in_downtime', 'state', down_state);
  end if;

  if exists (
    select 1 from public.downtime_entries de
    where de.machine_id = p_machine_id and de.end_time is null
  ) then
    return jsonb_build_object('ok', false, 'reason', 'machine_in_downtime', 'state', 'downtime_entry');
  end if;

  -- 단조 증가 (advisory lock 아래라 원자적). 거부 시 현재 최댓값을 함께 돌려준다.
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

-- 신규 public 함수는 기본 ACL 이 PUBLIC 에 EXECUTE 를 주므로, 좁히려면 먼저 REVOKE 해야 한다.
revoke all on function public.report_shift_progress(uuid, date, text, integer, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.report_shift_progress(uuid, date, text, integer, uuid)
  to service_role;
