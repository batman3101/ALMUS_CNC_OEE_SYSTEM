-- ALT/ALV 멀티테넌시 P1-2: 글로벌 테이블 신설
--
-- 계약: docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.md 4.1 / 4.3
-- 인벤토리: docs/workflows/D1_D2_INVENTORY_LEDGER.md (2026-08-21 실측)
--
-- ## 이 마이그레이션이 하는 일
--
-- 공장이라는 개념을 시스템에 처음 도입한다. 현재 이 DB 에는 `factory_id` 컬럼이 0개,
-- 공장을 참조하는 정책이 0개, 공장 인자를 받는 함수가 0개다. 즉 이것은 필터를 더하는
-- 작업이 아니라 **경계를 새로 만드는** 작업이다.
--
-- ## 이 마이그레이션이 하지 않는 일
--
-- 기존 테이블을 건드리지 않는다(그것은 expand 마이그레이션이 한다). 정책도 만들지 않는다
-- (그것은 cutover 가 한다). 데이터도 넣지 않는다 — ALT/ALV 의 실제 code·hostname·membership
-- 은 D3 미확정이며, 계약 1절이 추측을 금지한다.
--
-- 여기서 만드는 것은 **비어 있는 골격**이다. 골격이 먼저 서 있어야 backfill 이 부모→자식
-- 순서를 지킬 수 있다.

begin;

-- ---------------------------------------------------------------------------
-- factories
-- ---------------------------------------------------------------------------
-- timezone 과 default_language 가 여기 있는 이유: 집계의 business date 가 공장마다 다르게
-- 잘려야 하기 때문이다. 현재는 system_settings 의 general.timezone 하나가 전역으로 쓰이는데
-- (실측값 Asia/Ho_Chi_Minh), 공장이 둘이 되는 순간 그 값은 "어느 공장의 시간인가"라는
-- 질문에 답할 수 없게 된다.
create table if not exists public.factories (
  id              uuid primary key default gen_random_uuid(),
  code            text not null,
  name            text not null,
  timezone        text not null,
  default_language text not null default 'vi',
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint factories_code_key unique (code),
  -- code 는 Storage 경로(factories/{code}/...)와 로그 식별자에 그대로 쓰인다.
  -- 경로에 들어가므로 슬래시·공백·대소문자 혼용을 애초에 막는다.
  constraint factories_code_format check (code ~ '^[A-Z][A-Z0-9_]{1,15}$'),
  -- 빈 문자열 timezone 은 "설정되지 않음"을 조용히 통과시킨다. 그러면 집계가 UTC 로
  -- 떨어지고 아무도 눈치채지 못한다.
  constraint factories_timezone_not_blank check (length(btrim(timezone)) > 0),
  constraint factories_language_allowed check (default_language in ('ko', 'vi'))
);

comment on table public.factories is
  '공장(테넌트) 마스터. timezone 은 집계 business date 의 기준이며 공장마다 다를 수 있다.';

-- ---------------------------------------------------------------------------
-- factory_domains
-- ---------------------------------------------------------------------------
-- host 는 **공장 선택자일 뿐 보안 경계가 아니다**(계약 2번 절대조건). 그래도 이 테이블이
-- 필요한 이유는 로그인 **전** 브랜딩 때문이다 — 인증 전에는 membership 을 볼 수 없으므로
-- host 로만 최소 공개 metadata 를 고를 수 있다(계약 6.1).
create table if not exists public.factory_domains (
  factory_id uuid not null references public.factories(id) on delete cascade,
  hostname   text not null,
  is_primary boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),

  constraint factory_domains_pkey primary key (hostname),
  -- hostname 은 정규화된 소문자로만 저장한다. 대소문자가 섞이면 같은 호스트가 두 공장에
  -- 바인딩될 수 있고, 그것이 곧 잘못된 공장에 쓰기다.
  constraint factory_domains_hostname_lower check (hostname = lower(hostname)),
  constraint factory_domains_hostname_not_blank check (length(btrim(hostname)) > 0)
);

-- 공장당 primary 는 최대 하나. 부분 unique index 로 강제한다.
create unique index if not exists factory_domains_one_primary_per_factory
  on public.factory_domains (factory_id)
  where is_primary;

create index if not exists idx_factory_domains_factory
  on public.factory_domains (factory_id);

comment on table public.factory_domains is
  'hostname -> factory 해석표. 보안 경계가 아니라 선택자다. 최종 인가는 membership 과 RLS 가 한다.';

