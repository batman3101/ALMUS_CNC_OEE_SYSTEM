-- 운영 스키마 baseline (2026-08-21 실측 추출)
--
-- ## 왜 이 파일이 필요한가
--
-- 이 저장소의 마이그레이션은 **빈 DB 에서 처음부터 적용되지 않았다.** 실측:
--
--   $ npx supabase start
--   Applying migration 20251116070000_create_system_settings_audit_table.sql...
--   ERROR: relation "public.system_settings" does not exist (SQLSTATE 42P01)
--
-- 핵심 테이블 15개 중 11개는 저장소에 `CREATE TABLE` 이 없다. 운영 DB 에만 존재했다.
-- AGENTS.md 가 "저장소만 보고 운영 스키마를 추정하지 말라"고 경고한 것의 실체다.
--
-- 결과적으로 두 가지가 불가능했다:
--
--   1. 로컬/격리 staging 재현 — 따라서 RLS·backfill 을 실제로 검증할 방법이 없었다.
--   2. 재해 복구 — 운영 DB 가 사라지면 스키마를 되살릴 원본이 어디에도 없었다.
--
-- 이 파일은 운영 DB 에서 추출한 **테이블·타입·제약**을 담아 그 구멍을 메운다.
--
-- ## 이 파일의 한계 (중요)
--
-- 여기 담긴 것은 테이블 골격뿐이다. 함수 38개·뷰 7개·정책 20개·트리거 11개는 뒤따르는
-- 58개 마이그레이션이 만든다. 그것들은 저장소에 이미 있고 시간순으로 적용되면 재현된다.
--
-- **이 파일은 운영에 적용하지 않는다.** 운영에는 이미 이 스키마가 존재한다. 모든 문장이
-- `IF NOT EXISTS` 이므로 실수로 적용해도 무해하지만, 의도는 로컬/격리 재현 전용이다.
-- 운영 migration 이력과 맞추려면 `supabase migration repair` 로 applied 처리해야 한다.
--
-- ## 추출 방법
--
-- `pg_catalog` 조회로 컬럼·기본값·제약을 재구성했다(pg_dump 접근이 없어서). 따라서
-- 물리적 완전성(인덱스 이름, 통계, 확장)이 아니라 **논리적 동등성**을 목표로 한다.
-- 그것이 RLS·FK·backfill 검증에 필요한 전부다.

begin;

-- ---------------------------------------------------------------------------
-- 타입
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                 where n.nspname = 'public' and t.typname = 'machine_status') then
    create type public.machine_status as enum (
      'NORMAL_OPERATION', 'INSPECTION', 'BREAKDOWN_REPAIR', 'PM_MAINTENANCE',
      'MODEL_CHANGE', 'PLANNED_STOP', 'PROGRAM_CHANGE', 'TOOL_CHANGE', 'TEMPORARY_STOP'
    );
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 글로벌/마스터
-- ---------------------------------------------------------------------------
create table if not exists public.user_profiles (
  user_id           uuid primary key default gen_random_uuid(),
  name              text not null,
  role              text not null,
  assigned_machines text[],
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  email             varchar(255),
  is_active         boolean default true,
  language          text,
  theme_mode        text,
  constraint user_profiles_role_check check (role = any (array['admin','operator','engineer'])),
  constraint user_profiles_language_check check (language is null or language = any (array['ko','vi'])),
  constraint user_profiles_theme_mode_check check (theme_mode is null or theme_mode = any (array['light','dark']))
);

create table if not exists public.product_models (
  id          uuid primary key default gen_random_uuid(),
  model_name  text not null,
  description text,
  is_active   boolean default true,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  constraint product_models_model_name_key unique (model_name)
);

create table if not exists public.model_processes (
  id                uuid primary key default gen_random_uuid(),
  model_id          uuid not null references public.product_models(id) on delete cascade,
  process_name      text not null,
  process_order     integer not null,
  -- 주의: 이 값은 **1개당** 시간이다. cavity_count 로 나누지 말 것 (CLAUDE.md 참조).
  tact_time_seconds integer not null default 120,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now(),
  -- 참조 전용. OEE/CAPA 계산에 쓰면 성능이 정확히 1/cavity 로 왜곡된다.
  cavity_count      integer not null default 1,
  constraint cavity_count_positive check (cavity_count > 0),
  constraint model_processes_model_id_process_name_key unique (model_id, process_name),
  constraint model_processes_model_id_process_order_key unique (model_id, process_order)
);

