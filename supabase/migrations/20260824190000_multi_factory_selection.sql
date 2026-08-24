-- 공장 선택을 쿠키에서 DB 로 — Route 와 RLS 가 같은 것을 읽게 한다
--
-- ## 무엇이 깨져 있었나 (2026-08-24 브랜치 브라우저 검증에서 발견)
--
-- 선택은 쿠키(`almus_factory`)에 있었다. 그 쿠키는 요청 헤더로 오므로 **Route 는 읽고 RLS 는
-- 읽지 못한다.** DB 안에서 도는 정책은 요청에 무엇이 실렸는지 알 방법이 없다.
--
-- 그 결과 다중 소속 사용자의 화면이 두 공장을 섞었다:
--
--   쿠키 ALV -> Route(Service Role)      -> 설비 350대   (ALV)
--   쿠키 ALV -> 브라우저 직접 조회(RLS)  -> 교대 08:00   (ALT)
--
-- 배지는 ALV 를 가리키는데 교대 설정은 ALT 값이었다. 실측이다.
--
-- 소속이 하나인 사용자는 영향이 없다 — `current_user_factory()` 가 그 하나로 확정되기
-- 때문이다. 영향받는 것은 정확히 **양쪽을 오가는 사람**, 즉 이 기능을 실제로 쓰는 사람이다.
--
-- ## 해법: 선택을 두 층이 함께 읽는 자리에 둔다
--
-- 쿠키를 고쳐서 RLS 에 전달할 방법은 없다. JWT 커스텀 클레임에 넣는 길도 있지만 전환마다
-- 토큰을 새로 받아야 하고, 그 사이 두 값이 어긋나는 창이 다시 생긴다.
--
-- 대신 선택을 **행 하나**로 만든다. Route 는 그 행을 읽고, `current_user_factory()` 도 그
-- 행을 읽는다. 같은 것을 읽으면 어긋날 수 없다 — 이것이 이 마이그레이션의 전부다.
--
-- ## 왜 global_admins 에 넣지 않는가
--
-- `home_factory_id` 는 "기본값"이고 이것은 "지금 보고 있는 곳"이다. 뜻이 다르므로 컬럼을
-- 겸용하면 안 된다 — 기본값을 바꾸려던 사람이 현재 위치를 바꾸게 된다.
--
-- 그리고 다중 소속이 반드시 global admin 인 것도 아니다. 선택은 **소속이 둘 이상인 모든
-- 사용자**의 문제이므로 별도 테이블에 둔다.

begin;

create table if not exists public.user_factory_selection (
  user_id uuid primary key references auth.users(id) on delete cascade,
  factory_id uuid not null references public.factories(id),
  updated_at timestamptz not null default now()
);

comment on table public.user_factory_selection is
  '사용자가 UI 에서 고른 현재 공장. Route(requireFactoryUser)와 RLS(current_user_factory)가 함께 읽는 유일한 선택 출처.';

/**
 * 선택은 **소속 안에서만** 유효하다.
 *
 * 행이 남아 있어도 그 공장의 membership 이 사라지면 그 선택은 무효다. 입력 시점에 막는
 * 트리거를 두되, 읽는 쪽(`current_user_factory`)에서도 다시 확인한다 — membership 은
 * 선택을 저장한 **뒤에** 비활성화될 수 있고, 그때 이 행은 조용히 낡는다.
 */
create or replace function public.assert_selection_is_member()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (
    select 1 from public.factory_memberships fm
    where fm.user_id = new.user_id
      and fm.factory_id = new.factory_id
      and fm.is_active
  ) then
    raise exception 'selected factory is not an active membership'
      using errcode = '23514';
  end if;
  return new;
end $$;

drop trigger if exists trg_user_factory_selection_member on public.user_factory_selection;
create trigger trg_user_factory_selection_member
  before insert or update on public.user_factory_selection
  for each row execute function public.assert_selection_is_member();

-- ── RLS ──────────────────────────────────────────────────────────────────────
-- 자기 선택만 읽는다. 쓰기는 Route(service_role)만 한다 — 브라우저가 직접 쓰면
-- membership 검증을 우회할 길을 찾게 되고, 그 검증이 이 값의 유일한 안전장치다.
alter table public.user_factory_selection enable row level security;

drop policy if exists "self read factory selection" on public.user_factory_selection;
create policy "self read factory selection" on public.user_factory_selection
  for select to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.user_factory_selection from public, anon;
grant select on public.user_factory_selection to authenticated;
grant all on public.user_factory_selection to service_role;

-- ── current_user_factory: 선택을 최우선으로 ──────────────────────────────────
--
-- 순서는 `requireFactoryUser` 와 **글자 그대로 같아야 한다**. 두 층의 순서가 다르면
-- 이 마이그레이션이 없애려는 그 불일치가 다른 모양으로 되살아난다.
--
--   1. 선택 (활성 membership 안에 있을 때만)
--   2. 활성 membership 이 하나면 그것
--   3. 명시적 기본 공장(global_admins.home_factory_id)
--   4. 그 외 NULL — NULL 은 어떤 행과도 매치되지 않으므로 fail-closed 다
create or replace function public.current_user_factory()
returns uuid
language sql
stable security definer
set search_path = public, pg_temp
as $function$
  with active as (
    select fm.factory_id
    from public.factory_memberships fm
    join public.factories f on f.id = fm.factory_id
    join public.user_profiles up on up.user_id = fm.user_id
    where fm.user_id = (select auth.uid())
      and fm.is_active
      and f.is_active
      and coalesce(up.is_active, false)
  ),
  chosen as (
    -- 저장된 선택. 활성 membership 밖이면 무효다(트리거가 입력을 막지만, membership 은
    -- 나중에 비활성화될 수 있으므로 읽는 쪽에서도 확인한다).
    select s.factory_id
    from public.user_factory_selection s
    where s.user_id = (select auth.uid())
      and s.factory_id in (select factory_id from active)
  ),
  home as (
    select ga.home_factory_id as factory_id
    from public.global_admins ga
    where ga.user_id = (select auth.uid())
      and ga.is_active
      and (ga.expires_at is null or ga.expires_at > now())
      and ga.home_factory_id in (select factory_id from active)
  )
  select coalesce(
    (select factory_id from chosen limit 1),
    case
      when (select count(*) from active) = 1 then (select factory_id from active)
      else (select factory_id from home limit 1)
    end
  )
$function$;

revoke all on function public.current_user_factory() from public, anon;
grant execute on function public.current_user_factory() to authenticated, service_role;

revoke all on function public.assert_selection_is_member() from public, anon, authenticated;

commit;
