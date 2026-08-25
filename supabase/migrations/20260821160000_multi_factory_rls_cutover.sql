-- ALT/ALV 멀티테넌시 P1-6b: RLS 정책 교체 (cutover)
--
-- 계약: docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.md 5.2
--
-- ## 왜 한 트랜잭션인가
--
-- 계약 5.2: "기존 permissive 정책과 새 정책이 OR 로 합쳐지지 않도록 정책 교체를 같은
-- transaction 에서 수행한다."
--
-- Postgres 의 여러 PERMISSIVE 정책은 **OR** 로 결합된다. 좁은 정책을 추가해도 넓은 정책이
-- 남아 있으면 넓은 쪽이 이긴다. 그래서 "새 정책을 먼저 만들고 나중에 옛것을 지운다"는
-- 안전해 보이는 순서가 실제로는 **그 사이 내내 격리가 없는** 상태를 만든다.
--
-- ## 성능 설계 — 인자 없는 helper 를 쓰는 이유
--
-- `has_factory_membership(factory_id)` 를 술어로 쓰면 `factory_id` 가 **컬럼**이라 행마다
-- 호출된다. production_shift_states 는 6만행이다.
--
-- 계약 1절이 "일반 사용자는 하나의 active membership 만 가진다"고 정했으므로 인자 없는
-- `current_user_factory()` 를 만들 수 있다. 그러면 술어가
--
--   factory_id = (select public.current_user_factory())
--
-- 형태가 되어 Postgres 가 InitPlan 으로 **한 번만** 평가하고, factory 선두 index 를 탄다.
-- 이 저장소는 같은 교훈을 이미 겪었다 — RLS 술어를 `in (select unnest(...))` 로 바꿔
-- 166배를 얻은 적이 있다(2026-07-29).
--
-- 인자 있는 helper(has_factory_membership 등)는 지우지 않는다. RPC 내부 검증에서는
-- 대상 공장이 인자로 들어오므로 그쪽이 맞다.
--
-- ## 정책 0개였던 테이블
--
-- production_shift_states, production_progress_reports, audit_log, alert_acknowledgements 는
-- RLS 만 켜져 있고 정책이 없었다(deny-all). 여기서 처음으로 실제 정책을 갖는다.

begin;

-- ---------------------------------------------------------------------------
-- 1. 인자 없는 helper
-- ---------------------------------------------------------------------------
-- 활성 membership 이 **정확히 하나**일 때만 값을 준다. 0개나 2개 이상은 NULL 이고,
-- `factory_id = NULL` 은 어떤 행과도 매치되지 않으므로 fail-closed 다.
-- 서버 계약(requireFactoryUser)의 판정과 같은 규칙이다.
create or replace function public.current_user_factory()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- "정확히 하나"를 집계 하나로 표현한다. 2개 이상이면 NULL 이고, NULL 은 어떤 행과도
  -- 매치되지 않으므로 그대로 fail-closed 가 된다.
  --
  -- `limit 1` 로 아무거나 고르지 않는 것이 핵심이다. 그러면 사용자는 자기가 어느 공장에
  -- 쓰고 있는지 모르는 채로 쓰게 된다 — 서버 계약(requireFactoryUser)이 같은 이유로
  -- 2개 이상을 거부한다.
  -- Postgres 에는 min(uuid) 가 없다. 배열로 모아 개수를 세고 첫 원소를 꺼낸다.
  select case when count(*) = 1 then (array_agg(fm.factory_id))[1] end
  from public.factory_memberships fm
  join public.factories f on f.id = fm.factory_id
  join public.user_profiles up on up.user_id = fm.user_id
  where fm.user_id = (select auth.uid())
    and fm.is_active
    and f.is_active
    and coalesce(up.is_active, false)
$$;

comment on function public.current_user_factory() is
  '현재 사용자의 유일한 활성 공장. 0개·2개 이상이면 NULL(fail-closed).';

create or replace function public.current_user_factory_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select fm.role
  from public.factory_memberships fm
  where fm.user_id = (select auth.uid())
    and fm.factory_id = (select public.current_user_factory())
    and fm.is_active
  limit 1
$$;

comment on function public.current_user_factory_role() is
  '현재 공장에서의 역할. 전역 역할(user_profiles.role)이 아니다.';

-- operator 담당 설비를 **배열로 한 번에** 준다. 행마다 EXISTS 를 도는 대신
-- `machine_id in (select unnest(...))` 로 쓰기 위해서다.
create or replace function public.current_factory_machine_ids()
returns uuid[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(uma.machine_id), '{}')
  from public.user_machine_assignments uma
  where uma.user_id = (select auth.uid())
    and uma.factory_id = (select public.current_user_factory())
    and uma.is_active
$$;

