-- 일 단위 OEE 집계를 공장 범위로
--
-- `analytics_oee_daily(p_start_date, p_machine_id)` 은 공장을 모른다. `p_machine_id` 가 NULL
-- 이면(대시보드 추이 화면의 기본값) **전체 설비**를 집계하므로, ALV 화면에 ALT 800대와
-- ALV 350대를 합친 숫자가 뜬다.
--
-- 이 누수는 눈에 잘 띄지 않는다. 값이 비거나 오류가 나는 게 아니라 **그럴듯하게 큰 숫자**가
-- 나오기 때문이다. 다른 공장 설비 이름이 화면에 뜨는 것과 달리, 여기서는 합계 하나만 보인다.
--
-- ## 자매 함수들은 왜 안 고치는가
--
-- `analytics_oee_by_machine(p_start_date, p_end_date, p_machine_ids, p_shifts)` 는 이미
-- `p_machine_ids` 를 받는다. 라우트가 그 공장의 설비 id 만 넘기면 공장 범위가 되므로 함수를
-- 바꿀 필요가 없다 — DB 변경 없이 끝나는 쪽을 고른다.
--
-- `analytics_oee_records_summary`, `analytics_productivity`, `analytics_quality` 는 각각의
-- 라우트가 이미 `requireFactoryUser` 로 전환되면서 설비 id 목록으로 범위를 좁힌다.
--
-- ## 새 이름을 쓰는 이유
--
-- CLAUDE.md 의 규칙 그대로다 — 인자를 늘리면 `create or replace` 가 오버로드를 만들고, 옛
-- 함수를 DROP 하면 마이그레이션과 배포 사이에 "함수 없음" 창이 생긴다. 구버전을 남겨 두면
-- 어느 순서로 배포해도 안전하다.

begin;

create or replace function public.analytics_oee_daily_scoped(
  p_factory_id uuid,
  p_start_date date,
  p_machine_id uuid default null
)
returns json
language sql
stable security definer
set search_path = public, pg_temp
set extra_float_digits = 3
as $$
  select coalesce(json_agg(row_to_json(d) order by d.date), '[]'::json)
  from (
    select
      date,
      count(*)::bigint as records_count,
      count(*) filter (where oee_reported and not invalid)::bigint as reported_records,
      count(*) filter (where not oee_reported and not invalid)::bigint as unreported_records,
      count(*) filter (where invalid)::bigint as invalid_records,
      coalesce(sum(planned_runtime) filter (where oee_reported and not invalid), 0)::bigint
        as total_planned_runtime,
      coalesce(sum(actual_runtime) filter (where oee_reported and not invalid), 0)::bigint
        as total_actual_runtime,
      coalesce(sum(ideal_runtime) filter (where oee_reported and not invalid), 0)::bigint
        as total_ideal_runtime,
      coalesce(sum(output_qty) filter (where oee_reported and not invalid), 0)::bigint
        as metric_output,
      coalesce(sum(defect_qty) filter (where oee_reported and not invalid), 0)::bigint
        as metric_defects,
      coalesce(sum(output_qty) filter (where not invalid), 0)::bigint as total_output,
      coalesce(sum(defect_qty) filter (where not invalid), 0)::bigint as total_defects
    from (
      select
        raw.*,
        (
          downtime_minutes is not null
          and planned_runtime is not null
          and actual_runtime is not null
          and ideal_runtime is not null
          and not invalid
        ) as oee_reported
      from (
        select
          pr.*,
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
          ) as invalid
        from public.production_records pr
        where pr.date >= p_start_date
          -- 공장 조건이 이 한 줄이다. 나머지 본문은 원본과 글자 그대로 같게 두었다 —
          -- 여기서 "정리"하면 두 함수가 서로 다른 답을 내기 시작하고, 그 차이는 3단계 배포
          -- 중간에만 나타나 재현하기 가장 어려운 종류의 불일치가 된다.
          and pr.factory_id = p_factory_id
          and (p_machine_id is null or pr.machine_id = p_machine_id)
          -- 설비 존재 확인도 같은 공장 안에서 한다. 공장을 빼면 다른 공장에 같은
          -- machine_id 가 있다는 이유로 고아 행이 살아남는다(실제로는 복합 FK 가 막지만,
          -- 이 조건이 그 사실에 기대고 있다고 읽히면 안 된다).
          and exists (
            select 1 from public.machines m
            where m.id = pr.machine_id and m.factory_id = p_factory_id
          )
      ) raw
    ) base
    group by date
  ) d;
$$;

revoke all on function public.analytics_oee_daily_scoped(uuid, date, uuid)
  from public, anon, authenticated;
grant execute on function public.analytics_oee_daily_scoped(uuid, date, uuid)
  to service_role;

comment on function public.analytics_oee_daily_scoped(uuid, date, uuid) is
  'Factory-scoped variant of analytics_oee_daily. Same aggregation, restricted to one factory.';

commit;
