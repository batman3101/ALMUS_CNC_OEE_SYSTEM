-- Codex 감사(2026-07-29) #6 수정: 교대 마감의 읽기↔저장 TOCTOU 제거.
--
-- ⚠ 아직 운영에 적용하지 않았다.
--
-- ══ 무엇이 문제인가 ══════════════════════════════════════════════════════
--
-- close-shift 라우트는 비가동 원천을 **트랜잭션 밖에서** 읽어 지표를 계산한 뒤,
-- 결과 숫자를 close_shift_upsert 에 넘긴다. RPC 는 교대 키만 잠그고 원천을 다시 보지
-- 않으므로, 조회와 저장 사이에 비가동이 정정되면 **원천과 다른 확정 OEE 가 영구 저장**된다.
-- 스냅샷 보존 원칙 때문에 나중에 원천을 고쳐도 저장된 값은 따라오지 않는다.
--
-- 창은 좁다 — 마감은 교대 종료 후에만 실행되므로(라우트의 이른 마감 금지 가드) 진행 중
-- 비가동이 변하는 경우는 없고, 남는 것은 **비가동 사후 정정**이 마감과 겹치는 경우뿐이다.
-- 드물지만 발생하면 되돌릴 수 없다.
--
-- ══ 왜 비가동 계산을 SQL 로 옮기지 않는가 ═══════════════════════════════
--
-- "RPC 안에서 비가동을 다시 계산해 비교하면 되지 않나" 가 자연스러운 답이지만 하지 않는다.
-- 계획정지·휴식 겹침 판정과 구간 클립·유니온 규칙이 TS(calculateVerifiedDowntimeMinutes-
-- ForWindow)와 SQL 두 벌로 존재하게 되고, 한쪽만 고쳐지는 순간 실시간과 확정이 다른 말을
-- 한다. 이 저장소는 loadDowntimeSourceRows 를 단일 소스로 만들며 이미 한 번 겪었다.
--
-- 대신 **"원천이 그대로인가" 만** 확인한다. 계산 규칙은 TS 한 곳에 남고, DB 는 자기가 이미
-- 아는 것(어떤 행이 있는가)만 답한다.
--
-- ══ 지문의 단일 정의 ═════════════════════════════════════════════════════
--
-- 지문은 machine_downtime_intervals 뷰 위에서 계산한다. 그 뷰가 이미 "어떤 행이 비가동인가"
-- (machine_logs 비정상 구간 ∪ downtime_entries)를 단일 정의로 갖고 있으므로, 여기서 그
-- 규칙을 다시 쓰지 않는다. 뷰가 바뀌면 지문도 자동으로 따라간다.

create or replace function public.downtime_window_digest(
  p_machine_id uuid,
  p_window_start timestamptz,
  p_window_end timestamptz
)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- 행이 하나도 없을 때 string_agg 는 NULL 을 돌려준다. NULL 을 그대로 쓰면 "비가동 없음"과
  -- "계산 실패"가 구분되지 않으므로 명시적인 상수로 접는다.
  select coalesce(
    md5(string_agg(
      source || ':' || source_id::text || ':' ||
      extract(epoch from start_time)::text || ':' ||
      coalesce(extract(epoch from end_time)::text, 'open'),
      '|' order by source, source_id::text
    )),
    'empty'
  )
  from public.machine_downtime_intervals
  where machine_id = p_machine_id
    and start_time < p_window_end
    and (end_time is null or end_time > p_window_start)
$$;

comment on function public.downtime_window_digest(uuid, timestamptz, timestamptz) is
  '한 설비·시간창의 비가동 원천 행 집합에 대한 지문. 라우트가 계산 직전에 읽고 '
  'close_shift_upsert_v2 가 잠금 아래에서 재계산해 대조한다(낙관적 동시성). '
  '행의 신원과 시각만 본다 — 분 계산 규칙은 TS 에 하나만 존재한다.';

