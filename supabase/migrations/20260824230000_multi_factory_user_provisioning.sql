-- 사용자 관리가 인가에 실제로 반영되게 한다
--
-- ## 무엇이 깨져 있었나 (2026-08-24 병합 전 재점검에서 발견)
--
-- 다중화는 인가의 출처를 바꿨다:
--
--   역할       user_profiles.role          ->  factory_memberships.role
--   담당 설비  user_profiles.assigned_machines -> user_machine_assignments
--
-- 그런데 **사용자 관리 화면은 옛 출처에만 쓴다.** 새 출처를 채운 것은 20260824110000 의
-- 일회성 백필뿐이고, 그 뒤로 둘을 잇는 것이 아무것도 없다. 결과:
--
--   1. **신규 사용자가 앱을 못 쓴다.** 프로필만 생기고 membership 이 없다.
--      `requireFactoryUser` 는 403, RLS 의 `current_user_factory()` 는 NULL 을 낸다.
--      로그인은 되므로, 사용자는 "로그인은 되는데 화면이 텅 빈" 상태를 보고 원인을 모른다.
--   2. **역할 변경이 무효다.** operator 를 engineer 로 올려도 membership 의 role 은
--      백필 시점 값 그대로다. RLS 의 `has_factory_role()` 과 Route 의 `requireFactoryUser`
--      둘 다 그 값을 본다.
--   3. **담당 설비 변경이 무효다.** 화면은 "저장됐습니다"를 띄우고 아무 일도 하지 않는다.
--
-- 셋 다 공장이 ALT 하나뿐이어도 발생한다. 병합 창(window) 문제가 아니라 영구 결함이다.
--
-- ## 왜 코드가 아니라 트리거로 잇는가 (2, 3번)
--
-- 역할과 담당 설비는 **user_profiles 만 보고도 어디에 반영할지 알 수 있다**:
--
--   - 역할: 그 사용자의 **기존 membership 전부**에 같은 역할을 적는다.
--   - 담당 설비: 설비 id 가 곧 공장을 말해 준다(`machines.factory_id`).
--
-- 알 수 있는 것을 코드가 매번 다시 적으면, 적기를 빠뜨릴 기회가 생긴다. 실제로 그렇게
-- 빠뜨려서 여기까지 왔다. 20260824210000 이 12개 RPC 대신 유도 트리거를 택한 것과 같은
-- 판단이다.
--
-- ## 왜 1번만 코드가 필요한가
--
-- 신규 사용자의 **공장은 user_profiles 안에 없다.** 그 답을 아는 것은 "지금 어느 공장에서
-- 사용자를 만들고 있는가"뿐이고, 그것은 요청을 보낸 관리자만 안다. 그래서 이것만 Route 가
-- 넘겨줘야 하고, 아래 `create_factory_user` 가 프로필과 membership 을 한 트랜잭션으로 묶는다.
--
-- ## 역할은 사람당 하나다 (2026-08-24 결정)
--
-- 구조상 "ALT 에서는 관리자, ALV 에서는 작업자"도 표현할 수 있지만, 지금은 쓰지 않는다.
-- `user_profiles.role` 이 권위이고 membership 은 그것을 **비춘다**. 나중에 공장별 역할이
-- 필요해지면 아래 `sync_membership_role_from_profile` 트리거를 떼고 화면에 입력란을 더하면
-- 된다 — 데이터 구조는 이미 그것을 담을 수 있다.

begin;

-- 20260821100000 의 주석은 membership 이 `user_profiles.role` 을 "대체한다"고 적었다.
-- 위 결정에 따라 그것은 사실이 아니다 — 대체가 아니라 **반영**이다.
comment on table public.factory_memberships is
  '사용자의 공장별 역할. 인가는 이 값을 읽는다. 다만 2026-08-24 결정에 따라 역할은 '
  '사람당 하나이며 user_profiles.role 을 트리거가 여기에 비춘다(공장별로 다른 역할은 '
  '구조상 가능하지만 현재 쓰지 않는다).';

-- ---------------------------------------------------------------------------
-- 1. 역할 동기화
-- ---------------------------------------------------------------------------
-- `is_active` 는 일부러 동기화하지 않는다. 계정 비활성화는 RLS 의 `current_user_is_active()`
-- 와 Route 의 `requireFactoryUser` 가 **이미 `user_profiles.is_active` 를 직접 본다.**
-- 여기서 membership.is_active 까지 덮으면, 어느 공장에서 일부러 제외한 사람이 프로필을
-- 한 번 저장하는 것만으로 되살아난다.
create or replace function public.sync_membership_role_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.role is distinct from old.role then
    update public.factory_memberships
       set role = new.role,
           updated_at = now()
     where user_id = new.user_id;
  end if;
  return null;
end $$;

