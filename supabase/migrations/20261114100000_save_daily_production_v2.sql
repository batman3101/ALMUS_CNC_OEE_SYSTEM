-- 일일 생산 저장에 낙관적 동시성(CAS)과 비가동 원천 대조를 더한다 (감사 2026-11-14 F-02).
--
-- ## 무엇이 문제였나
--
-- `/data-input` 의 일일 저장은 `save_daily_production` 을 부른다. 이 함수는 설비 행 잠금만 잡고,
-- 화면이 **언제** 읽은 값인지 모른 채 `ON CONFLICT … defect_qty = EXCLUDED.defect_qty` 로 덮어쓴다.
--
--   1. 관리자가 데이터 입력 화면을 연다 — A교대 불량 1
--   2. 다른 곳에서 불량 9 를 확정한다(confirm_shift_defect / 마감 대기 표)
--   3. 1단계 화면에서 저장 → 불량이 1 로 돌아가고 품질·OEE 도 그 값으로 다시 계산된다. 응답은 200.
--
-- 마감 경로(close_shift_upsert_v3)와 개별 수정 경로([recordId] 의 CAS)는 이미 이런 덮어쓰기를 막는다.
-- 일일 저장만 그 규약 밖에 있었다. 또 서버가 비가동을 읽고 계산한 뒤 저장하기 전에 비가동이 바뀌어도
-- 대조하지 않았다.
--
-- ## 어떻게 고치나
--
-- 1. 마감 경로와 같은 advisory lock(설비 → 교대 A → 교대 B)을 먼저 잡는다. 교대 기록을 쓰는 다른
--    RPC(close_shift_upsert_v3·confirm_shift_defect·delete_production_record·report_shift_progress)가
--    같은 키를 쓰므로 판단과 쓰기 사이에 아무도 끼어들 수 없다. 순서는 advisory → 행 잠금(CLAUDE.md).
-- 2. 건드리는 교대(저장·휴무)마다 화면이 본 지문(p_expected)을 현재 행과 대조한다.
--    `null` = "기록이 없었다". 그 사이 누가 만들었거나 바꿨으면 `record_changed` 로 아무것도 쓰지 않는다.
--    대조 컬럼은 [recordId] 라우트의 CONCURRENCY_GUARD_COLUMNS 와 같다(좁은 지문은 지문이 아니다).
-- 3. 저장하는 교대는 라우트가 계산 **전에** 잡은 비가동 지문(p_sources)을 잠금 아래에서 다시 계산해
--    대조한다(close-shift 와 같은 downtime_window_digest). 어긋나면 `source_changed`.
-- 4. 통과하면 기존 `save_daily_production` 을 **같은 트랜잭션에서** 부른다 — 쓰기 규칙은 한 곳에 남는다.
--
-- ## 왜 새 이름인가
--
-- 인자가 늘면 `create or replace` 는 오버로드를 만들고, 옛 함수를 DROP 하는 순간 배포 창이 생긴다.
-- v1 은 그대로 두고 v2 를 더한다. 순수 추가라 **이 파일을 코드보다 먼저 적용해도 기존 동작은 그대로**다.
-- 적용 순서: 이 파일 → 코드. (코드가 먼저 나가면 일일 저장만 "함수 없음"으로 실패한다.)
--
-- 권한 검사(휴무 = 삭제 → admin/engineer)는 라우트가 한다. 이 함수는 서비스 롤만 부른다.