create table if not exists public.machines (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  location            text,
  equipment_type      text,
  is_active           boolean not null default true,
  created_at          timestamptz default now(),
  updated_at          timestamptz default now(),
  current_state       public.machine_status not null default 'NORMAL_OPERATION',
  production_model_id uuid references public.product_models(id),
  current_process_id  uuid references public.model_processes(id),
  constraint machines_name_key unique (name)
);

create table if not exists public.machine_status_descriptions (
  status          public.machine_status primary key,
  description_ko  text not null,
  description_vi  text,
  description_en  text,
  display_order   integer not null,
  color_code      varchar(7),
  is_productive   boolean default false,
  requires_reason boolean default false
);

-- ---------------------------------------------------------------------------
-- 설정
-- ---------------------------------------------------------------------------
create table if not exists public.system_settings (
  id               uuid primary key default gen_random_uuid(),
  setting_key      text not null,
  setting_value    jsonb not null,
  default_value    jsonb not null,
  description      text,
  category         text not null default 'general',
  data_type        text not null default 'string',
  validation_rules jsonb,
  is_active        boolean default true,
  is_system        boolean default false,
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  created_by       uuid references auth.users(id),
  updated_by       uuid references auth.users(id),
  -- 전역 유일성. 멀티테넌시 전환에서 (factory_id, category, setting_key) 로 대체된다.
  constraint system_settings_setting_key_key unique (setting_key)
);

create table if not exists public.system_settings_audit (
  id            uuid primary key default gen_random_uuid(),
  setting_id    uuid not null references public.system_settings(id) on delete cascade,
  category      text not null,
  setting_key   text not null,
  old_value     jsonb,
  new_value     jsonb,
  action        text not null,
  change_reason text,
  changed_by    uuid references auth.users(id) on delete set null,
  changed_at    timestamptz not null default now(),
  constraint system_settings_audit_action_check check (action = any (array['CREATE','UPDATE','DELETE'])),
  constraint valid_action check (action = any (array['CREATE','UPDATE','DELETE']))
);

-- ---------------------------------------------------------------------------
-- 설비 상태 / 비가동
-- ---------------------------------------------------------------------------
create table if not exists public.machine_logs (
  log_id      uuid primary key default gen_random_uuid(),
  machine_id  uuid not null references public.machines(id) on delete cascade,
  state       text not null,
  start_time  timestamptz not null default now(),
  end_time    timestamptz,
  duration    integer,
  operator_id uuid references public.user_profiles(user_id),
  created_at  timestamptz default now(),
  constraint machine_logs_state_check check (state = any (array[
    'NORMAL_OPERATION','INSPECTION','BREAKDOWN_REPAIR','PM_MAINTENANCE',
    'MODEL_CHANGE','PLANNED_STOP','PROGRAM_CHANGE','TOOL_CHANGE','TEMPORARY_STOP'
  ]))
);

create table if not exists public.machine_status_history (
  id               uuid primary key default gen_random_uuid(),
  machine_id       uuid not null references public.machines(id) on delete cascade,
  previous_status  public.machine_status,
  new_status       public.machine_status not null,
  changed_by       uuid references auth.users(id),
  change_reason    text,
  duration_minutes integer,
  created_at       timestamptz default now()
);

create table if not exists public.downtime_entries (
  id               uuid primary key default gen_random_uuid(),
  machine_id       uuid not null references public.machines(id) on delete cascade,
  date             date not null,
  shift            text,
  start_time       timestamptz not null,
  end_time         timestamptz,
  duration_minutes integer,
  reason           text not null,
  description      text,
  operator_id      uuid references public.user_profiles(user_id),
  created_at       timestamptz default now(),
  updated_at       timestamptz not null default now(),
  -- 낙관적 동시성. 지문을 데이터보다 먼저 확인한다.
  version          bigint not null default 1,
  constraint downtime_entries_shift_check check (shift = any (array['A','B'])),
  constraint downtime_entries_version_positive check (version > 0)
);