-- ---------------------------------------------------------------------------
-- factory_memberships
-- ---------------------------------------------------------------------------
-- 권한의 최종 원천. 기존 user_profiles.role 은 전역 역할이라 "ALT 의 admin"과 "ALV 의 admin"을
-- 구분할 수 없다. 계약 3번 절대조건이 이 테이블로의 전환을 요구한다.
create table if not exists public.factory_memberships (
  factory_id uuid not null references public.factories(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint factory_memberships_pkey primary key (factory_id, user_id),
  constraint factory_memberships_role_allowed check (role in ('admin', 'engineer', 'operator'))
);

-- membership 조회는 "이 사용자의 활성 공장이 몇 개인가"로 시작한다(계약 1절 기본 사용자 정책:
-- 0개면 403, 1개면 진입, 2개 이상이면 fail-closed). user_id 선두 index 가 그 질의를 받는다.
create index if not exists idx_factory_memberships_user_active
  on public.factory_memberships (user_id)
  where is_active;

comment on table public.factory_memberships is
  '사용자의 공장별 역할. 권한의 최종 원천이며 user_profiles.role 을 대체한다.';

-- ---------------------------------------------------------------------------
-- user_machine_assignments
-- ---------------------------------------------------------------------------
-- operator 의 담당 설비. 기존 user_profiles.assigned_machines 는 uuid 배열이라
-- 참조 무결성이 없다 — 삭제된 설비 id 가 배열에 남아도 DB 는 모른다. 정규화하면서
-- membership 과 machine 양쪽에 복합 FK 를 건다(계약 4.3).
--
-- machines 쪽 복합 FK 는 machines 에 factory_id 와 (factory_id, id) UNIQUE 가 생긴 뒤에야
-- 걸 수 있으므로 expand 마이그레이션에서 추가한다. 여기서는 membership 쪽만 건다.
create table if not exists public.user_machine_assignments (
  factory_id uuid not null,
  user_id    uuid not null,
  machine_id uuid not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),

  constraint user_machine_assignments_pkey primary key (factory_id, user_id, machine_id),
  -- membership 이 없는 사용자에게 설비를 배정할 수 없다. 이 FK 가 그것을 DB 수준에서 막는다.
  constraint user_machine_assignments_membership_fkey
    foreign key (factory_id, user_id)
    references public.factory_memberships(factory_id, user_id)
    on delete cascade
);

create index if not exists idx_user_machine_assignments_machine
  on public.user_machine_assignments (factory_id, machine_id);

comment on table public.user_machine_assignments is
  'operator 담당 설비. user_profiles.assigned_machines 배열을 대체하며 참조 무결성을 갖는다.';

-- ---------------------------------------------------------------------------
-- global_admins
-- ---------------------------------------------------------------------------
-- 계약 1절: "기존 ALT 관리자를 자동으로 Global Admin 으로 승격하지 않는다."
-- 그래서 이 테이블은 만들되 **비워 둔다**. 등록은 사람 결정(H1)이다.
--
-- expires_at 을 둔 이유: 전역 권한은 기본이 임시여야 한다. 영구 전역 권한은 사고가 났을 때
-- 범위를 좁힐 수단이 없다.
create table if not exists public.global_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  is_active  boolean not null default true,
  granted_by uuid references auth.users(id) on delete set null,
  reason     text,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.global_admins is
  '전 공장 접근 권한. 기본은 비어 있으며 자동 승격은 계약상 금지다. 모든 행위를 감사한다.';

-- ---------------------------------------------------------------------------
-- updated_at 유지
-- ---------------------------------------------------------------------------
-- 기존 트리거 함수를 재사용한다(handle_updated_at 는 이미 이 스키마에 있다).
drop trigger if exists set_factories_updated_at on public.factories;
create trigger set_factories_updated_at
  before update on public.factories
  for each row execute function public.handle_updated_at();

drop trigger if exists set_factory_memberships_updated_at on public.factory_memberships;
create trigger set_factory_memberships_updated_at
  before update on public.factory_memberships
  for each row execute function public.handle_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: 켜고 정책은 두지 않는다
-- ---------------------------------------------------------------------------
-- 정책 0 = deny-all 이다. 정책은 cutover 마이그레이션에서 helper 와 함께 **같은 트랜잭션**
-- 으로 만든다(계약 5.2: permissive 정책이 OR 로 남으면 격리가 무너진다).
--
-- 그 사이 기간에 이 테이블들이 잠겨 있는 것은 의도다. 열어 두고 나중에 좁히는 것보다
-- 닫아 두고 나중에 여는 쪽이 안전하다.
alter table public.factories                enable row level security;
alter table public.factory_domains          enable row level security;
alter table public.factory_memberships      enable row level security;
alter table public.user_machine_assignments enable row level security;
alter table public.global_admins            enable row level security;

-- ---------------------------------------------------------------------------
-- 권한 회수
-- ---------------------------------------------------------------------------
-- Supabase 는 새 객체에 PUBLIC/anon 권한을 되돌려 부여하는 경우가 있다(2026-07-29 실측).
-- 그래서 열거하지 않고 **전수 회수**한 뒤 필요한 것만 다시 준다.
revoke all on public.factories                from public, anon;
revoke all on public.factory_domains          from public, anon;
revoke all on public.factory_memberships      from public, anon;
revoke all on public.user_machine_assignments from public, anon;
revoke all on public.global_admins            from public, anon;

-- authenticated 는 RLS 를 통과하는 읽기만 갖는다. 쓰기는 서버(Service Role)와 승인된 RPC 만
-- 한다 — 사용자가 자기 membership 을 스스로 만들 수 있으면 그것은 권한 상승이다.
grant select on public.factories           to authenticated;
grant select on public.factory_domains     to authenticated;
grant select on public.factory_memberships to authenticated;
grant select on public.user_machine_assignments to authenticated;
-- global_admins 는 authenticated 에게 읽기조차 주지 않는다. 전역 권한자 명단은
-- 일반 사용자가 알아야 할 정보가 아니다.

commit;