create or replace function public.save_daily_production_v2(
  p_machine_id uuid,
  p_date date,
  p_day_shift_off boolean,
  p_night_shift_off boolean,
  p_day_record jsonb,
  p_night_record jsonb,
  -- {"A": null | {record_id, output_qty, …}, "B": …} — 건드리는 교대마다 키가 있어야 한다.
  p_expected jsonb,
  -- {"A": {"start": timestamptz, "end": timestamptz, "digest": text}, …} — 저장하는 교대마다.
  p_sources jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_shift text;
  v_shift_off boolean;
  v_record jsonb;
  v_exp jsonb;
  v_src jsonb;
  v_row public.production_records%rowtype;
  v_found boolean;
  v_result jsonb;
begin
  if p_machine_id is null or p_date is null then
    raise exception 'machine_id and date are required' using errcode = '22023';
  end if;

  -- 마감 경로와 같은 키·같은 순서. 교대 둘을 함께 잡는 것은 이 함수뿐이고 언제나 설비 → A → B 라 교착이 없다.
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text || p_date::text || 'A', 0));
  perform pg_advisory_xact_lock(hashtextextended(p_machine_id::text || p_date::text || 'B', 0));

  foreach v_shift in array array['A', 'B'] loop
    if v_shift = 'A' then
      v_shift_off := coalesce(p_day_shift_off, false);
      v_record := p_day_record;
    else
      v_shift_off := coalesce(p_night_shift_off, false);
      v_record := p_night_record;
    end if;

    -- 저장도 휴무도 아닌 교대는 v1 이 기록을 건드리지 않는다. 대조할 것도 없다.
    if not v_shift_off and v_record is null then
      continue;
    end if;

    -- 키가 없으면 "기록 없음을 봤다"와 "모른다"를 구분할 수 없다. 쓰지 않는다.
    if p_expected is null or jsonb_typeof(p_expected) <> 'object' or not (p_expected ? v_shift) then
      return jsonb_build_object('ok', false, 'reason', 'expected_missing', 'shift', v_shift);
    end if;
    v_exp := p_expected -> v_shift;

    select * into v_row
    from public.production_records pr
    where pr.machine_id = p_machine_id and pr.date = p_date and pr.shift = v_shift
    for update;
    v_found := found;

    if jsonb_typeof(v_exp) = 'null' then
      if v_found then
        return jsonb_build_object('ok', false, 'reason', 'record_changed', 'shift', v_shift);
      end if;
    elsif jsonb_typeof(v_exp) <> 'object' then
      return jsonb_build_object('ok', false, 'reason', 'expected_missing', 'shift', v_shift);
    elsif not v_found
      or v_row.record_id::text is distinct from (v_exp ->> 'record_id')
      or v_row.output_qty::numeric        is distinct from (v_exp ->> 'output_qty')::numeric
      or v_row.defect_qty::numeric        is distinct from (v_exp ->> 'defect_qty')::numeric
      or v_row.planned_runtime::numeric   is distinct from (v_exp ->> 'planned_runtime')::numeric
      or v_row.actual_runtime::numeric    is distinct from (v_exp ->> 'actual_runtime')::numeric
      or v_row.ideal_runtime::numeric     is distinct from (v_exp ->> 'ideal_runtime')::numeric
      or v_row.downtime_minutes::numeric  is distinct from (v_exp ->> 'downtime_minutes')::numeric
      or v_row.tact_time_seconds          is distinct from (v_exp ->> 'tact_time_seconds')::numeric
      or v_row.availability               is distinct from (v_exp ->> 'availability')::numeric
      or v_row.performance                is distinct from (v_exp ->> 'performance')::numeric
      or v_row.quality                    is distinct from (v_exp ->> 'quality')::numeric
      or v_row.oee                        is distinct from (v_exp ->> 'oee')::numeric
    then
      return jsonb_build_object('ok', false, 'reason', 'record_changed', 'shift', v_shift);
    end if;

    -- 저장하는 교대는 계산에 쓴 비가동 원천이 그대로인지 본다(휴무는 계산이 없다).
    if not v_shift_off then
      v_src := case when p_sources is null then null else p_sources -> v_shift end;
      if v_src is null or jsonb_typeof(v_src) <> 'object' then
        return jsonb_build_object('ok', false, 'reason', 'source_missing', 'shift', v_shift);
      end if;
      if public.downtime_window_digest(
           p_machine_id, (v_src ->> 'start')::timestamptz, (v_src ->> 'end')::timestamptz
         ) is distinct from (v_src ->> 'digest') then
        return jsonb_build_object('ok', false, 'reason', 'source_changed', 'shift', v_shift);
      end if;
    end if;
  end loop;

  -- 대조를 모두 통과했다. 쓰기 규칙은 v1 하나에 둔다(같은 트랜잭션, 잠금 유지).
  v_result := public.save_daily_production(
    p_machine_id, p_date, p_day_shift_off, p_night_shift_off, p_day_record, p_night_record
  );
  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('ok', true);
end;
$$;

-- Supabase 는 새 함수에 PUBLIC EXECUTE 를 부여한다. API 라우트(서비스 롤)만 부르므로 회수하고,
-- PUBLIC 회수로 끊긴 service_role 의 권한은 명시적으로 되돌려 준다.
revoke all on function public.save_daily_production_v2(
  uuid, date, boolean, boolean, jsonb, jsonb, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.save_daily_production_v2(
  uuid, date, boolean, boolean, jsonb, jsonb, jsonb, jsonb
) to service_role;