comment on function public.sync_membership_role_from_profile() is
  'user_profiles.role 변경을 그 사용자의 모든 membership 에 반영한다. 역할은 사람당 하나다.';

drop trigger if exists trg_user_profiles_sync_membership_role on public.user_profiles;
create trigger trg_user_profiles_sync_membership_role
  after update of role on public.user_profiles
  for each row execute function public.sync_membership_role_from_profile();

-- ---------------------------------------------------------------------------
-- 2. 담당 설비 동기화
-- ---------------------------------------------------------------------------
create or replace function public.sync_assignments_from_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ids uuid[];
  v_outside text;
begin
  -- `assigned_machines` 는 text[] 라 참조 무결성이 없다. uuid 가 아닌 문자열이 섞여 있어도
  -- 프로필 저장 전체를 실패시키지 않는다 — 형식이 맞는 것만 취한다.
  select coalesce(array_agg(a.t::uuid), '{}'::uuid[])
    into v_ids
  from unnest(coalesce(new.assigned_machines, '{}')) as a(t)
  where a.t ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

  -- 배열에서 빠진 배정은 지운다. 이것이 없으면 담당 설비를 **줄일** 수 없다.
  delete from public.user_machine_assignments uma
   where uma.user_id = new.user_id
     and not (uma.machine_id = any(v_ids));

  -- 소속되지 않은 공장의 설비는 조용히 버리지 않는다.
  --
  -- `user_machine_assignments` 는 (factory_id, user_id) 로 membership 을 참조하므로 그대로
  -- 넣으면 FK 위반이 나는데, 그 메시지는 관리자에게 아무것도 알려주지 않는다. 여기서 막으면
  -- 어느 설비가 문제인지 이름으로 나온다.
  --
  -- 실재하지 않는 설비 id 는 여기서 걸리지 않고 아래 join 에서 조용히 빠진다 — 이미 사라진
  -- 설비를 두고 관리자가 할 수 있는 일이 없기 때문이다(20260824110000 백필과 같은 규칙).
  select string_agg(m.name, ', ' order by m.name)
    into v_outside
  from public.machines m
  where m.id = any(v_ids)
    and not exists (
      select 1 from public.factory_memberships fm
      where fm.user_id = new.user_id
        and fm.factory_id = m.factory_id
        and fm.is_active
    );

  if v_outside is not null then
    raise exception using
      message = format('이 사용자가 소속되지 않은 공장의 설비는 배정할 수 없습니다: %s', v_outside),
      hint    = '먼저 해당 공장의 구성원으로 추가해야 합니다.',
      errcode = '23503';
  end if;

  insert into public.user_machine_assignments (factory_id, user_id, machine_id, is_active)
  select m.factory_id, new.user_id, m.id, true
  from public.machines m
  where m.id = any(v_ids)
  on conflict (factory_id, user_id, machine_id) do update set is_active = true;

  return null;
end $$;

comment on function public.sync_assignments_from_profile() is
  'user_profiles.assigned_machines 를 user_machine_assignments 로 반영한다. 공장은 설비가 '
  '결정하므로 짐작이 아니라 조회다.';

drop trigger if exists trg_user_profiles_sync_assignments on public.user_profiles;
create trigger trg_user_profiles_sync_assignments
  after insert or update of assigned_machines on public.user_profiles
  for each row execute function public.sync_assignments_from_profile();

