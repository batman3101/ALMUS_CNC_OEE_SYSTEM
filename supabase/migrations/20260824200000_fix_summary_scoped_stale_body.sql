-- analytics_oee_records_summary_scoped 를 **현행 본문**으로 다시 만든다
--
-- ## 무엇이 틀렸나 (2026-08-24 브라우저 UI 검증에서 발견)
--
-- 통계 리포트 화면이 이렇게 떴다:
--
--   OEE 계산 가능 기록 **0 / 33,511건**    (분석 화면은 33,338 / 33,511)
--   총 생산량 **0 개**                      (분석 화면은 2,821,808개)
--   평균 OEE **49.0%**                      (분석 화면은 98.2%)
--
-- "계산 가능 0건인데 평균 OEE 49%"는 그 자체로 자기모순이다. 같은 공장, 같은 기간인데 두
-- 화면이 정반대를 말했다.
--
-- 원인: 20260824170000 에서 이 함수를 만들 때 **낡은 본문을 베꼈다.** 원본은
-- `20260713202705` 에서 5컬럼으로 태어났지만 `20260715170000` 이 **18컬럼**으로 전면
-- 교체했다(trusted/reported 부분집합, total_output, impossible_records …). 나는 교체 전
-- 버전을 옮겨 적었다.
--
-- 그래서:
--   - `total_output` 컬럼이 없다        -> 화면의 총 생산량이 0
--   - `reported_records` 컬럼이 없다    -> "계산 가능 0건"
--   - `avg_oee` 가 NULL 을 0 으로 뭉개  -> 16,107/35,098 이 NULL 이라 평균이 반토막
--
-- ## 왜 by_machine 은 멀쩡했나
--
-- `analytics_oee_by_machine_scoped` 는 본문을 베끼지 않고 **원본을 감쌌다.** 그리고 반환형이
-- TABLE 이라 컬럼 수가 어긋나는 순간 함수 생성이 실패했고, 실제로 그때 걸려서 고쳤다.
--
-- 이 함수는 본문을 베꼈고, 반환형까지 낡은 5컬럼으로 선언했기 때문에 **생성이 성공했다.**
-- 즉 "베끼면 안 된다"는 교훈은 이미 적어 놨는데, 정작 감쌀 수 없는 하나(원본이 설비를
-- 단건으로만 받는다)에서 그 규칙을 어겼다.
--
-- ## 이번에는 값으로 감시한다
--
-- 반환형 비교만으로는 부족하다 — 컬럼 수가 같아도 본문이 갈라질 수 있고, `analytics_oee_daily`
-- 처럼 둘 다 `json` 을 돌려주면 시그니처가 아예 정보를 담지 않는다.
--
-- 그래서 아래 do 블록은 **실제 값**을 비교한다: 모든 공장의 scoped 합이 원본과 같아야 한다.
-- 이 성질은 본문이 갈라지는 순간 깨진다.

begin;

/*
 * 반환형이 5컬럼 -> 18컬럼으로 바뀌므로 `create or replace` 가 거부한다
 * ("cannot change return type of existing function", 42P13). DROP 이 필요하다.
 *
 * CLAUDE.md 는 DROP 이 "함수 없음" 창을 만든다고 경고한다. 여기서는 그 위험이 없다:
 * 이 함수는 **아직 운영에 배포된 적이 없고**(다중화 전체가 미적용), 호출자는 이 저장소
 * 안의 `/api/oee-data` 하나뿐이다. 같은 트랜잭션 안에서 drop+create 하므로 다른 세션이
 * 그 사이를 보지도 못한다.
 *
 * 이미 운영에 나간 함수였다면 새 이름 + 3단계 배포를 썼을 것이다.
 */
drop function if exists public.analytics_oee_records_summary_scoped(uuid, date, date, uuid, text);

