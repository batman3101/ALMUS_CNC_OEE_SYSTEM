-- 마감 수량이 진척보다 작을 때 **사유를 받고 흔적을 남긴다**.
--
-- ## 무엇이 문제였나 (감사 2026-08-04, 사용자 확정 2026-08-04)
--
-- 진척 보고는 누적이라 **줄어들 수 없다** — `report_shift_progress` 는 감소를 409 로 거부한다.
-- "조용히 받으면 그 차이만큼 생산량이 증발한다"가 그 이유였다.
--
-- 그런데 마감은 같은 규칙을 따르지 않았다. `final_qty` 로 진척보다 작은 값을 보내면 그대로
-- 확정됐고, 진척 이력(100)과 확정 실적(10)이 어긋난 채 남았다. 확정 레코드가 생겼으므로
-- 그 교대는 마감 대기 목록에서도 사라져 **아무도 이 어긋남을 다시 보지 못했다.**
--
-- ## 왜 막지 않고 허용하는가
--
-- 현장에서 실제로 일어날 수 있는 일이라고 확인받았다(진척 오입력을 교대 끝 종이 카운트로
-- 낮춰 확정). 막아 버리면 진척을 크게 잘못 넣은 교대가 **영원히 마감 불가**가 되어 현장을
-- 세운다. 그래서 허용하되 되짚을 수 있게 만든다 — 사유를 필수로 받고 감사 기록을 남긴다.
--
-- ## 왜 판정이 RPC 안에 있는가
--
-- 라우트에서 진척을 읽어 비교하면 그 읽기는 잠금 밖이다. 읽은 뒤 마감 사이에 새 진척이
-- 들어오면 "사유가 필요한 마감"이 사유 없이 통과한다. 그래서 **잠금을 쥔 뒤** 진척을 다시
-- 읽어 판정한다 — 이 저장소가 반복해서 배운 "판단과 쓰기는 같은 잠금 아래" 규칙이다.
--
-- 감사 기록도 같은 트랜잭션 안에서 쓴다. 라우트가 RPC 성공 후에 따로 남기면, 그 INSERT 가
-- 실패했을 때 **사유 없는 하향 마감**이 조용히 남는다.
--
-- ## 왜 새 이름인가
--
-- 인자가 둘 늘었다. `create or replace` 는 인자 목록이 다르면 덮어쓰지 않고 **오버로드**를
-- 만들고, v2 를 DROP 하면 마이그레이션과 코드 배포 사이에 "함수 없음" 창이 생긴다.
-- 그래서 새 이름으로 만들고 v2 는 남긴다. v2 제거는 새 코드가 배포된 것을 확인한 뒤
-- 별도 마이그레이션으로 한다(close_shift_upsert v1 → v2 때와 같은 3단계).
--
-- **적용 순서: 이 마이그레이션이 코드 배포보다 먼저다.** 새 코드가 v3 를 부르므로
-- v3 가 없으면 마감이 실패한다. (권한을 회수하는 마이그레이션과는 반대 방향이다.)

create or replace function public.close_shift_upsert_v3(
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
  -- 진척보다 낮게 마감할 때의 사유. 그 경우가 아니면 무시된다.
  p_below_progress_reason text,
  -- 감사 기록의 changed_by. 서비스 롤로 부르므로 auth.uid() 를 쓸 수 없다.
  p_actor_id uuid
)
returns jsonb
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_defect integer;
  v_quality numeric;
  v_oee numeric;
  v_digest text;
  v_last_progress integer;
  v_reason text;
  v_record_id uuid;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
  perform pg_advisory_xact_lock(
    hashtextextended(p_machine_id::text || p_date::text || p_shift, 0)
  );

  v_digest := public.downtime_window_digest(p_machine_id, p_window_start, p_window_end);

  if p_expected_digest is null or v_digest is distinct from p_expected_digest then
    return jsonb_build_object('ok', false, 'reason', 'source_changed');
  end if;

  -- 잠금 아래에서 읽은 진척만이 판정 근거다.
  select max(shift_output_qty) into v_last_progress
  from public.production_progress_reports
  where machine_id = p_machine_id and date = p_date and shift = p_shift;

  v_reason := nullif(btrim(coalesce(p_below_progress_reason, '')), '');

  -- 진척보다 낮은 마감은 허용하되 사유가 있어야 한다. 사유 없이 오면 되돌려 보내
  -- 화면이 확인 단계를 띄우게 한다.
  if v_last_progress is not null and p_output_qty < v_last_progress and v_reason is null then
    return jsonb_build_object(
      'ok', false,
      'reason', 'below_progress_needs_reason',
      'last_progress_qty', v_last_progress
    );
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
    tact_time_seconds = excluded.tact_time_seconds
  returning record_id into v_record_id;

  -- 하향 마감이면 같은 트랜잭션에서 흔적을 남긴다. 나중에 "왜 100 이 10 이 됐나"를
  -- 되짚을 수 있어야 이 허용이 정당해진다.
  if v_last_progress is not null and p_output_qty < v_last_progress then
    insert into public.audit_log(table_name, record_id, action, old_values, new_values, changed_by)
    values (
      'production_records',
      v_record_id,
      'close_below_progress',
      jsonb_build_object('last_progress_qty', v_last_progress),
      jsonb_build_object(
        'output_qty', p_output_qty,
        'reason', v_reason,
        'date', p_date,
        'shift', p_shift
      ),
      p_actor_id
    );
  end if;

  return jsonb_build_object(
    'ok', true,
    'preserved_defect', v_defect,
    'below_progress', (v_last_progress is not null and p_output_qty < v_last_progress)
  );
end;
$$;

-- Supabase 는 새 함수에 PUBLIC EXECUTE 를 부여한다. 서비스 롤(API 라우트)만 부르므로 회수한다.
revoke all on function public.close_shift_upsert_v3(
  uuid, date, text, integer, integer, integer, integer, numeric, numeric, integer, integer,
  timestamptz, timestamptz, text, text, uuid
) from public;
revoke all on function public.close_shift_upsert_v3(
  uuid, date, text, integer, integer, integer, integer, numeric, numeric, integer, integer,
  timestamptz, timestamptz, text, text, uuid
) from anon;
revoke all on function public.close_shift_upsert_v3(
  uuid, date, text, integer, integer, integer, integer, numeric, numeric, integer, integer,
  timestamptz, timestamptz, text, text, uuid
) from authenticated;

-- v2 는 남긴다. 새 코드가 배포된 것을 확인한 뒤 별도 마이그레이션으로 제거한다.
