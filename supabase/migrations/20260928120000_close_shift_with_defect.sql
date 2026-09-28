-- 교대 마감과 최종 불량 확정을 **한 트랜잭션**으로 묶는다 (감사 2026-09-28 F-01·F-02).
--
-- ## 무엇이 문제였나
--
-- 마감 대기 표에서 불량을 함께 입력하는 기능(2026-09-28)은 처음에 라우트가 두 RPC 를 차례로 불렀다:
-- `close_shift_upsert_v3` → `confirm_shift_defect`. 각 RPC 는 잠금을 잡지만 **자기 트랜잭션이 끝나면
-- 풀린다.** 그래서 두 호출 사이에 다른 요청이 끼어들 수 있었다:
--
--   A: 생산 100 마감 ─┐
--   B:                 │ 생산 200 마감 + 불량 20 확정
--   A:                 └→ 불량 10 확정           ⇒ 기록 = 생산 200·불량 10, A·B 모두 "성공"
--
-- 누구도 입력하지 않은 조합이 확정 실적으로 남고, 품질·OEE 가 그 조합으로 계산된다(F-01).
-- 또 불량 단계만 실패하면 "마감은 됐고 불량은 안 된" 반쪽이 남았는데, 기존 확정 불량이 있던 행이면
-- 불량 대기(`defect_qty IS NULL`)에도 나타나지 않아 복구 위치를 찾을 수 없었다(F-02).
--
-- ## 어떻게 고치나
--
-- advisory xact lock 은 **트랜잭션 끝까지** 유지되고, 같은 트랜잭션 안에서는 다시 잡아도 막히지 않는다.
-- 이 함수 하나가 두 RPC 를 같은 트랜잭션에서 부르면 두 단계 사이에 아무도 끼어들 수 없고,
-- 불량 단계가 실패하면 예외로 마감까지 함께 되돌린다 — 반쪽 상태가 존재할 수 없다.
--
-- 잠금 순서는 `close_shift_upsert_v3` 와 같다(설비 → 교대). 이 함수가 먼저 같은 순서로 잡아 두는 이유는
-- 아래 "이미 마감됨" 판단을 잠금 **안**에서 하기 위해서다(판단과 쓰기는 같은 잠금 아래).
--
-- ## 이미 마감된 교대는 거부한다 (사용자 확정 2026-09-28)
--
-- 이 함수는 마감 **대기** 표 전용이다. 표가 오래된 사이 다른 사람이 먼저 마감·불량 확정했다면
-- 그 확정 불량(예: 0)을 조용히 덮어쓰지 않고 `already_closed` 로 돌려보낸다. 이미 마감된 기록의
-- 수정은 생산 기록 목록의 수정 기능이 맡는다. 이 규칙은 호출자와 무관하게 옳으므로 인자가 필요 없다.
--
-- ## 왜 새 이름인가
--
-- 기존 두 RPC 의 시그니처·동작은 그대로 둔다(불량 없이 마감하는 현장 콘솔·대기 표, 불량 대기 화면이
-- 계속 쓴다). 순수 추가라 **이 마이그레이션을 코드보다 먼저 적용해도 기존 동작은 변하지 않는다.**
-- 반대로 코드가 먼저 배포되면 불량을 함께 넣는 마감만 "함수 없음"으로 실패한다 — 적용 순서: 이 파일 → 코드.

create or replace function public.close_shift_with_defect(
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
  p_tact_time_seconds integer,
  p_window_start timestamptz,
  p_window_end timestamptz,
  p_expected_digest text,
  p_below_progress_reason text,
  p_actor_id uuid,
  -- 확정할 최종 불량. 0 은 "검사했고 불량 없음"이다(미검사 NULL 과 다르다 — NULL 이면 이 함수를 쓰지 않는다).
  p_defect integer
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  r jsonb;
  d jsonb;
  v_record_id uuid;
begin
  -- 인자만으로 판단되는 거부는 잠금 전에 끝낸다. 아무것도 쓰지 않는다.
  if p_defect is null or p_defect < 0 then
    return jsonb_build_object('ok', false, 'reason', 'invalid_defect');
  end if;
  if p_output_qty is null or p_defect > p_output_qty then
    return jsonb_build_object('ok', false, 'reason', 'defect_exceeds_output', 'output_qty', p_output_qty);
  end if;

  -- close_shift_upsert_v3 와 같은 순서(설비 → 교대). 안에서 다시 잡아도 같은 트랜잭션이라 막히지 않는다.
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
  perform pg_advisory_xact_lock(
    hashtextextended(p_machine_id::text || p_date::text || p_shift, 0)
  );

  if exists (
    select 1 from public.production_records
    where machine_id = p_machine_id and date = p_date and shift = p_shift
  ) then
    return jsonb_build_object('ok', false, 'reason', 'already_closed');
  end if;

  -- 마감. 거부 사유(source_changed, below_progress_needs_reason, …)는 모두 쓰기 전에 반환되므로 그대로 전한다.
  r := public.close_shift_upsert_v3(
    p_machine_id, p_date, p_shift, p_output_qty,
    p_planned_runtime, p_actual_runtime, p_ideal_runtime,
    p_availability, p_performance, p_downtime_minutes, p_tact_time_seconds,
    p_window_start, p_window_end, p_expected_digest,
    p_below_progress_reason, p_actor_id
  );
  if not coalesce((r->>'ok')::boolean, false) then
    return r;
  end if;

  select record_id into v_record_id
  from public.production_records
  where machine_id = p_machine_id and date = p_date and shift = p_shift;

  -- 불량 확정(quality·oee 재계산 포함). 위에서 불량 ≤ 생산을 확인했고 잠금 아래라 행이 사라질 수도 없어
  -- 실패할 이유가 없다. 그래도 실패하면 예외로 마감까지 되돌린다 — 반쪽 상태를 남기지 않는 것이 이 함수의 목적이다.
  d := public.confirm_shift_defect(v_record_id, p_defect);
  if not coalesce((d->>'ok')::boolean, false) then
    raise exception 'CLOSE_WITH_DEFECT_FAILED: %', d;
  end if;

  return jsonb_build_object(
    'ok', true,
    'record_id', v_record_id,
    'defect_qty', p_defect,
    'below_progress', coalesce((r->>'below_progress')::boolean, false)
  );
end;
$$;

-- Supabase 는 새 함수에 PUBLIC EXECUTE 를 부여한다. API 라우트(서비스 롤)만 부르므로 회수하고,
-- PUBLIC 회수로 끊긴 service_role 의 권한은 명시적으로 되돌려 준다.
revoke all on function public.close_shift_with_defect(
  uuid, date, text, integer, integer, integer, integer, numeric, numeric, integer, integer,
  timestamptz, timestamptz, text, text, uuid, integer
) from public, anon, authenticated;
grant execute on function public.close_shift_with_defect(
  uuid, date, text, integer, integer, integer, integer, numeric, numeric, integer, integer,
  timestamptz, timestamptz, text, text, uuid, integer
) to service_role;