-- ---------------------------------------------------------------------------
-- 생산
-- ---------------------------------------------------------------------------
create table if not exists public.production_records (
  record_id         uuid primary key default gen_random_uuid(),
  machine_id        uuid not null references public.machines(id) on delete cascade,
  date              date not null,
  shift             text,
  -- 시간 필드는 **분** 단위. tact_time_seconds 만 초 단위다.
  planned_runtime   integer default 480,
  actual_runtime    integer default 0,
  ideal_runtime     integer default 0,
  output_qty        integer not null default 0,
  defect_qty        integer default 0,
  -- 지표는 0..1 범위. NULL 은 "계산 불가"이며 0% 가 아니다.
  availability      numeric(5,4),
  performance       numeric(5,4),
  quality           numeric(5,4),
  oee               numeric(5,4),
  created_at        timestamptz default now(),
  downtime_minutes  integer,
  -- 저장 시점 스냅샷. 나중에 공정이 바뀌어도 과거 교대의 역사를 덮어쓰지 않는다.
  tact_time_seconds numeric,
  cavity_count      integer,
  constraint production_records_shift_check check (shift = any (array['A','B'])),
  constraint production_records_machine_id_date_shift_key unique (machine_id, date, shift)
);

create table if not exists public.production_shift_states (
  id         uuid primary key default gen_random_uuid(),
  machine_id uuid not null references public.machines(id) on delete cascade,
  date       date not null,
  shift      text not null,
  -- MISSING 은 OFF/HOLIDAY 와도, WORKING 생산기록과도 다른 상태다.
  status     text not null,
  reason     text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version    bigint not null default 1,
  constraint production_shift_states_shift_check check (shift = any (array['A','B'])),
  constraint production_shift_states_status_check check (status = any (array['WORKING','OFF','HOLIDAY','MISSING'])),
  constraint production_shift_states_version_check check (version > 0),
  constraint production_shift_states_machine_id_date_shift_key unique (machine_id, date, shift)
);

create table if not exists public.production_progress_reports (
  id               uuid primary key default gen_random_uuid(),
  machine_id       uuid not null references public.machines(id) on delete cascade,
  date             date not null,
  shift            text not null,
  reported_at      timestamptz not null default now(),
  shift_output_qty integer not null,
  operator_id      uuid references auth.users(id) on delete set null,
  created_at       timestamptz not null default now(),
  constraint production_progress_reports_shift_check check (shift = any (array['A','B'])),
  constraint production_progress_reports_shift_output_qty_check check (shift_output_qty >= 0)
);

-- ---------------------------------------------------------------------------
-- 알림 / 감사
-- ---------------------------------------------------------------------------
create table if not exists public.alert_acknowledgements (
  id         bigint generated by default as identity primary key,
  -- 알림 id 문자열이 그대로 들어온다. 즉 이 컬럼은 사실상 알림 식별 계약이다.
  alert_key  text not null,
  user_id    uuid not null references auth.users(id) on delete cascade,
  action     text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint alert_acknowledgements_action_check check (action = any (array['acknowledge','dismiss'])),
  constraint alert_acknowledgements_alert_key_user_id_key unique (alert_key, user_id)
);

