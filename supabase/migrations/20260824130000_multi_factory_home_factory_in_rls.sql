-- current_user_factory() 가 기본 공장을 인정하도록 맞춘다
--
-- ## 왜 필요한가 — 두 층의 판정이 어긋났다
--
-- `20260824100000` 이 다중 소속 관리자를 위해 `global_admins.home_factory_id` 를 도입하고
-- 서버 계약(`requireFactoryUser`)이 그것을 쓰도록 했다. 그런데 **RLS helper 는 그대로였다.**
--
-- `current_user_factory()` 는 활성 membership 이 정확히 하나일 때만 값을 준다. 양쪽 공장을
-- 관리하는 시스템 관리자는 membership 이 둘이라 **NULL** 을 받고, `factory_id = NULL` 은
-- 어떤 행과도 매치되지 않으므로 RLS 로 읽는 것이 전부 0건이 된다.
--
-- 실측(2026-08-24, 로컬 브라우저): 양쪽 소속 관리자로 로그인하면
--
--   RLS 경로 system_settings  -> 0건
--   서버 API  /api/system-settings -> {}
--   화면      -> 캐시에 남아 있던 다른 공장 이름이 그려짐
--
-- 서버는 ALT 로 판정하는데 DB 는 "공장 없음"으로 판정한다. 그 틈이 곧 결함이다.
--
-- ## 고치는 방향
--
-- 서버가 쓰는 규칙을 DB 에도 그대로 옮긴다:
--
--   1. 활성 membership 이 정확히 하나 -> 그 공장
--   2. 여럿이면 `global_admins.home_factory_id` (그 공장의 활성 membership 이 있을 때만)
--   3. 그 외 -> NULL (fail-closed)
--
-- 2번이 열어 주는 것은 **명시적으로 적어 둔 하나의 공장**뿐이다. "여럿이니 아무거나"가
-- 아니므로 계약 1절의 fail-closed 정신은 유지된다.
--
-- ## host 와의 관계
--
-- DB 는 host 를 모른다. 그래서 `alv.<domain>` 으로 들어간 관리자의 RLS 는 여전히 기본
-- 공장(ALT)을 본다 — 서버 Route(service_role, RLS 우회)는 ALV 를 보는데 브라우저 직접
-- 조회는 ALT 를 보는 어긋남이 남는다.
--
-- 이 앱에서는 실질 위험이 낮다. 브라우저가 PostgREST 를 직접 읽는 경로는 설정과 Realtime
-- 스냅샷 정도이고, 쓰기는 전부 서버를 거친다(cutover 마이그레이션이 쓰기 정책을 만들지
-- 않은 이유와 같다). 그래도 **완전한 해결은 아니며**, 최종적으로는 요청 컨텍스트의 공장을
-- DB 에 전달하는 방법(예: `set_config` 기반 세션 변수)이 필요하다. 그것은 별도 작업으로
-- 남긴다 — 지금 도입하면 모든 서버 경로가 트랜잭션마다 그 값을 심어야 하고, 하나라도
-- 빠뜨리면 조용히 잘못된 공장을 읽는다.

begin;

create or replace function public.current_user_factory()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
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
  home as (
    -- 기본 공장은 **활성 membership 안에서만** 유효하다. global_admins 에 적혀 있어도
    -- 그 공장 소속이 아니면 무효다 — 트리거가 입력 시점에 막지만, 나중에 membership 이
    -- 비활성화될 수 있으므로 읽는 쪽에서도 확인한다.
    select ga.home_factory_id as factory_id
    from public.global_admins ga
    where ga.user_id = (select auth.uid())
      and ga.is_active
      and (ga.expires_at is null or ga.expires_at > now())
      and ga.home_factory_id in (select factory_id from active)
  )
  select case
    -- 하나뿐이면 모호함이 없다.
    when (select count(*) from active) = 1 then (select factory_id from active)
    -- 여럿이면 명시적 기본 공장만 인정한다. 없으면 아래 else 로 떨어져 NULL 이다.
    else (select factory_id from home limit 1)
  end
$$;

comment on function public.current_user_factory() is
  '현재 사용자의 공장. membership 이 하나면 그 공장, 여럿이면 global_admins.home_factory_id, '
  '그 외 NULL(fail-closed). 서버 requireFactoryUser 와 같은 규칙이다.';

commit;