revoke all on function public.downtime_window_digest(uuid, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.downtime_window_digest(uuid, timestamptz, timestamptz)
  to service_role;

-- ══ close_shift_upsert_v2 ════════════════════════════════════════════════
--
-- **새 이름을 쓰는 이유**: 인자가 셋 늘어난다. CLAUDE.md 경고대로 `create or replace` 는
-- 인자 목록이 다르면 덮어쓰지 않고 오버로드를 만들고, 옛 함수를 DROP 하면 마이그레이션과
-- 코드 배포 사이에 어느 순서로도 피할 수 없는 "함수 없음" 창이 생긴다.
-- v2 를 새로 만들고 v1 은 그대로 둔다. 코드 배포가 끝난 뒤 별도 마이그레이션으로 v1 을
-- 지우면 순서 의존이 사라진다.
--
-- **잠금이 둘인 이유**: v1 은 composite(machine||date||shift) 하나만 잡았다. 그런데 비가동을
-- 바꾸는 쪽(toggle_machine_downtime, 정정 RPC)은 **machine 단독 키**를 쓴다. 키가 다르면
-- 상호 배제가 성립하지 않으므로, 원천 대조가 의미를 가지려면 machine 키도 잡아야 한다.
-- 순서는 machine → composite 로 고정한다(report_shift_progress 와 동일 — 데드락 불가).

create or replace function public.close_shift_upsert_v2(
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
  p_tact_time_seconds integer,  -- null = 공정 기준 미확인(120초 등 날조 금지)
  p_window_start timestamptz,   -- 라우트가 지표를 계산한 교대 시간창
  p_window_end timestamptz,
  p_expected_digest text        -- 계산 **직전에** 읽은 원천 지문
)
returns jsonb
language plpgsql
as $$
declare
  v_defect integer;
  v_quality numeric;
  v_oee numeric;
  v_digest text;
begin
  -- 비가동을 바꾸는 경로(andon·정정)와 같은 키를 먼저 잡는다. 이것이 없으면 아래 지문
  -- 대조와 INSERT 사이에 비가동이 또 바뀔 수 있어 대조가 무의미해진다.
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
  perform pg_advisory_xact_lock(
    hashtextextended(p_machine_id::text || p_date::text || p_shift, 0)
  );

  -- 잠금을 쥔 상태에서 원천을 다시 본다. 라우트가 읽은 뒤 달라졌으면 그 지표는 이미
  -- 낡았다 — 저장하지 않고 되돌려 보내 다시 계산하게 한다.
  v_digest := public.downtime_window_digest(p_machine_id, p_window_start, p_window_end);

  if p_expected_digest is null or v_digest is distinct from p_expected_digest then
    return jsonb_build_object('ok', false, 'reason', 'source_changed');
  end if;

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

revoke all on function public.close_shift_upsert_v2(
  uuid, date, text, integer, integer, integer, integer, numeric, numeric, integer, integer,
  timestamptz, timestamptz, text
) from public, anon, authenticated, service_role;
grant execute on function public.close_shift_upsert_v2(
  uuid, date, text, integer, integer, integer, integer, numeric, numeric, integer, integer,
  timestamptz, timestamptz, text
) to service_role;

-- ══ 적용 전 확인 ═════════════════════════════════════════════════════════
--
-- 1. v1 과 v2 가 **둘 다** 존재하는지(이 시점에는 그래야 한다 — 코드가 아직 v1 을 부를 수 있다).
-- 2. 정상 마감이 ok:true 인지.
-- 3. 지문을 일부러 틀리게 넘기면 source_changed 로 거부되고 **행이 저장되지 않는지**.
-- 4. 롤백 트랜잭션에서: 지문을 읽은 뒤 downtime_entries 를 바꾸고 마감하면 거부되는지.
--
-- 코드 배포 후: v1 을 부르는 곳이 없음을 확인하고 별도 마이그레이션으로 v1 을 DROP 한다.
