-- 자체 적대 감사(2026-07-20) 수정: 교대 쓰기 RPC 경계 가드 3건.
--
-- #1 confirm_shift_defect — 락 획득 후 재읽기에서 FOUND 미확인: 그 사이 record 가 삭제되면
--    v_output 이 NULL 이라 모든 비교가 false 로 흘러 UPDATE 0행인데 ok:true 를 반환했다
--    (불량 확정 무음 증발). → 재읽기 직후 not found 반환.
-- #2 close_shift_upsert — 재마감 output 이 보존된 확정 defect 보다 작으면 defect > output
--    행이 저장됐다(불변조건 위반, quality 는 0 클램프). → output_lt_defect 로 거부하고
--    운영자가 불량을 재확인하게 한다.
-- #5 toggle_machine_downtime — 비활성 설비를 거부하지 않아, andon 시 상태는 바뀌는데
--    zz_close_machine_activity_when_inactive 트리거가 같은 트랜잭션에서 방금 연 로그·
--    엔트리를 즉시 닫아 상태·기록 불일치를 만들었다. → machine_inactive 로 거부.

-- #2: create or replace 로 20260720010000 버전을 대체(가드 1줄 추가 외 동일).
create or replace function public.close_shift_upsert(
  p_machine_id uuid,
  p_date date,
  p_shift text,
  p_output_qty integer,
  p_planned_runtime integer,
  p_actual_runtime integer,
  p_ideal_runtime integer,
  p_availability numeric,
  p_performance numeric,
  p_downtime_minutes integer,
  p_tact_time_seconds integer
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

  -- 확정 불량보다 작은 output 으로 재마감하면 defect > output 행이 생긴다 — 거부.
  if v_defect is not null and v_defect > p_output_qty then
    return jsonb_build_object('ok', false, 'reason', 'output_lt_defect', 'defect_qty', v_defect);
  end if;

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
    defect_qty        = production_records.defect_qty,  -- 확정 불량 보존(F2)
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

-- #1: create or replace 로 20260720010000 버전을 대체(재읽기 FOUND 가드 추가 외 동일).
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

  select machine_id, date, shift into v_machine, v_date, v_shift
  from public.production_records where record_id = p_record_id;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(v_machine::text || v_date::text || v_shift, 0)
  );

  select output_qty, availability, performance into v_output, v_avail, v_perf
  from public.production_records where record_id = p_record_id;
  -- 락 대기 중 record 가 삭제됐을 수 있다 — NULL 비교로 무음 성공하지 않게 명시 반환.
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;

  if p_defect > v_output then
    return jsonb_build_object('ok', false, 'reason', 'exceeds_output', 'output_qty', v_output);
  end if;

  if v_output > 0 then
    v_quality := round(least(greatest((v_output - p_defect)::numeric / v_output, 0), 1), 4);
  else
    v_quality := 0;
  end if;

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

-- #5: create or replace 로 20260718000004 버전을 대체(비활성 설비 거부 추가 외 동일).
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
  select current_state::text, is_active into v_state, v_active
  from public.machines where id = p_machine_id;
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
