-- ALT/ALV 멀티테넌시 P1-6a: RLS helper
--
-- 계약: docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.md 5.2
--
-- ## 정책이 아니라 helper 만 만드는 이유
--
-- 계약 5.2 는 "기존 permissive 정책과 새 정책이 OR 로 합쳐지지 않도록 정책 교체를 **같은
-- 트랜잭션**에서 수행한다"고 요구한다. 그 교체는 backfill 이 끝난 뒤 cutover 마이그레이션이
-- 한 번에 해야 한다 — 지금 정책을 바꾸면 factory_id 가 아직 NULL 이라 모든 행이 잠긴다.
--
-- helper 는 정책보다 먼저 존재해도 안전하다. 아무도 부르지 않으면 아무 일도 일어나지 않는다.
--
-- ## 왜 STABLE + SECURITY DEFINER + 고정 search_path 인가
--
--   - STABLE: 한 문장 안에서 값이 변하지 않는다. Postgres 가 InitPlan 으로 한 번만 평가해
--     행마다 재실행하지 않는다. 800대 × 6만행 규모에서 이 차이는 크다.
--   - SECURITY DEFINER: helper 자신이 factory_memberships 를 읽어야 하는데, 그 테이블에도
--     RLS 가 걸려 있다. invoker 로 두면 정책이 자기 자신을 평가하려 들며 재귀한다.
--   - 고정 search_path: DEFINER 함수에서 search_path 를 열어 두면 호출자가 같은 이름의
--     테이블을 앞에 놓아 함수를 속일 수 있다.
--
-- ## 비활성은 언제나 false 다
--
-- 계약 5.2: "비활성 user/profile/factory/membership 은 항상 false 다."
-- 비활성 공장의 데이터를 비활성 사용자가 읽는 경로가 하나라도 열려 있으면, 공장을
-- 비활성화하는 것이 격리 수단이 되지 못한다(계약 9절의 ALV 장애 대응이 그것에 의존한다).

begin;

-- ---------------------------------------------------------------------------
-- current_user_is_active()
-- ---------------------------------------------------------------------------
-- 기존 정책들이 `user_profiles.is_active` 를 각자 EXISTS 로 확인하고 있었다. 하나로 모은다.
create or replace function public.current_user_is_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.user_profiles
    where user_id = (select auth.uid())
      and coalesce(is_active, false)
  )
$$;

comment on function public.current_user_is_active() is
  '로그인 사용자의 프로필이 활성인가. 비활성 계정은 어떤 공장 데이터도 볼 수 없다.';

-- ---------------------------------------------------------------------------
-- is_global_admin()
-- ---------------------------------------------------------------------------
-- 계약 1절: 기존 ALT 관리자를 자동 승격하지 않는다. 그래서 global_admins 는 비어 있고
-- 이 함수는 현재 항상 false 를 돌려준다 — 그것이 의도된 초기 상태다.
--
-- expires_at 을 여기서 검사한다. 만료된 전역 권한이 조용히 살아 있으면 감사가 무의미해진다.
create or replace function public.is_global_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.global_admins ga
    where ga.user_id = (select auth.uid())
      and ga.is_active
      and (ga.expires_at is null or ga.expires_at > now())
  ) and public.current_user_is_active()
$$;

comment on function public.is_global_admin() is
  '전 공장 접근 권한 보유 여부. 만료와 계정 활성까지 함께 검사한다.';

-- ---------------------------------------------------------------------------
-- has_factory_membership(p_factory_id)
-- ---------------------------------------------------------------------------
-- 공장이 비활성이면 membership 이 있어도 false 다. 공장 비활성화가 실제 차단 수단이어야
-- 하기 때문이다(계약 9절: "ALV 장애 시 ALV domain, membership, schedule 을 비활성화").
create or replace function public.has_factory_membership(p_factory_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.factory_memberships fm
    join public.factories f on f.id = fm.factory_id
    where fm.factory_id = p_factory_id
      and fm.user_id = (select auth.uid())
      and fm.is_active
      and f.is_active
  ) and public.current_user_is_active()
$$;

comment on function public.has_factory_membership(uuid) is
  '이 사용자가 해당 공장의 활성 구성원인가. 공장·membership·계정 셋 다 활성이어야 한다.';

-- ---------------------------------------------------------------------------
-- has_factory_role(p_factory_id, p_roles)
-- ---------------------------------------------------------------------------
-- admin/engineer 도 **해당 공장 안에서만** 그 역할이다(계약 1절).
-- user_profiles.role 은 보지 않는다 — 그것이 전역 역할이라 공장을 구분하지 못하는 것이
-- 이 전환의 출발점이다.
create or replace function public.has_factory_role(p_factory_id uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.factory_memberships fm
    join public.factories f on f.id = fm.factory_id
    where fm.factory_id = p_factory_id
      and fm.user_id = (select auth.uid())
      and fm.is_active
      and f.is_active
      and fm.role = any(p_roles)
  ) and public.current_user_is_active()
$$;

comment on function public.has_factory_role(uuid, text[]) is
  '해당 공장에서 주어진 역할 중 하나를 갖는가. 역할은 공장 안에서만 의미를 갖는다.';

-- ---------------------------------------------------------------------------
-- has_machine_access(p_factory_id, p_machine_id)
-- ---------------------------------------------------------------------------
-- operator 는 membership **과** assignment 를 모두 만족해야 한다(계약 5.2).
-- admin/engineer 는 공장 전체를 본다.
--
-- 기존 current_user_machines() 는 user_profiles.assigned_machines(text[]) 를 읽는다.
-- 그 배열에는 참조 무결성이 없어서 삭제된 설비 id 가 남아도 DB 가 모른다. 여기서는
-- 정규화된 user_machine_assignments 를 쓴다.
create or replace function public.has_machine_access(p_factory_id uuid, p_machine_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    case
      when public.has_factory_role(p_factory_id, array['admin', 'engineer']) then true
      when public.has_factory_membership(p_factory_id) then exists (
        select 1 from public.user_machine_assignments uma
        where uma.factory_id = p_factory_id
          and uma.user_id = (select auth.uid())
          and uma.machine_id = p_machine_id
          and uma.is_active
      )
      else false
    end
$$;

comment on function public.has_machine_access(uuid, uuid) is
  'operator 는 담당 설비만, admin/engineer 는 공장 전체. 공장 밖은 누구도 접근할 수 없다.';

-- ---------------------------------------------------------------------------
-- 권한
-- ---------------------------------------------------------------------------
-- Supabase 는 새 함수에 PUBLIC EXECUTE 를 되돌려 부여한다(2026-07-29 실측).
-- 열거하지 말고 전수 회수한 뒤 필요한 것만 준다.
revoke all on function public.current_user_is_active() from public, anon;
revoke all on function public.is_global_admin() from public, anon;
revoke all on function public.has_factory_membership(uuid) from public, anon;
revoke all on function public.has_factory_role(uuid, text[]) from public, anon;
revoke all on function public.has_machine_access(uuid, uuid) from public, anon;

grant execute on function public.current_user_is_active() to authenticated, service_role;
grant execute on function public.is_global_admin() to authenticated, service_role;
grant execute on function public.has_factory_membership(uuid) to authenticated, service_role;
grant execute on function public.has_factory_role(uuid, text[]) to authenticated, service_role;
grant execute on function public.has_machine_access(uuid, uuid) to authenticated, service_role;

commit;
