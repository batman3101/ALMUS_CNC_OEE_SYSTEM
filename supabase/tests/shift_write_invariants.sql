-- 교대 쓰기 RPC 불변조건 실행 테스트 (자체 감사 #3).
--
-- jest 는 SQL(RPC·트리거) 로직을 보지 못한다 — 멱등·F2 보존·단조증가·단일 writer 는
-- 이 스크립트로 실행 검증한다. **모든 쓰기는 롤백된다**: 마지막에 반드시
-- `ALL_INVARIANTS_PASSED` 예외를 던져 트랜잭션 전체를 되돌리는 구조라, 운영 DB 에
-- 직접 실행해도 데이터가 남지 않는다. (에러 메시지가 곧 성공 마커다)
--
-- 실행: psql "$DATABASE_URL" -f supabase/tests/shift_write_invariants.sql
--   또는 에이전트 세션에서 MCP execute_sql 로 DO 블록 실행.
-- 판정: 에러 메시지가 'ALL_INVARIANTS_PASSED' 로 시작하면 성공, 그 외 예외는 실패 원인.
--
-- 주의(하네스 한계): 한 트랜잭션 안에서는 now() 가 고정이라 구간 길이가 0 이 된다.
--  - validate_downtime_entry_write 트리거가 end_time > start_time 을 강제하므로,
--    resume 전에 열린 구간(로그·비가동)을 1분 백데이트해 0-길이 구간을 피한다.
--  - "유령(0분) 행 없음" 대신 "전환당 로그 정확히 1행 + noop 무기록"으로 검증한다.
--  - 이 트랜잭션이 설비 advisory lock 을 계속 쥐고 있어 대상 설비의 동시 쓰기와
--    경합하지 않는다(카운트 검증이 안전한 이유).

do $$
declare
  v_machine uuid;
  v_rec_id uuid;
  v_defect integer;
  r jsonb;
  n integer;
begin
  select id into v_machine
  from public.machines
  where is_active and current_state = 'NORMAL_OPERATION'
  limit 1;
  if v_machine is null then raise exception 'SETUP: no active NORMAL machine'; end if;

  -- [T1] 진척 단조증가 (report_shift_progress)
  r := public.report_shift_progress(v_machine, date '2099-01-01', 'A', 100, null);
  if not (r->>'ok')::boolean then raise exception 'T1a report failed: %', r; end if;
  r := public.report_shift_progress(v_machine, date '2099-01-01', 'A', 50, null);
  if (r->>'ok')::boolean or r->>'reason' <> 'decreased' then
    raise exception 'T1b monotonic violated: %', r;
  end if;

  -- [T2] andon: 멱등 + 단일 writer + 비가동 중 진척 차단
  r := public.toggle_machine_downtime(v_machine, 'start', 'TEMPORARY_STOP', date '2099-01-01', null);
  if not (r->>'ok')::boolean or r->>'state' <> 'TEMPORARY_STOP' then
    raise exception 'T2a start failed: %', r;
  end if;
  r := public.toggle_machine_downtime(v_machine, 'start', 'TEMPORARY_STOP', date '2099-01-01', null);
  if not coalesce((r->>'noop')::boolean, false) then raise exception 'T2b start not idempotent: %', r; end if;

  r := public.report_shift_progress(v_machine, date '2099-01-01', 'A', 200, null);
  if (r->>'ok')::boolean or r->>'reason' <> 'machine_in_downtime' then
    raise exception 'T2c progress accepted during downtime: %', r;
  end if;

  -- 단일 트랜잭션에선 now() 가 고정 → 0-길이 구간이 되어 end>start 트리거에 걸린다.
  -- 열린 구간을 1분 백데이트해 실제 운영(별도 트랜잭션)과 같은 조건을 만든다.
  update public.downtime_entries set start_time = start_time - interval '1 minute'
  where machine_id = v_machine and end_time is null;
  update public.machine_logs set start_time = start_time - interval '1 minute'
  where machine_id = v_machine and end_time is null and state <> 'NORMAL_OPERATION';

  r := public.toggle_machine_downtime(v_machine, 'resume', '', date '2099-01-01', null);
  if not (r->>'ok')::boolean or r->>'state' <> 'NORMAL_OPERATION' then
    raise exception 'T2d resume failed: %', r;
  end if;
  r := public.toggle_machine_downtime(v_machine, 'resume', '', date '2099-01-01', null);
  if not coalesce((r->>'noop')::boolean, false) then raise exception 'T2e resume not idempotent: %', r; end if;

  -- 이 트랜잭션이 만든 로그는 실제 전환 2회 = 정확히 2행이어야 한다.
  -- (noop 4회 호출이 행을 만들었으면 여기서 초과가 잡힌다 — 단일 writer + 멱등)
  select count(*) into n from public.machine_logs
  where machine_id = v_machine and start_time >= now() - interval '1 minute';
  if n <> 2 then raise exception 'T2f expected 2 log rows per 2 transitions, got %', n; end if;

  -- [T3] close_shift_upsert: F2 보존 원자화 + output_lt_defect + confirm_shift_defect 가드
  r := public.close_shift_upsert(v_machine, date '2099-01-01', 'A', 100, 610, 610, 930, 1.0, 0.9, 0, 558);
  if not (r->>'ok')::boolean or r->'preserved_defect' <> 'null'::jsonb then
    raise exception 'T3a first close failed: %', r;
  end if;

  select record_id into v_rec_id from public.production_records
  where machine_id = v_machine and date = date '2099-01-01' and shift = 'A';

  r := public.confirm_shift_defect(v_rec_id, 8);
  if not (r->>'ok')::boolean or (r->>'quality')::numeric <> 0.9200 then
    raise exception 'T3b defect confirm failed: %', r;
  end if;

  r := public.close_shift_upsert(v_machine, date '2099-01-01', 'A', 100, 610, 610, 930, 1.0, 0.9, 0, 558);
  if (r->>'preserved_defect')::integer <> 8 then raise exception 'T3c reclose lost defect: %', r; end if;
  select defect_qty into v_defect from public.production_records where record_id = v_rec_id;
  if v_defect <> 8 then raise exception 'T3d row defect overwritten: %', v_defect; end if;

  r := public.close_shift_upsert(v_machine, date '2099-01-01', 'A', 5, 610, 610, 47, 1.0, 0.08, 0, 558);
  if (r->>'ok')::boolean or r->>'reason' <> 'output_lt_defect' then
    raise exception 'T3e output<defect reclose accepted: %', r;
  end if;

  r := public.confirm_shift_defect('00000000-0000-4000-8000-000000000000'::uuid, 1);
  if (r->>'ok')::boolean or r->>'reason' <> 'not_found' then raise exception 'T3f not_found missing: %', r; end if;

  r := public.confirm_shift_defect(v_rec_id, 200);
  if (r->>'ok')::boolean or r->>'reason' <> 'exceeds_output' then raise exception 'T3g exceeds guard missing: %', r; end if;

  -- [T4] 비활성 설비 andon 거부
  update public.machines set is_active = false where id = v_machine;
  r := public.toggle_machine_downtime(v_machine, 'start', 'INSPECTION', date '2099-01-01', null);
  if (r->>'ok')::boolean or r->>'reason' <> 'machine_inactive' then
    raise exception 'T4 inactive machine accepted: %', r;
  end if;

  -- 성공 — 예외로 전체 롤백 (이 메시지가 곧 성공 판정이다)
  raise exception 'ALL_INVARIANTS_PASSED (machine %, all writes rolled back)', v_machine;
end $$;
