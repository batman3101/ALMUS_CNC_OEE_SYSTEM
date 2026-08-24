-- 전역 관리자의 기본 공장
--
-- 운영 결정 2026-08-24:
--   2. 시스템 관리자는 ALT/ALV 를 모두 관리한다.
--   3. 프론트엔드에 공장 전환 토글은 두지 않는다.
--
-- 이 둘이 함께 있으면 문제가 하나 생긴다. 양쪽 membership 을 가진 사용자가 host 로 공장을
-- 특정하지 못하면 들어갈 공장이 정해지지 않는다. 계약 1절은 그 상황을 fail-closed 로
-- 규정한다 — "2개 이상이면 승인된 공장 선택 UX 가 없을 경우 구성 오류로 fail-closed".
--
-- 토글을 만들지 않기로 했으므로, 남은 정답은 **사람이 미리 적어 두는 기본 공장**이다.
-- 그러면 임의 선택이 아니게 된다: 관리자는 자기가 어느 공장에 쓰고 있는지 항상 안다.
--
-- ## host 를 덮지 않는다
--
-- 기본 공장은 host 가 **해석되지 않았을 때만** 쓰인다. `alv.<domain>` 으로 들어가면 ALV 가
-- 되고, 기본 공장이 ALT 여도 그 host 를 이긴다. 그래야 도메인이 실제 전환 수단이 된다.
--
-- ## 왜 user_profiles 가 아니라 global_admins 인가
--
-- 이 값은 **전역 권한을 가진 사용자에게만** 의미가 있다. 일반 사용자는 membership 이 하나라
-- 기본 공장이라는 개념 자체가 없다. `user_profiles` 에 두면 모든 사용자가 갖게 되고,
-- 그 컬럼이 채워진 일반 사용자를 보면 다음 사람은 그것이 권한인지 선호인지 알 수 없다.
--
-- ## 계약 1절과의 관계
--
-- 계약은 "기존 ALT 관리자를 **자동으로** Global Admin 으로 승격하지 않는다"고 금지한다.
-- 이 마이그레이션은 컬럼만 만들고 **행은 넣지 않는다.** 실제 등록은 사람이 명시적으로
-- 하는 별도 작업이며, 그 자체가 계약이 요구하는 사람 결정이다.

begin;

alter table public.global_admins
  add column if not exists home_factory_id uuid;

alter table public.global_admins
  drop constraint if exists global_admins_home_factory_fkey;
alter table public.global_admins
  add constraint global_admins_home_factory_fkey
  foreign key (home_factory_id) references public.factories(id)
  on delete set null;

comment on column public.global_admins.home_factory_id is
  'host 로 공장을 특정할 수 없을 때 진입할 기본 공장. host 가 해석되면 host 가 이긴다.';

-- 기본 공장은 그 사용자가 실제로 소속된 공장이어야 한다.
--
-- DB 제약으로는 걸 수 없다 — membership 은 (factory_id, user_id) 이고 여기 필요한 검사는
-- "이 조합이 존재하는가"라 복합 FK 로 표현되지 않는다(global_admins 의 PK 는 user_id 뿐).
-- 그래서 트리거로 검사한다. 소속되지 않은 공장을 기본값으로 적어 두면, 그 관리자는 로그인
-- 할 때마다 조용히 거부당하고 이유를 알 수 없다.
create or replace function public.validate_home_factory_membership()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.home_factory_id is null then
    return new;
  end if;

  if not exists (
    select 1 from public.factory_memberships fm
    where fm.user_id = new.user_id
      and fm.factory_id = new.home_factory_id
      and fm.is_active
  ) then
    raise exception '기본 공장은 해당 사용자의 활성 membership 이어야 합니다 (user=%, factory=%)',
      new.user_id, new.home_factory_id
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_home_factory_membership() from public, anon;
grant execute on function public.validate_home_factory_membership() to service_role;

drop trigger if exists validate_home_factory_before_write on public.global_admins;
create trigger validate_home_factory_before_write
  before insert or update of home_factory_id on public.global_admins
  for each row execute function public.validate_home_factory_membership();

commit;
