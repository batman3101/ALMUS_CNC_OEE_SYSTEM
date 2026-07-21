-- Codex 적대 감사(2026-07-20) HIGH 1·3 수정: 교대 쓰기 경로의 원자성.
--
-- [1] advisory lock 키 불일치 — report_shift_progress 는 hash(machine||date||shift),
--     toggle_machine_downtime(000004)은 hash(machine) 만 잠근다. 키가 달라 000001 주석이
--     주장한 "검사 직후 비가동 전환" 직렬화가 실제로는 성립하지 않았다: 진척 저장의 비가동
--     검사와 andon 시작 사이 ms 창에서 비가동 중 진척 보고가 저장될 수 있다.
--     → report_shift_progress 가 machine 단독 키(andon 과 동일)를 먼저 잡는다.
--       잠금 순서는 machine → composite 로 고정(andon 은 machine 만 잡음) — 데드락 불가.
--
-- [3] 재마감 ↔ 불량 확정 TOCTOU — close-shift 라우트는 기존 defect 를 앱에서 읽고 upsert,
--     defect 라우트도 읽기와 갱신이 분리돼 있었다. 동시 실행 시 확정 불량이 null 로 덮이거나
--     낡은 값이 살아남는다(F2 보존은 순차 실행만 보호). → 두 쓰기를 RPC 로 옮기고 같은
--     composite advisory lock(machine||date||shift) 아래에서 읽기+파생+쓰기를 원자화한다.

-- 1) report_shift_progress: andon 과 같은 machine 단독 키를 먼저 잡는다.
--    (나머지 본문은 000001 과 동일 — 비가동 통합 확인 + 단조증가 + INSERT)
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
  -- andon(toggle_machine_downtime)과 동일 키 — 비가동 검사·삽입을 andon 전이와 직렬화한다.
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
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

-- 2) 교대 마감 upsert — 기존 확정 불량(F2)을 같은 트랜잭션에서 읽어 보존·재파생한다.
--    스냅샷 수치(runtime·비율)는 라우트가 계산해 넘긴다(반올림 포함). quality/oee 만 여기서
--    보존된 defect 로 파생한다(oeeRules 의 quality 식과 동일: clamp[0,1], output=0 이면 0).
create or replace function public.close_shift_upsert(
  p_machine_id uuid,
  p_date date,
  p_shift text,
  p_output_qty integer,
  p_planned_runtime integer,
  p_actual_runtime integer,     -- null = 비가동 미확인(런타임 미확정)
  p_ideal_runtime integer,      -- null = 공정 기준(tact) 미확인
  p_availability numeric,
  p_performance numeric,
  p_downtime_minutes integer,
  p_tact_time_seconds integer   -- null = 공정 기준 미확인(120초 등 날조 금지)
)
returns jsonb
language plpgsql
as $$
declare
  v_defect integer;
  v_quality numeric;
  v_oee numeric;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_machine_id::text || p_date::text || p_shift, 0)
  );

  select defect_qty into v_defect
  from public.production_records
  where machine_id = p_machine_id and date = p_date and shift = p_shift;

  if v_defect is null then
    v_quality := null;
  elsif p_output_qty > 0 then
    v_quality := round(least(greatest((p_output_qty - v_defect)::numeric / p_output_qty, 0), 1), 4);
  else
    v_quality := 0;
  end if;

  if v_quality is null or p_availability is null or p_performance is null then
    v_oee := null;
  else
    v_oee := round(p_availability * p_performance * v_quality, 4);
  end if;

  insert into public.production_records(
    machine_id, date, shift, output_qty, defect_qty,
    planned_runtime, actual_runtime, ideal_runtime,
    availability, performance, quality, oee,
    downtime_minutes, tact_time_seconds
  ) values (
    p_machine_id, p_date, p_shift, p_output_qty, v_defect,
    p_planned_runtime, p_actual_runtime, p_ideal_runtime,
    p_availability, p_performance, v_quality, v_oee,
    p_downtime_minutes, p_tact_time_seconds
  )
  on conflict (machine_id, date, shift) do update set
    output_qty        = excluded.output_qty,
    defect_qty        = production_records.defect_qty,  -- 확정 불량 보존(F2) — 이제 원자적
    planned_runtime   = excluded.planned_runtime,
    actual_runtime    = excluded.actual_runtime,
    ideal_runtime     = excluded.ideal_runtime,
    availability      = excluded.availability,
    performance       = excluded.performance,
    quality           = excluded.quality,
    oee               = excluded.oee,
    downtime_minutes  = excluded.downtime_minutes,
    tact_time_seconds = excluded.tact_time_seconds;

  return jsonb_build_object('ok', true, 'preserved_defect', v_defect);
end;
$$;

-- 3) 다음날 불량 확정 — 재마감과 같은 composite 키로 직렬화, 락 아래에서 재읽기 후 파생.
create or replace function public.confirm_shift_defect(
  p_record_id uuid,
  p_defect integer
)
returns jsonb
language plpgsql
as $$
declare
  v_machine uuid;
  v_date date;
  v_shift text;
  v_output integer;
  v_avail numeric;
  v_perf numeric;
  v_quality numeric;
  v_oee numeric;
begin
  if p_defect is null or p_defect < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_defect');
  end if;

  -- 락 키 재료(machine/date/shift)는 불변이라 락 전 읽기로 충분하다.
  select machine_id, date, shift into v_machine, v_date, v_shift
  from public.production_records where record_id = p_record_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_machine::text || v_date::text || v_shift, 0)
  );

  -- 락 아래 재읽기 — 직전 재마감이 output/avail/perf 를 바꿨을 수 있다.
  select output_qty, availability, performance into v_output, v_avail, v_perf
  from public.production_records where record_id = p_record_id;

  if p_defect > v_output then
    return jsonb_build_object('ok', false, 'reason', 'exceeds_output', 'output_qty', v_output);
  end if;

  if v_output > 0 then
    v_quality := round(least(greatest((v_output - p_defect)::numeric / v_output, 0), 1), 4);
  else
    v_quality := 0;
  end if;

  -- avail·perf 가 null(런타임 미보고)이면 oee 도 null 로 남긴다(NULL≠0).
  if v_avail is null or v_perf is null then
    v_oee := null;
  else
    v_oee := round(v_avail * v_perf * v_quality, 4);
  end if;

  update public.production_records
     set defect_qty = p_defect, quality = v_quality, oee = v_oee
   where record_id = p_record_id;

  return jsonb_build_object('ok', true, 'quality', v_quality, 'oee', v_oee);
end;
$$;

-- service_role 전용(라우트가 인증·담당설비 검사 후 호출).
revoke all on function public.close_shift_upsert(uuid, date, text, integer, integer, integer, integer, numeric, numeric, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.close_shift_upsert(uuid, date, text, integer, integer, integer, integer, numeric, numeric, integer, integer)
  to service_role;

revoke all on function public.confirm_shift_defect(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.confirm_shift_defect(uuid, integer)
  to service_role;