create function public.analytics_oee_records_summary_scoped(
  p_factory_id uuid,
  p_start_date date,
  p_end_date   date default null,
  p_machine_id uuid default null,
  p_shift      text default null
)
returns table (
  total_records                 bigint,
  avg_availability              double precision,
  avg_performance               double precision,
  avg_quality                   double precision,
  avg_oee                       double precision,
  total_output                  bigint,
  total_defect                  bigint,
  total_good                    bigint,
  total_planned_runtime         bigint,
  total_actual_runtime          bigint,
  total_ideal_runtime           bigint,
  unreported_records            bigint,
  reported_records              bigint,
  avg_availability_reported     double precision,
  avg_oee_reported              double precision,
  impossible_records            bigint,
  avg_oee_excluding_impossible  double precision,
  avg_quality_excluding_impossible double precision
)
language sql
stable security definer
set search_path = public, pg_temp
as $function$
  -- 본문은 원본(analytics_oee_records_summary)과 글자 그대로 같고, 공장 조건 두 줄만
  -- 더해졌다. 원본이 바뀌면 여기도 바뀌어야 한다 — 아래 do 블록이 값으로 감시한다.
  with raw as materialized (
    select
      pr.planned_runtime,
      pr.actual_runtime,
      pr.ideal_runtime,
      pr.output_qty,
      pr.defect_qty,
      pr.downtime_minutes,
      (
        coalesce(pr.planned_runtime, 0) < 0 or
        coalesce(pr.actual_runtime, 0) < 0 or
        coalesce(pr.ideal_runtime, 0) < 0 or
        coalesce(pr.output_qty, 0) < 0 or
        coalesce(pr.defect_qty, 0) < 0 or
        coalesce(pr.defect_qty, 0) > coalesce(pr.output_qty, 0) or
        (coalesce(pr.output_qty, 0) = 0 and (
          coalesce(pr.oee, 0) <> 0 or
          coalesce(pr.quality, 0) <> 0 or
          coalesce(pr.ideal_runtime, 0) <> 0
        ))
      ) as impossible
    from public.production_records pr
    where pr.date >= p_start_date
      and pr.factory_id = p_factory_id                      -- 공장 조건 (1/2)
      and (p_end_date is null or pr.date <= p_end_date)
      and (p_machine_id is null or pr.machine_id = p_machine_id)
      and (p_shift is null or pr.shift = p_shift)
      and exists (
        select 1 from public.machines m
        where m.id = pr.machine_id and m.factory_id = p_factory_id   -- 공장 조건 (2/2)
      )
  ), base as materialized (
    select
      raw.*,
      (
        downtime_minutes is not null
        and planned_runtime is not null
        and actual_runtime is not null
        and ideal_runtime is not null
        and not impossible
      ) as oee_reported
    from raw
  ), trusted as (
    select * from base where oee_reported
  ), totals as (
    select
      (select count(*) from base)::bigint as total_records,
      (select count(*) from base where not oee_reported and not impossible)::bigint as unreported_records,
      (select count(*) from base where oee_reported)::bigint as reported_records,
      (select count(*) from base where impossible)::bigint as impossible_records,
      coalesce((select sum(output_qty) from base where not impossible), 0)::bigint as total_output,
      coalesce((select sum(defect_qty) from base where not impossible), 0)::bigint as total_defect,
      coalesce((select sum(planned_runtime) from base where not impossible), 0)::bigint as total_planned_runtime,
      coalesce((select sum(actual_runtime) from base where not impossible), 0)::bigint as total_actual_runtime,
      coalesce((select sum(ideal_runtime) from base where not impossible), 0)::bigint as total_ideal_runtime,
      coalesce((select sum(planned_runtime) from trusted), 0)::float8 as metric_planned,
      coalesce((select sum(actual_runtime) from trusted), 0)::float8 as metric_actual,
      coalesce((select sum(ideal_runtime) from trusted), 0)::float8 as metric_ideal,
      coalesce((select sum(output_qty) from trusted), 0)::float8 as metric_output,
      coalesce((select sum(defect_qty) from trusted), 0)::float8 as metric_defect
  ), metrics as (
    select
      t.*,
      case
        when reported_records = 0 or metric_planned <= 0 or metric_actual < 0 then null
        else least(1::float8, greatest(0::float8, metric_actual / metric_planned))
      end as availability,
      case
        when reported_records = 0 or metric_actual < 0 or metric_ideal < 0 then null
        when metric_actual = 0 then 0::float8
        else least(1::float8, greatest(0::float8, metric_ideal / metric_actual))
      end as performance,
      case
        when reported_records = 0
          or metric_output < 0
          or metric_defect < 0
          or metric_defect > metric_output then null
        when metric_output = 0 then 0::float8
        else least(1::float8, greatest(0::float8, (metric_output - metric_defect) / metric_output))
      end as quality
    from totals t
  )
  select
    total_records,
    availability,
    performance,
    quality,
    availability * performance * quality,
    total_output,
    total_defect,
    total_output - total_defect,
    total_planned_runtime,
    total_actual_runtime,
    total_ideal_runtime,
    unreported_records,
    reported_records,
    availability,
    availability * performance * quality,
    impossible_records,
    availability * performance * quality,
    quality
  from metrics;
$function$;

revoke all on function public.analytics_oee_records_summary_scoped(uuid, date, date, uuid, text)
  from public, anon, authenticated;
grant execute on function public.analytics_oee_records_summary_scoped(uuid, date, date, uuid, text)
  to service_role;

/**
 * 값으로 감시한다 — 반환형 비교로는 부족했다.
 *
 * 모든 공장의 scoped 합계가 원본과 같아야 한다. 본문이 갈라지면 이 성질이 깨진다.
 * 반환형만 비교했다면 이번 결함(낡은 5컬럼 본문)은 잡혔겠지만, 컬럼 수가 우연히 같은
 * 드리프트나 `analytics_oee_daily` 처럼 둘 다 json 을 돌려주는 경우는 못 잡는다.
 *
 * 기간을 넓게(2000-01-01) 잡아 데이터가 있는 한 실제 값이 비교되게 한다. 데이터가 없으면
 * 양쪽 다 0 이라 통과하는데, 그때는 비교할 것이 없는 것이 맞다.
 */
do $$
declare
  v_orig_total  bigint;
  v_orig_output bigint;
  v_sum_total   bigint := 0;
  v_sum_output  bigint := 0;
  r record;
begin
  select total_records, total_output into v_orig_total, v_orig_output
  from public.analytics_oee_records_summary('2000-01-01');

  for r in select id from public.factories loop
    declare
      t bigint; o bigint;
    begin
      select total_records, total_output into t, o
      from public.analytics_oee_records_summary_scoped(r.id, '2000-01-01');
      v_sum_total  := v_sum_total + coalesce(t, 0);
      v_sum_output := v_sum_output + coalesce(o, 0);
    end;
  end loop;

  if v_sum_total is distinct from v_orig_total or v_sum_output is distinct from v_orig_output then
    raise exception using
      message = 'analytics_oee_records_summary_scoped 가 원본과 다른 값을 낸다',
      detail  = format('원본 total=%s output=%s / 공장 합 total=%s output=%s',
                       v_orig_total, v_orig_output, v_sum_total, v_sum_output),
      hint    = '원본 본문이 바뀌었다면 scoped 본문도 함께 고쳐야 합니다.';
  end if;

  raise notice 'scoped 합계 = 원본 (total=%, output=%)', v_orig_total, v_orig_output;
end $$;

commit;