comment on function public.current_factory_machine_ids() is
  'operator 담당 설비 id 배열. RLS 에서 in(select unnest(..)) 으로 쓴다.';

revoke all on function public.current_user_factory() from public, anon;
revoke all on function public.current_user_factory_role() from public, anon;
revoke all on function public.current_factory_machine_ids() from public, anon;
grant execute on function public.current_user_factory() to authenticated, service_role;
grant execute on function public.current_user_factory_role() to authenticated, service_role;
grant execute on function public.current_factory_machine_ids() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. 기존 정책 전부 제거
-- ---------------------------------------------------------------------------
-- 운영(20개)과 로컬 재현(12개)의 **합집합**을 지운다. baseline 이 정책까지는 재현하지
-- 않아 두 목록이 다르다 — 없는 것을 지우는 것은 무해하지만, 있는 것을 남기면 격리가
-- 무너지므로 넓게 지운다.
drop policy if exists "Admin can read downtime_entries" on public.downtime_entries;
drop policy if exists "Engineer can view all downtime_entries" on public.downtime_entries;
drop policy if exists "Operator can view downtime for assigned machines" on public.downtime_entries;
drop policy if exists "Scoped read machine_logs" on public.machine_logs;
drop policy if exists "Authenticated can read machine status descriptions" on public.machine_status_descriptions;
drop policy if exists "Admin and engineers can insert status history" on public.machine_status_history;
drop policy if exists "Authenticated users can read status history" on public.machine_status_history;
drop policy if exists "Authenticated users can modify machines" on public.machines;
drop policy if exists "Scoped read machines" on public.machines;
drop policy if exists "Active managers can read model processes" on public.model_processes;
drop policy if exists "Active managers can read product models" on public.product_models;
drop policy if exists "Scoped read production_records" on public.production_records;
drop policy if exists "Only admins can modify system settings" on public.system_settings;
drop policy if exists "모든 인증된 사용자는 시스템 설정을 볼 수 있" on public.system_settings;
drop policy if exists "모든 인증된 사용자는 시스템 설정을 볼 수 있습니다" on public.system_settings;
drop policy if exists "Service role can insert audit logs" on public.system_settings_audit;
drop policy if exists "Active admins and engineers can view audit logs" on public.system_settings_audit;
drop policy if exists "Admins can manage profiles" on public.user_profiles;
drop policy if exists "Service role full access" on public.user_profiles;
drop policy if exists "Admins can read all profiles" on public.user_profiles;
drop policy if exists "Users can read own profile" on public.user_profiles;

-- ---------------------------------------------------------------------------
-- 3. 공장 인지 읽기 정책
-- ---------------------------------------------------------------------------
-- 설비를 직접 참조하지 않는 테이블: 공장만 본다.
create policy "factory read product_models" on public.product_models
  for select to authenticated
  using (factory_id = (select public.current_user_factory()));

create policy "factory read model_processes" on public.model_processes
  for select to authenticated
  using (factory_id = (select public.current_user_factory()));

create policy "factory read machine_status_descriptions" on public.machine_status_descriptions
  for select to authenticated
  using (factory_id = (select public.current_user_factory()));

-- 설정. **이 정책이 브랜딩 누수를 닫는다** — 이전에는 술어가
-- `auth.role() = 'authenticated'` 라 ALV 사용자가 ALT 설정을 읽었고, 실제로 ALT 관리자
-- 화면에 ALV 회사명이 떴다(2026-08-21 브라우저 실측).
create policy "factory read system_settings" on public.system_settings
  for select to authenticated
  using (factory_id = (select public.current_user_factory()));

create policy "factory read system_settings_audit" on public.system_settings_audit
  for select to authenticated
  using (
    factory_id = (select public.current_user_factory())
    and (select public.current_user_factory_role()) in ('admin', 'engineer')
  );

-- 설비와 설비 종속 테이블: 공장 + (operator 는 담당 설비).
--
-- 술어 순서가 중요하다. factory_id 비교가 앞에 오면 factory 선두 index 가 먼저 걸러내고,
-- 비싼 배열 비교는 남은 행에만 적용된다.
create policy "factory read machines" on public.machines
  for select to authenticated
  using (
    factory_id = (select public.current_user_factory())
    and (
      (select public.current_user_factory_role()) in ('admin', 'engineer')
      or id in (select unnest((select public.current_factory_machine_ids())))
    )
  );

create policy "factory read machine_logs" on public.machine_logs
  for select to authenticated
  using (
    factory_id = (select public.current_user_factory())
    and (
      (select public.current_user_factory_role()) in ('admin', 'engineer')
      or machine_id in (select unnest((select public.current_factory_machine_ids())))
    )
  );

create policy "factory read machine_status_history" on public.machine_status_history
  for select to authenticated
  using (
    factory_id = (select public.current_user_factory())
    and (
      (select public.current_user_factory_role()) in ('admin', 'engineer')
      or machine_id in (select unnest((select public.current_factory_machine_ids())))
    )
  );