create table if not exists public.audit_log (
  id         uuid primary key default gen_random_uuid(),
  table_name varchar(50) not null,
  record_id  uuid not null,
  action     varchar(20) not null,
  old_values jsonb,
  new_values jsonb,
  changed_by uuid references auth.users(id),
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 과도기 유물: 유령 데이터 백업 테이블
-- ---------------------------------------------------------------------------
-- 이 테이블은 **현재 운영에 없다**(실측 0개). 그런데도 baseline 에 있는 이유는,
-- baseline 의 정의가 "현재 운영 상태"가 아니라 **"마이그레이션 시퀀스가 시작될 때의
-- 상태"** 이기 때문이다.
--
-- 2026-07-14 유령 데이터 정리 때 손으로 만든 백업이다. 이후 두 마이그레이션이 이것을 다룬다:
--
--   20260715200000_restrict_anon_access_core_tables.sql  -- RLS 를 켜고 권한을 회수
--   20260729180000_lock_down_anon_access.sql             -- drop table
--
-- 즉 시퀀스는 이 테이블이 있다고 전제하고, 마지막에 스스로 치운다. baseline 에 두면 재현이
-- 운영과 **같은 궤적**을 그리고 같은 최종 상태에 도달한다. 없으면 20260715200000 에서
-- 42P01 로 멈춘다(실측).
--
-- 대안은 그 마이그레이션을 조건부로 고치는 것이었지만, AGENTS.md 는 이미 적용된
-- 마이그레이션을 다시 쓰지 말라고 한다. 시작 상태를 복원하는 쪽이 규칙도 지키고
-- 역사도 보존한다.
--
-- 컬럼 정의는 최소로 둔다 — 어차피 드롭되며, 그 사이 어떤 마이그레이션도 내용을 읽지 않는다.
create table if not exists public.production_records_ghost_backup_20260714 (
  record_id  uuid,
  machine_id uuid,
  date       date,
  shift      text,
  backed_up_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- 과도기 유물: oee_calculations (대체된 설계의 잔해)
-- ---------------------------------------------------------------------------
-- 역시 현재 운영에 없다. 시퀀스가 두 번에 걸쳐 다룬다:
--
--   20260804110000_master_write_boundary.sql   -- 열린 ALL 정책을 닫고 쓰기 권한 회수
--   20260804140000_drop_oee_calculations.sql   -- drop table
--
-- 설비 × 날짜 일별 OEE 미리계산 테이블이었다. 그 배치는 끝내 동작한 적이 없고
-- (`pg_cron` 미설치), `analytics_*` RPC 가 그 역할을 대체했다.
--
-- 아래 정의는 추측이 아니다 — 드롭 마이그레이션이 **제거 시점의 정의를 주석으로 보존**해
-- 두었고 그것을 그대로 옮겼다. 운영에서 뽑을 수 없는 객체를 저장소가 스스로 되돌려 준 셈이다.
create table if not exists public.oee_calculations (
  id               uuid primary key default gen_random_uuid(),
  machine_id       uuid not null references public.machines(id)
                     on update cascade on delete cascade,
  calculation_date date,
  availability     numeric,
  performance      numeric,
  quality          numeric,
  oee              numeric,
  created_at       timestamptz default now()
);
create index if not exists idx_oee_calculations_date       on public.oee_calculations(calculation_date);
create index if not exists idx_oee_calculations_machine_id on public.oee_calculations(machine_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- 정책은 뒤따르는 마이그레이션이 만든다. 여기서는 활성화만 한다 —
-- 정책 없이 RLS 만 켜면 deny-all 이므로, 재현 중간 상태에서도 데이터가 새지 않는다.
alter table public.user_profiles               enable row level security;
alter table public.product_models              enable row level security;
alter table public.model_processes             enable row level security;
alter table public.machines                    enable row level security;
alter table public.machine_status_descriptions enable row level security;
alter table public.system_settings             enable row level security;
alter table public.system_settings_audit       enable row level security;
alter table public.machine_logs                enable row level security;
alter table public.machine_status_history      enable row level security;
alter table public.downtime_entries            enable row level security;
alter table public.production_records          enable row level security;
alter table public.production_shift_states     enable row level security;
alter table public.production_progress_reports enable row level security;
alter table public.alert_acknowledgements      enable row level security;
alter table public.audit_log                   enable row level security;

-- ---------------------------------------------------------------------------
-- Supabase 기본 권한 재현
-- ---------------------------------------------------------------------------
-- 운영에서 이 테이블들은 Supabase 대시보드/SQL 에디터로 만들어졌고, 그때
-- `anon, authenticated, service_role` 이 기본 권한을 받았다. 이후 마이그레이션들이
-- (20260715200000, 20260729180000 등) anon 을 걷어내며 경계를 좁혔다.
--
-- baseline 이 그 **시작 권한**을 재현하지 않으면 궤적이 어긋난다. 실측(2026-08-21):
--
--   {"code":"42501","message":"permission denied for table user_profiles"}
--
-- service_role 로 user_profiles 를 읽지 못해 `requireFactoryUser` 가 403 을 냈다. 운영에서는
-- 같은 코드가 동작하므로, 이것은 앱의 결함이 아니라 **재현의 결함**이다.
--
-- anon 에게도 주는 것이 이상해 보이지만 그것이 운영의 실제 시작 상태이고, 이후
-- 마이그레이션이 회수하는 대상이다. 회수할 것이 없으면 그 마이그레이션들은 아무것도
-- 검증하지 못한 채 통과한다 — 재현의 값어치가 사라진다.
grant all on all tables in schema public to postgres, anon, authenticated, service_role;
grant all on all sequences in schema public to postgres, anon, authenticated, service_role;

commit;
