-- 자체 감사 #5(과도기 조치): 비가동의 두 소스를 하나의 뷰로 노출한다.
--
-- 비가동은 machine_logs(비정상 상태 구간)와 downtime_entries(andon/수동 비가동)의
-- **유니온**으로 계산해야 한다(calculateVerifiedDowntimeMinutesForWindow 와 동일 계약).
-- 지금은 소비자마다 이 규칙을 기억해야 해서, 한쪽만 읽는 실수가 구조적으로 가능하다
-- (andon 이중 로그 사고의 뿌리도 이 이중 부기였다).
--
-- 이 뷰는 그 유니온을 DB 가 내려주는 단일 표면이다. 분석 쿼리·신규 소비자는 이 뷰를
-- 읽으면 유니온 규칙을 틀릴 수 없다. (기존 TS 경로는 열린 구간 now() 처리 때문에
-- 당분간 유지 — 장기적으로 downtime_entries 단일 진실화가 목표, 코드맵/제안 #5 참조)
--
-- security_invoker: 조회자의 RLS 로 평가한다(20260715 security_invoker_views 와 동일 규율).
create or replace view public.machine_downtime_intervals
with (security_invoker = true) as
select
  ml.machine_id,
  ml.start_time,
  ml.end_time,                       -- null = 진행 중
  'machine_log'::text as source,
  ml.state           as reason,
  ml.log_id          as source_id
from public.machine_logs ml
where ml.state <> 'NORMAL_OPERATION'
union all
select
  de.machine_id,
  de.start_time,
  de.end_time,
  'downtime_entry'::text as source,
  de.reason,
  de.id as source_id
from public.downtime_entries de;

comment on view public.machine_downtime_intervals is
  '비가동 구간의 단일 표면(machine_logs 비정상 구간 ∪ downtime_entries). '
  '겹치는 구간은 소비 측에서 병합해야 한다(두 소스가 같은 비가동을 함께 기록한다 — andon).';

revoke all on public.machine_downtime_intervals from public, anon;
grant select on public.machine_downtime_intervals to authenticated, service_role;