-- ---------------------------------------------------------------------------
-- 3. 신규 사용자 프로비저닝
-- ---------------------------------------------------------------------------
-- membership 을 **먼저** 넣는다. `user_machine_assignments` 가 (factory_id, user_id) 로
-- membership 을 참조하므로, 프로필 INSERT 가 담당 설비 트리거를 깨우는 시점에는 membership
-- 이 이미 있어야 한다.
create or replace function public.create_factory_user(
  p_factory_id        uuid,
  p_user_id           uuid,
  p_name              text,
  p_email             text,
  p_role              text,
  p_assigned_machines text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.factory_memberships (factory_id, user_id, role, is_active)
  values (p_factory_id, p_user_id, p_role, true)
  on conflict (factory_id, user_id)
    do update set role = excluded.role, is_active = true, updated_at = now();

  insert into public.user_profiles (user_id, name, email, role, assigned_machines)
  values (p_user_id, p_name, p_email, p_role, coalesce(p_assigned_machines, '{}'));
end $$;

comment on function public.create_factory_user(uuid, uuid, text, text, text, text[]) is
  '프로필과 공장 membership 을 한 트랜잭션으로 만든다. 둘 중 하나만 생기면 그 사용자는 '
  '로그인은 되는데 아무것도 보이지 않는 상태가 된다.';

revoke all on function public.sync_membership_role_from_profile() from public, anon, authenticated;
revoke all on function public.sync_assignments_from_profile() from public, anon, authenticated;
revoke all on function public.create_factory_user(uuid, uuid, text, text, text, text[])
  from public, anon, authenticated;
grant execute on function public.create_factory_user(uuid, uuid, text, text, text, text[])
  to service_role;

-- ---------------------------------------------------------------------------
-- 자체 확인 — 트리거는 이름만 맞고 아무것도 안 할 수 있다
-- ---------------------------------------------------------------------------
-- 실제 사용자 한 명을 왕복시킨다. 그런데 "왕복시켰으니 원상복구"는 **자기가 직접 쓴 것만**
-- 세는 생각이고, 트리거가 있는 테이블에서는 언제나 틀린다:
--
--   - `user_profiles` 에는 `update_user_profiles_updated_at` 이 붙어 있다 → 되돌려도
--     `updated_at` 은 지금 시각으로 남는다. 아무도 손대지 않은 계정이 "방금 수정됨"이 된다.
--   - 담당 설비를 왕복시키면 `user_machine_assignments` 행이 지워졌다 다시 생기므로
--     `created_at` 이 바뀐다.
--
-- 그래서 하위 트랜잭션 안에서 돌리고 통째로 되감는다. plpgsql 의 `begin … exception … end`
-- 는 하위 트랜잭션이라, 그 안에서 예외를 던지면 직접 쓴 행도 트리거가 쓴 행도 함께
-- 되감긴다. 변수는 되감기지 않으므로 판정만 밖으로 가지고 나온다.
--
-- 같은 함정이 20260824210000 에서 실제로 터졌다(생산기록을 넣었다 지우면 교대 상태에
-- `MISSING` 유령 행이 남는다). 여기서도 같은 방식으로 막는다.
do $$
declare
  v_user     uuid;
  v_factory  uuid;
  v_role     text;
  v_other    text;
  v_got      text;
  v_machine  uuid;
  v_before   text[];
  v_count    bigint;
  v_passed   boolean := false;
  v_failure  text;
begin
  select fm.user_id, fm.factory_id, up.role
    into v_user, v_factory, v_role
  from public.factory_memberships fm
  join public.user_profiles up on up.user_id = fm.user_id
  where fm.is_active
  limit 1;

  if v_user is null then
    raise notice 'SKIP: membership 을 가진 사용자가 없어 동기화를 확인할 수 없다';
    return;
  end if;

  select id into v_machine from public.machines where factory_id = v_factory limit 1;
  select assigned_machines into v_before from public.user_profiles where user_id = v_user;

  begin
    -- (1) 역할 동기화
    v_other := case when v_role = 'operator' then 'engineer' else 'operator' end;

    update public.user_profiles set role = v_other where user_id = v_user;
    select role into v_got from public.factory_memberships
     where user_id = v_user and factory_id = v_factory;
    if v_got is distinct from v_other then
      v_failure := format('역할 동기화 실패: membership 이 %s 인데 프로필은 %s', v_got, v_other);
      raise exception 'SELFTEST_ROLLBACK';
    end if;

    -- (2) 담당 설비 동기화
    if v_machine is null then
      v_passed := true;   -- 역할은 확인됐다. 설비가 없으면 그 부분만 건너뛴다.
      raise exception 'SELFTEST_ROLLBACK';
    end if;

    update public.user_profiles
       set assigned_machines = array[v_machine::text]
     where user_id = v_user;

    select count(*) into v_count from public.user_machine_assignments
     where user_id = v_user and machine_id = v_machine and factory_id = v_factory and is_active;
    if v_count <> 1 then
      v_failure := format('담당 설비 동기화 실패: 배정 행이 %s 개다 (기대 1)', v_count);
      raise exception 'SELFTEST_ROLLBACK';
    end if;

    -- 줄이는 방향도 확인한다. 늘리기만 되고 줄이기가 안 되면, 담당에서 뺀 설비를 계속 본다.
    update public.user_profiles set assigned_machines = '{}' where user_id = v_user;
    select count(*) into v_count from public.user_machine_assignments where user_id = v_user;
    if v_count <> 0 then
      v_failure := format('담당 설비 축소 실패: 배정 행이 %s 개 남았다', v_count);
      raise exception 'SELFTEST_ROLLBACK';
    end if;

    v_passed := true;
    raise exception 'SELFTEST_ROLLBACK';
  exception when others then
    if sqlerrm <> 'SELFTEST_ROLLBACK' then
      v_failure := sqlerrm;
      v_passed := false;
    end if;
  end;

  if not v_passed then
    raise exception '사용자 동기화 확인 실패: %', coalesce(v_failure, '(원인 불명)');
  end if;

  if v_machine is null then
    raise notice 'PASS: 역할 변경이 membership 에 반영된다 (설비가 없어 담당 설비는 건너뜀)';
  else
    raise notice 'PASS: 역할·담당 설비 변경이 반영된다 (늘리기·줄이기 모두, 흔적 없음)';
  end if;
end $$;

commit;