create policy "factory read downtime_entries" on public.downtime_entries
  for select to authenticated
  using (
    factory_id = (select public.current_user_factory())
    and (
      (select public.current_user_factory_role()) in ('admin', 'engineer')
      or machine_id in (select unnest((select public.current_factory_machine_ids())))
    )
  );

create policy "factory read production_records" on public.production_records
  for select to authenticated
  using (
    factory_id = (select public.current_user_factory())
    and (
      (select public.current_user_factory_role()) in ('admin', 'engineer')
      or machine_id in (select unnest((select public.current_factory_machine_ids())))
    )
  );

-- 정책이 하나도 없던 테이블들. 여기서 처음 실제 경계를 갖는다.
create policy "factory read production_shift_states" on public.production_shift_states
  for select to authenticated
  using (
    factory_id = (select public.current_user_factory())
    and (
      (select public.current_user_factory_role()) in ('admin', 'engineer')
      or machine_id in (select unnest((select public.current_factory_machine_ids())))
    )
  );

create policy "factory read production_progress_reports" on public.production_progress_reports
  for select to authenticated
  using (
    factory_id = (select public.current_user_factory())
    and (
      (select public.current_user_factory_role()) in ('admin', 'engineer')
      or machine_id in (select unnest((select public.current_factory_machine_ids())))
    )
  );

-- 알림 확인은 **본인 것만** 본다. 공장 안에서도 남의 확인 이력을 볼 이유가 없다.
create policy "factory read alert_acknowledgements" on public.alert_acknowledgements
  for select to authenticated
  using (
    factory_id = (select public.current_user_factory())
    and user_id = (select auth.uid())
  );

create policy "factory read audit_log" on public.audit_log
  for select to authenticated
  using (
    factory_id = (select public.current_user_factory())
    and (select public.current_user_factory_role()) = 'admin'
  );

-- ---------------------------------------------------------------------------
-- 4. 공장 인지 쓰기 정책
-- ---------------------------------------------------------------------------
-- 이 앱의 쓰기는 대부분 Service Role Route 와 RPC 를 거친다(계약 5.3/5.4). 브라우저에서
-- 직접 PostgREST 로 쓰는 경로는 열지 않는다 — 열면 서버의 검증(스냅샷 보존, 잠금 규약,
-- 진척 단조성)을 전부 우회할 수 있다.
--
-- 유일한 예외가 설비 상태 변경인데, 그것도 RPC 를 거치므로 여기서는 쓰기 정책을 만들지
-- 않는다. 정책이 없으면 authenticated 의 INSERT/UPDATE/DELETE 는 거부된다 — 그것이 의도다.
--
-- Service Role 은 RLS 를 우회하므로 이 결정이 서버 기능을 막지 않는다.

-- ---------------------------------------------------------------------------
-- 5. user_profiles — 글로벌 테이블
-- ---------------------------------------------------------------------------
-- 계약 4.1: user_profiles 는 글로벌이지만 "기본적으로 본인만 읽고 수정하며, 공장 관리자의
-- 사용자 목록은 같은 factory membership 으로 제한된 서버 API 를 통해서만 제공한다."
create policy "self read user_profiles" on public.user_profiles
  for select to authenticated
  using (user_id = (select auth.uid()));

-- 같은 공장의 관리자는 그 공장 구성원의 프로필을 읽는다. 전 프로젝트 사용자가 아니다.
create policy "factory admin read member profiles" on public.user_profiles
  for select to authenticated
  using (
    (select public.current_user_factory_role()) in ('admin', 'engineer')
    and exists (
      select 1 from public.factory_memberships fm
      where fm.user_id = public.user_profiles.user_id
        and fm.factory_id = (select public.current_user_factory())
        and fm.is_active
    )
  );

-- ---------------------------------------------------------------------------
-- 6. 공장 핵심 테이블
-- ---------------------------------------------------------------------------
-- 자기 membership 과 자기 공장만 본다. 남의 배정을 읽을 이유가 없다.
create policy "self read factory_memberships" on public.factory_memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "self read user_machine_assignments" on public.user_machine_assignments
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "read own factory" on public.factories
  for select to authenticated
  using (id = (select public.current_user_factory()));

-- 도메인은 로그인 전 브랜딩에 쓰이지만 그 경로는 서버(Service Role)가 처리한다.
-- authenticated 에게는 자기 공장 도메인만 보인다.
create policy "read own factory domains" on public.factory_domains
  for select to authenticated
  using (factory_id = (select public.current_user_factory()));

-- global_admins 에는 정책을 만들지 않는다 = deny-all. 전역 권한자 명단은 일반 사용자가
-- 알아야 할 정보가 아니다.

commit;
