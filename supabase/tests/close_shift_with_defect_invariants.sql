-- close_shift_with_defect 불변조건 실행 테스트 (감사 2026-09-28 F-01·F-02, 20260928120000).
--
-- **모든 쓰기는 롤백된다**: 마지막에 `ALL_INVARIANTS_PASSED` 예외를 던져 트랜잭션 전체를 되돌린다
-- (shift_write_invariants.sql 과 같은 구조). 판정: 에러 메시지가 'ALL_INVARIANTS_PASSED' 로 시작하면 성공.
-- 실행: docker exec -i supabase_db_CNC_OEE psql -U postgres -f - < supabase/tests/close_shift_with_defect_invariants.sql
--
-- 동시 실행(두 세션 경합)은 한 트랜잭션으로 볼 수 없어 close_shift_with_defect_concurrency.sh 가 따로 본다.

do $$
declare
  v_machine uuid;
  v_ws timestamptz := timestamptz '2099-03-01 08:00+07';
  v_we timestamptz := timestamptz '2099-03-01 20:00+07';
  v_digest text;
  r jsonb;
  v_out integer;
  v_def integer;
  v_q numeric;
  n integer;
begin
  select id into v_machine from public.machines
  where is_active and current_state = 'NORMAL_OPERATION' limit 1;
  if v_machine is null then raise exception 'SETUP: no active NORMAL machine'; end if;
  v_digest := public.downtime_window_digest(v_machine, v_ws, v_we);

  -- 진척 100 (A조). 이보다 낮은 마감은 사유가 필요하다.
  r := public.report_shift_progress(v_machine, date '2099-03-01', 'A', 100, null);
  if not (r->>'ok')::boolean then raise exception 'SETUP progress failed: %', r; end if;

  -- [C1] 불량 > 생산 → 쓰기 전에 거부
  r := public.close_shift_with_defect(v_machine, date '2099-03-01', 'A', 100, 610, 610, 500, 1, 0.8, 0, 300,
         v_ws, v_we, v_digest, null, null, 101);
  if r->>'reason' is distinct from 'defect_exceeds_output' then raise exception 'C1 expected defect_exceeds_output: %', r; end if;
  select count(*) into n from public.production_records where machine_id = v_machine and date = '2099-03-01';
  if n <> 0 then raise exception 'C1 wrote a record'; end if;

  -- [C2] 음수·NULL 불량 → 거부
  r := public.close_shift_with_defect(v_machine, date '2099-03-01', 'A', 100, 610, 610, 500, 1, 0.8, 0, 300,
         v_ws, v_we, v_digest, null, null, -1);
  if r->>'reason' is distinct from 'invalid_defect' then raise exception 'C2a expected invalid_defect: %', r; end if;
  r := public.close_shift_with_defect(v_machine, date '2099-03-01', 'A', 100, 610, 610, 500, 1, 0.8, 0, 300,
         v_ws, v_we, v_digest, null, null, null);
  if r->>'reason' is distinct from 'invalid_defect' then raise exception 'C2b expected invalid_defect: %', r; end if;

  -- [C3] 마감 단계의 거부(원천 지문 불일치)는 그대로 전달되고 아무것도 남지 않는다
  r := public.close_shift_with_defect(v_machine, date '2099-03-01', 'A', 100, 610, 610, 500, 1, 0.8, 0, 300,
         v_ws, v_we, 'wrong-digest', null, null, 3);
  if r->>'reason' is distinct from 'source_changed' then raise exception 'C3 expected source_changed: %', r; end if;

  -- [C4] 진척보다 낮은데 사유 없음 → 사유 요구, 기록 없음
  r := public.close_shift_with_defect(v_machine, date '2099-03-01', 'A', 90, 610, 610, 450, 1, 0.8, 0, 300,
         v_ws, v_we, v_digest, null, null, 3);
  if r->>'reason' is distinct from 'below_progress_needs_reason' then raise exception 'C4 expected needs_reason: %', r; end if;
  select count(*) into n from public.production_records where machine_id = v_machine and date = '2099-03-01';
  if n <> 0 then raise exception 'C4 wrote a record'; end if;

  -- [C5] 정상: 생산·불량이 **한 쌍으로** 저장되고 품질·OEE 가 그 쌍으로 계산된다
  r := public.close_shift_with_defect(v_machine, date '2099-03-01', 'A', 100, 610, 610, 500, 1, 0.8, 0, 300,
         v_ws, v_we, v_digest, null, null, 10);
  if not coalesce((r->>'ok')::boolean, false) or r->>'record_id' is null then raise exception 'C5 close failed: %', r; end if;
  select output_qty, defect_qty, quality into v_out, v_def, v_q
  from public.production_records where machine_id = v_machine and date = '2099-03-01' and shift = 'A';
  if v_out <> 100 or v_def <> 10 or v_q <> 0.9 then raise exception 'C5 row mismatch: out=% def=% q=%', v_out, v_def, v_q; end if;

  -- [C6] 불량 0 은 확정 0 (NULL 아님)
  r := public.report_shift_progress(v_machine, date '2099-03-01', 'B', 50, null);
  r := public.close_shift_with_defect(v_machine, date '2099-03-01', 'B', 50,
         610, 610, 250, 1, 0.8, 0, 300,
         timestamptz '2099-03-01 20:00+07', timestamptz '2099-03-02 08:00+07',
         public.downtime_window_digest(v_machine, timestamptz '2099-03-01 20:00+07', timestamptz '2099-03-02 08:00+07'),
         null, null, 0);
  if not coalesce((r->>'ok')::boolean, false) then raise exception 'C6 close failed: %', r; end if;
  select defect_qty, quality into v_def, v_q from public.production_records
  where machine_id = v_machine and date = '2099-03-01' and shift = 'B';
  if v_def is distinct from 0 or v_q <> 1 then raise exception 'C6 zero defect not confirmed: def=% q=%', v_def, v_q; end if;

  -- [C7] 이미 마감된 교대 → already_closed, 기존 확정 쌍(100/10)을 덮어쓰지 않는다 (사용자 확정 2026-09-28)
  r := public.close_shift_with_defect(v_machine, date '2099-03-01', 'A', 200, 610, 610, 1000, 1, 0.8, 0, 300,
         v_ws, v_we, v_digest, null, null, 20);
  if r->>'reason' is distinct from 'already_closed' then raise exception 'C7 expected already_closed: %', r; end if;
  select output_qty, defect_qty into v_out, v_def
  from public.production_records where machine_id = v_machine and date = '2099-03-01' and shift = 'A';
  if v_out <> 100 or v_def <> 10 then raise exception 'C7 overwrote existing record: out=% def=%', v_out, v_def; end if;

  -- [C8] 권한: 서비스 롤만 실행할 수 있다
  if has_function_privilege('anon', 'public.close_shift_with_defect(uuid,date,text,integer,integer,integer,integer,numeric,numeric,integer,integer,timestamptz,timestamptz,text,text,uuid,integer)', 'execute')
     or has_function_privilege('authenticated', 'public.close_shift_with_defect(uuid,date,text,integer,integer,integer,integer,numeric,numeric,integer,integer,timestamptz,timestamptz,text,text,uuid,integer)', 'execute')
     or not has_function_privilege('service_role', 'public.close_shift_with_defect(uuid,date,text,integer,integer,integer,integer,numeric,numeric,integer,integer,timestamptz,timestamptz,text,text,uuid,integer)', 'execute') then
    raise exception 'C8 privileges wrong';
  end if;

  raise exception 'ALL_INVARIANTS_PASSED (C1-C8)';
end $$;
