-- 자체 감사 후속 #5(중복 계산 방지): machine_downtime_intervals 는 UNION ALL 원시 구간이라
-- 순진하게 SUM(duration) 하면 andon 이 machine_logs·downtime_entries 양쪽에 남긴 같은
-- 비가동을 이중 계산한다(운영 DB 에서 교차 소스 중첩 실측 1건). 소비자가 병합 규칙을 몰라도
-- 되도록, **겹침을 병합한** 비가동 분(minutes)을 돌려주는 함수를 제공한다.
--
-- 알고리즘: 창([p_start,p_end))으로 구간을 클립 → 시작시각 정렬 → 스윕으로 겹침 병합 →
-- 병합 구간 길이 합. 열린 구간(end_time null)은 창 끝(p_end)으로 마감해 계산한다.
create or replace function public.machine_downtime_merged_minutes(
  p_machine_id uuid,
  p_start timestamptz,
  p_end timestamptz
) returns integer
language sql
stable
security invoker
as $$
  with clipped as (
    select
      greatest(i.start_time, p_start) as s,
      least(coalesce(i.end_time, p_end), p_end) as e
    from public.machine_downtime_intervals i
    where i.machine_id = p_machine_id
      and i.start_time < p_end
      and coalesce(i.end_time, p_end) > p_start
  ),
  ordered as (
    select s, e,
      -- 새 병합 그룹의 시작인가: 지금까지의 최대 종료보다 이 구간 시작이 늦으면(=겹치지 않으면) 그룹 경계.
      case when s > max(e) over (order by s, e
             rows between unbounded preceding and 1 preceding)
           then 1 else 0 end as is_new
    from clipped
    where e > s
  ),
  grouped as (
    select s, e, sum(is_new) over (order by s, e) as grp from ordered
  ),
  per_group as (
    select extract(epoch from (max(e) - min(s))) / 60 as minutes
    from grouped group by grp
  )
  select coalesce(sum(minutes), 0)::integer from per_group;
$$;

comment on function public.machine_downtime_merged_minutes(uuid, timestamptz, timestamptz) is
  '창 안에서 machine_downtime_intervals 의 겹침을 병합한 비가동 분. '
  'UNION ALL 원시 구간을 직접 SUM 하면 andon 의 이중 부기로 과다 계산되므로 이 함수를 쓴다.';

revoke all on function public.machine_downtime_merged_minutes(uuid, timestamptz, timestamptz)
  from public, anon;
grant execute on function public.machine_downtime_merged_minutes(uuid, timestamptz, timestamptz)
  to authenticated, service_role;
