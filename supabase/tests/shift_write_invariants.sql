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
  -- v2 는 원천 지문 대조를 위해 시간창과 기대 지문을 받는다(20260729160000).
  v_ws timestamptz := timestamptz '2099-01-01 08:00+07';
  v_we timestamptz := timestamptz '2099-01-01 20:00+07';
  v_digest text;
  v_digest_before text;
  v_digest_after text;
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

  -- [T3] close_shift_upsert_v3: F2 보존 원자화 + output_lt_defect + confirm_shift_defect 가드
  --
  -- v1 은 20260729170000 에서, v2 는 20260806 에서 제거됐다. 이 스크립트가 v1 을 계속 부르고
  -- 있어 운영 스키마에서 통째로 실패한 적이 있다(적대적 재감사 #7) — 불변조건 검사가 스스로
  -- 깨진 채 방치되면 "검사가 있다"는 사실이 오히려 안전하다는 착각을 만든다.
  -- **RPC 를 새 이름으로 올릴 때 이 파일도 같이 옮길 것.**
  v_digest := public.downtime_window_digest(v_machine, v_ws, v_we);
  r := public.close_shift_upsert_v3(v_machine, date '2099-01-01', 'A', 100, 610, 610, 930,
                                    1.0, 0.9, 0, 558, v_ws, v_we, v_digest, null, null);
  if not (r->>'ok')::boolean or r->'preserved_defect' <> 'null'::jsonb then
    raise exception 'T3a first close failed: %', r;
  end if;

  -- [T3-CAS] 지문이 다르면 저장하지 않는다 (낡은 지표의 확정 저장 방지)
  r := public.close_shift_upsert_v3(v_machine, date '2099-01-01', 'A', 100, 610, 610, 930,
                                    1.0, 0.9, 0, 558, v_ws, v_we, '__stale_digest__', null, null);
  if (r->>'ok')::boolean or r->>'reason' <> 'source_changed' then
    raise exception 'T3-CAS stale digest accepted: %', r;
  end if;

  select record_id into v_rec_id from public.production_records
  where machine_id = v_machine and date = date '2099-01-01' and shift = 'A';

  r := public.confirm_shift_defect(v_rec_id, 8);
  if not (r->>'ok')::boolean or (r->>'quality')::numeric <> 0.9200 then
    raise exception 'T3b defect confirm failed: %', r;
  end if;

  r := public.close_shift_upsert_v3(v_machine, date '2099-01-01', 'A', 100, 610, 610, 930,
                                    1.0, 0.9, 0, 558, v_ws, v_we, v_digest, null, null);
  if (r->>'preserved_defect')::integer <> 8 then raise exception 'T3c reclose lost defect: %', r; end if;
  select defect_qty into v_defect from public.production_records where record_id = v_rec_id;
  if v_defect <> 8 then raise exception 'T3d row defect overwritten: %', v_defect; end if;

  r := public.close_shift_upsert_v3(v_machine, date '2099-01-01', 'A', 5, 610, 610, 47,
                                    1.0, 0.08, 0, 558, v_ws, v_we, v_digest, null, null);
  if (r->>'ok')::boolean or r->>'reason' <> 'output_lt_defect' then
    raise exception 'T3e output<defect reclose accepted: %', r;
  end if;

  r := public.confirm_shift_defect('00000000-0000-4000-8000-000000000000'::uuid, 1);
  if (r->>'ok')::boolean or r->>'reason' <> 'not_found' then raise exception 'T3f not_found missing: %', r; end if;

  r := public.confirm_shift_defect(v_rec_id, 200);
  if (r->>'ok')::boolean or r->>'reason' <> 'exceeds_output' then raise exception 'T3g exceeds guard missing: %', r; end if;

  -- [T5] 지문이 **사유 변경**을 감지한다 (적대적 재감사 #6)
  --
  -- 시각은 그대로 두고 reason 만 바꾼다 — 진행 중 비가동 사유 정정이 정확히 이 모양이다.
  -- reason 이 계획정지 여부를 정하고 그게 확정 비가동 값을 숫자↔NULL 로 뒤집으므로,
  -- 지문이 이걸 못 보면 낡은 분류로 계산한 지표가 CAS 를 통과해 저장된다.
  -- T2 가 만든 실제 andon 기록(현재 시각대)을 그대로 쓴다.
  v_digest_before := public.downtime_window_digest(
    v_machine, now() - interval '1 hour', now() + interval '1 hour');

  update public.downtime_entries
  set reason = case when reason = 'BREAKDOWN_REPAIR' then 'TEMPORARY_STOP' else 'BREAKDOWN_REPAIR' end
  where machine_id = v_machine and start_time >= now() - interval '1 hour';

  v_digest_after := public.downtime_window_digest(
    v_machine, now() - interval '1 hour', now() + interval '1 hour');

  if v_digest_before = 'empty' then
    raise exception 'T5 setup: 창에 비가동 원천이 없어 검사가 무의미하다';
  end if;
  if v_digest_before = v_digest_after then
    raise exception 'T5 지문이 사유 변경을 감지하지 못한다 (before=after=%)', v_digest_before;
  end if;

  -- [T6] 마감된 교대에는 진척을 받지 않는다 (적대적 재감사 #5)
  --
  -- T3 이 2099-01-01 A 의 확정 레코드를 만들었다. 이후의 진척은 원천과 확정 레코드를
  -- 어긋나게 만들 뿐이고, 레코드가 존재하므로 화면은 재마감을 요구하지도 않는다.
  r := public.report_shift_progress(v_machine, date '2099-01-01', 'A', 999, null);
  if (r->>'ok')::boolean or r->>'reason' <> 'already_closed' then
    raise exception 'T6 마감 후 진척이 수용됨: %', r;
  end if;

  -- [T3f] 진척보다 낮은 마감: 사유 없으면 거부, 있으면 통과하고 흔적을 남긴다
  --
  -- 진척 보고는 누적이라 감소가 409 로 거부된다. 마감이 같은 규칙을 따르지 않아 진척(100)보다
  -- 작은 값으로 확정하면 이력과 실적이 어긋난 채 남았다(마감 대기 목록에서도 사라져 아무도
  -- 다시 보지 못했다). 막지 않고 사유를 받기로 했으므로, **사유 없이는 통과하지 못한다**는
  -- 것이 불변조건이다.
  --
  -- 판정은 RPC 안(잠금 아래)에서 한다. 라우트에서 진척을 읽어 비교하면 그 읽기와 저장 사이에
  -- 새 진척이 들어와 사유가 필요한 마감이 사유 없이 통과할 수 있다.
  insert into public.production_progress_reports(machine_id, date, shift, shift_output_qty, operator_id)
  values (v_machine, date '2099-01-02', 'A', 100, null);

  v_digest := public.downtime_window_digest(v_machine, v_ws, v_we);

  r := public.close_shift_upsert_v3(v_machine, date '2099-01-02', 'A', 10, 610, 610, 93,
                                    1.0, 0.9, 0, 558, v_ws, v_we, v_digest, null, null);
  if (r->>'ok')::boolean or r->>'reason' <> 'below_progress_needs_reason' then
    raise exception 'T3f below-progress close accepted without reason: %', r;
  end if;
  if (r->>'last_progress_qty')::integer <> 100 then
    raise exception 'T3f last_progress_qty not returned (화면이 얼마인지 물을 수 없다): %', r;
  end if;
  -- 거부됐으면 행도 없어야 한다 — 거부해 놓고 저장하면 거부가 아니다.
  if exists (select 1 from public.production_records
             where machine_id = v_machine and date = date '2099-01-02' and shift = 'A') then
    raise exception 'T3f rejected close still wrote a record';
  end if;

  -- 공백만 있는 사유는 사유가 아니다.
  r := public.close_shift_upsert_v3(v_machine, date '2099-01-02', 'A', 10, 610, 610, 93,
                                    1.0, 0.9, 0, 558, v_ws, v_we, v_digest, '   ', null);
  if (r->>'ok')::boolean or r->>'reason' <> 'below_progress_needs_reason' then
    raise exception 'T3f blank reason accepted: %', r;
  end if;

  r := public.close_shift_upsert_v3(v_machine, date '2099-01-02', 'A', 10, 610, 610, 93,
                                    1.0, 0.9, 0, 558, v_ws, v_we, v_digest, '종이 카운트로 정정', null);
  if not (r->>'ok')::boolean or not (r->>'below_progress')::boolean then
    raise exception 'T3f close with reason failed: %', r;
  end if;

  -- 흔적이 없으면 허용의 근거가 사라진다.
  if not exists (
    select 1 from public.audit_log
    where action = 'close_below_progress'
      and old_values->>'last_progress_qty' = '100'
      and new_values->>'output_qty' = '10'
      and new_values->>'reason' = '종이 카운트로 정정'
  ) then
    raise exception 'T3f audit row missing for below-progress close';
  end if;

  -- 진척과 같거나 크면 사유 없이도 통과한다(평소 마감이 막히면 안 된다).
  r := public.close_shift_upsert_v3(v_machine, date '2099-01-02', 'A', 100, 610, 610, 930,
                                    1.0, 0.9, 0, 558, v_ws, v_we, v_digest, null, null);
  if not (r->>'ok')::boolean or (r->>'below_progress')::boolean then
    raise exception 'T3f normal close blocked or mislabeled: %', r;
  end if;

  -- [T4] 비활성 설비 andon 거부
  update public.machines set is_active = false where id = v_machine;
  r := public.toggle_machine_downtime(v_machine, 'start', 'INSPECTION', date '2099-01-01', null);
  if (r->>'ok')::boolean or r->>'reason' <> 'machine_inactive' then
    raise exception 'T4 inactive machine accepted: %', r;
  end if;

  -- 성공 — 예외로 전체 롤백 (이 메시지가 곧 성공 판정이다)
  raise exception 'ALL_INVARIANTS_PASSED (machine %, all writes rolled back)', v_machine;
end $$;
