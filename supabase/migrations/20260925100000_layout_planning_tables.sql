-- Layout 계획(Forecast → CAPA → 추천 Layout → 확정 → 현장 셋업) 저장 구조.
--
-- 사용자 요구(2026-09-25):
--   1) 현재 설비의 모델·CNC# 대비 새 Forecast 를 비교해 최소 변경 + 도면상 같은 모델·CNC# 끼리 이웃하게 그룹화
--   2) 앱에 등록된 T/T·일 생산량(OEE 입력 화면과 같은 식)으로 CAPA 계산 후 Layout 에 적용
--   3) 시뮬레이션 → 추천 Layout → 설비별 미세조정 → 확정
--   4) 추천 Layout 을 도면에 그려 시각 확인
--   5) CAPA 대비 설비 부족·여유 알림 (추가 배치 여부는 사용자가 판단)
--
-- 이 파일은 테이블·RLS 만 만든다. 쓰기 함수는 20260925110000, 1공장 위치 초기값은 20260925120000.
--
-- 표 한눈에 보기
--   layout_geometries         공장별 도면(위치) 버전. 공장당 활성 1개.            → 요구 1(그룹화 판단), 4(도면)
--   machine_layout_positions  도면 버전 × 설비 → 동·셀·좌표.                        → 요구 1, 4
--   forecast_model_mappings   Forecast 모델명 → 앱 모델. 사용자가 확정, 공장별 재사용. (현장 약어 대응, 2026-09-25 결정)
--   layout_plans              시뮬레이션 1회 = 계획 1건. draft → confirmed → superseded. 공장당 확정 1개. → 요구 3, 이력
--   layout_plan_requirements  계획 × (모델, 공정) → 최대 수요·T/T 스냅샷·대당 일 CAPA·필요 대수. → 요구 2, 5
--   layout_plan_assignments   계획 × 설비 → 기준(현재)/추천/최종(미세조정) 배정·잠금.  → 요구 1, 3, 4
--   machine_setup_tasks       확정 후 현장 셋업 작업(대기→진행→완료). 설비당 활성 1개.
--   machine_setup_events      셋업 상태 변경 이력(추가 전용).
--
-- 규칙
--   * 모든 표에 factory_id NOT NULL. 자식 행은 (factory_id, 부모 id) 복합 FK 로 **다른 공장의 설비·모델을
--     가리키는 것 자체를 막는다** (공장 독립 계약, PRD §2).
--   * (모델, 공정) 쌍은 model_processes(model_id, id) 로 묶어, 다른 모델의 공정을 붙일 수 없게 한다.
--   * 브라우저는 읽기만 한다(SELECT RLS). 쓰기는 모두 서비스 롤 라우트 → 20260925110000 의 RPC.
--     multi-factory cutover 와 같은 방식이다(쓰기 정책을 만들지 않으면 authenticated 쓰기는 거부된다).
--   * 스냅샷 보존: 계획은 만들 때의 T/T·CAPA·기준 배정을 복사해 둔다. 나중에 T/T 가 바뀌어도 과거 계획은
--     그대로이고, 대신 확정 시점에 기준 배정이 바뀌었으면 거부한다(20260925110000).

begin;

-- (model_id, id) 복합 FK 대상. 이미 id 가 PK 라 값은 늘 유일하다 — 인덱스만 추가한다.
create unique index if not exists uq_model_processes_model_id on public.model_processes (model_id, id);

-- ── 도면 ─────────────────────────────────────────────────────────────────────────────────────
create table public.layout_geometries (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id),
  source_file text not null,
  source_sheet text,
  source_hash text not null,
  note text,
  is_active boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now()
);
create unique index uq_layout_geometries_factory_id on public.layout_geometries (factory_id, id);
-- 공장당 활성 도면은 하나. 새 도면을 올리면 이전 것은 비활성으로 남아 과거 계획이 계속 참조한다.
create unique index uq_layout_geometries_one_active on public.layout_geometries (factory_id) where is_active;

create table public.machine_layout_positions (
  geometry_id uuid not null,
  factory_id uuid not null,
  machine_id uuid not null,
  building text not null,
  cell text not null,
  x numeric not null,
  y numeric not null,
  width numeric not null check (width > 0),
  height numeric not null check (height > 0),
  primary key (geometry_id, machine_id),
  constraint machine_layout_positions_factory_geometry_fkey
    foreign key (factory_id, geometry_id) references public.layout_geometries (factory_id, id) on delete cascade,
  constraint machine_layout_positions_factory_machine_id_fkey
    foreign key (factory_id, machine_id) references public.machines (factory_id, id) on delete cascade
);
create unique index uq_machine_layout_positions_cell on public.machine_layout_positions (geometry_id, building, cell);
create index idx_machine_layout_positions_factory on public.machine_layout_positions (factory_id, geometry_id);

-- ── Forecast 모델명 매핑 ────────────────────────────────────────────────────────────────────────
create table public.forecast_model_mappings (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id),
  -- 공백 제거·대문자(src/lib/forecast/modelAliases.ts normalizeModelName 와 같은 규칙). 같은 공장에서 유일.
  forecast_model_key text not null check (forecast_model_key <> '' and forecast_model_key = upper(forecast_model_key) and forecast_model_key !~ '\s'),
  forecast_model_label text not null,
  product_model_id uuid not null,
  confirmed_by uuid,
  confirmed_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint forecast_model_mappings_factory_product_model_id_fkey
    foreign key (factory_id, product_model_id) references public.product_models (factory_id, id) on delete cascade
);
create unique index uq_forecast_model_mappings_key on public.forecast_model_mappings (factory_id, forecast_model_key);

-- ── 계획 ─────────────────────────────────────────────────────────────────────────────────────
create table public.layout_plans (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null references public.factories(id),
  geometry_id uuid not null,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'superseded', 'discarded')),
  title text not null,
  forecast_file_name text not null,
  forecast_file_hash text not null,
  target_week text not null,            -- 예: 2026-W39. 수요는 이 주의 모델·공정별 최대 일 수량.
  period_start date not null,
  period_end date not null check (period_end >= period_start),
  -- CAPA 계산에 쓴 기준(휴식·가동분·출처). 나중에 설정이 바뀌어도 이 계획의 숫자를 재현할 수 있게 복사한다.
  capacity_policy jsonb not null,
  -- 이 계획이 만든 시점의 설비 배정 요약 해시. 화면에서 "그사이 설비가 바뀜"을 빨리 알리는 용도이고,
  -- 확정 가능 여부의 최종 판단은 확정 RPC 가 설비별로 다시 대조한다.
  base_snapshot_hash text not null,
  revision integer not null default 1 check (revision >= 1),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_by uuid,
  updated_at timestamptz not null default now(),
  confirmed_by uuid,
  confirmed_at timestamptz,
  superseded_at timestamptz,
  constraint layout_plans_factory_geometry_fkey
    foreign key (factory_id, geometry_id) references public.layout_geometries (factory_id, id),
  constraint layout_plans_confirmed_fields check ((status = 'draft' or status = 'discarded') or confirmed_at is not null)
);
create unique index uq_layout_plans_factory_id on public.layout_plans (factory_id, id);
-- 공장당 "현재 확정 Layout" 은 하나. 새 확정 시 이전 것은 superseded 로 남아 전 주 비교에 쓰인다.
create unique index uq_layout_plans_one_confirmed on public.layout_plans (factory_id) where status = 'confirmed';
create index idx_layout_plans_factory_created on public.layout_plans (factory_id, created_at desc);

create table public.layout_plan_requirements (
  plan_id uuid not null,
  factory_id uuid not null,
  product_model_id uuid not null,
  process_id uuid not null,
  forecast_model_label text not null,
  peak_quantity integer not null check (peak_quantity >= 0),
  peak_date date,
  -- 스냅샷. tact 는 개당 초(per piece) — cavity 로 나누지 않는다(CLAUDE.md).
  tact_time_seconds numeric check (tact_time_seconds > 0),
  daily_capacity_per_machine integer check (daily_capacity_per_machine >= 0),
  -- NULL = 계산 불가(T/T 없음 등). 0 과 다르다 — 0 으로 바꿔 넣지 않는다.
  required_machines integer check (required_machines >= 0),
  primary key (plan_id, product_model_id, process_id),
  constraint layout_plan_requirements_factory_plan_fkey
    foreign key (factory_id, plan_id) references public.layout_plans (factory_id, id) on delete cascade,
  constraint layout_plan_requirements_factory_product_model_id_fkey
    foreign key (factory_id, product_model_id) references public.product_models (factory_id, id),
  constraint layout_plan_requirements_model_process_fkey
    foreign key (product_model_id, process_id) references public.model_processes (model_id, id),
  constraint layout_plan_requirements_computable check (
    (required_machines is null) or (tact_time_seconds is not null and daily_capacity_per_machine is not null)
  )
);
create index idx_layout_plan_requirements_factory on public.layout_plan_requirements (factory_id, plan_id);

create table public.layout_plan_assignments (
  plan_id uuid not null,
  factory_id uuid not null,
  machine_id uuid not null,
  -- 기준 = 계획을 만들 때 설비에 실제로 걸려 있던 모델·공정(RPC 가 machines 에서 읽어 넣는다. 클라이언트 값 불신).
  base_model_id uuid,
  base_process_id uuid,
  -- 추천 = 시뮬레이션 결과. 최종 = 사용자가 미세조정한 값(처음에는 추천과 같다). 확정 시 최종이 설비에 반영된다.
  recommended_model_id uuid,
  recommended_process_id uuid,
  final_model_id uuid,
  final_process_id uuid,
  recommendation_reason text not null default 'keep'
    check (recommendation_reason in ('keep', 'shortage_fill', 'surplus_release', 'zero_demand_release', 'unassigned_fill', 'locked')),
  is_locked boolean not null default false,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (plan_id, machine_id),
  constraint layout_plan_assignments_factory_plan_fkey
    foreign key (factory_id, plan_id) references public.layout_plans (factory_id, id) on delete cascade,
  constraint layout_plan_assignments_factory_machine_id_fkey
    foreign key (factory_id, machine_id) references public.machines (factory_id, id),
  constraint layout_plan_assignments_factory_base_model_fkey
    foreign key (factory_id, base_model_id) references public.product_models (factory_id, id),
  constraint layout_plan_assignments_factory_recommended_model_fkey
    foreign key (factory_id, recommended_model_id) references public.product_models (factory_id, id),
  constraint layout_plan_assignments_factory_final_model_fkey
    foreign key (factory_id, final_model_id) references public.product_models (factory_id, id),
  constraint layout_plan_assignments_base_pair_fkey
    foreign key (base_model_id, base_process_id) references public.model_processes (model_id, id),
  constraint layout_plan_assignments_recommended_pair_fkey
    foreign key (recommended_model_id, recommended_process_id) references public.model_processes (model_id, id),
  constraint layout_plan_assignments_final_pair_fkey
    foreign key (final_model_id, final_process_id) references public.model_processes (model_id, id),
  -- 모델만 있고 공정이 없는(또는 반대) 반쪽 배정 금지. 둘 다 NULL = 대기(모델 없음).
  constraint layout_plan_assignments_base_pair check ((base_model_id is null) = (base_process_id is null)),
  constraint layout_plan_assignments_recommended_pair check ((recommended_model_id is null) = (recommended_process_id is null)),
  constraint layout_plan_assignments_final_pair check ((final_model_id is null) = (final_process_id is null))
);
create index idx_layout_plan_assignments_factory on public.layout_plan_assignments (factory_id, plan_id);
create index idx_layout_plan_assignments_final on public.layout_plan_assignments (plan_id, final_model_id, final_process_id);

-- ── 현장 셋업 ────────────────────────────────────────────────────────────────────────────────
create table public.machine_setup_tasks (
  id uuid primary key default gen_random_uuid(),
  factory_id uuid not null,
  plan_id uuid not null,
  machine_id uuid not null,
  before_model_id uuid,
  before_process_id uuid,
  target_model_id uuid,
  target_process_id uuid,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  revision integer not null default 1 check (revision >= 1),
  created_at timestamptz not null default now(),
  started_by uuid,
  started_at timestamptz,
  completed_by uuid,
  completed_at timestamptz,
  cancelled_by uuid,
  cancelled_at timestamptz,
  cancel_reason text,
  constraint machine_setup_tasks_factory_plan_fkey
    foreign key (factory_id, plan_id) references public.layout_plans (factory_id, id),
  constraint machine_setup_tasks_factory_machine_id_fkey
    foreign key (factory_id, machine_id) references public.machines (factory_id, id),
  constraint machine_setup_tasks_before_pair_fkey
    foreign key (before_model_id, before_process_id) references public.model_processes (model_id, id),
  constraint machine_setup_tasks_target_pair_fkey
    foreign key (target_model_id, target_process_id) references public.model_processes (model_id, id),
  constraint machine_setup_tasks_before_pair check ((before_model_id is null) = (before_process_id is null)),
  constraint machine_setup_tasks_target_pair check ((target_model_id is null) = (target_process_id is null)),
  constraint machine_setup_tasks_cancel_reason check (status <> 'cancelled' or coalesce(cancel_reason, '') <> '')
);
create unique index uq_machine_setup_tasks_factory_id on public.machine_setup_tasks (factory_id, id);
-- 설비당 진행 중(대기·진행) 작업은 하나.
create unique index uq_machine_setup_tasks_one_active on public.machine_setup_tasks (factory_id, machine_id)
  where status in ('pending', 'in_progress');
create index idx_machine_setup_tasks_plan on public.machine_setup_tasks (factory_id, plan_id, status);

create table public.machine_setup_events (
  id bigint generated always as identity primary key,
  factory_id uuid not null,
  task_id uuid not null,
  from_status text check (from_status in ('pending', 'in_progress', 'completed', 'cancelled')),
  to_status text not null check (to_status in ('pending', 'in_progress', 'completed', 'cancelled')),
  actor uuid,
  reason text,
  created_at timestamptz not null default now(),
  constraint machine_setup_events_factory_task_fkey
    foreign key (factory_id, task_id) references public.machine_setup_tasks (factory_id, id) on delete cascade
);
create index idx_machine_setup_events_task on public.machine_setup_events (factory_id, task_id, created_at);

-- 이력은 고치지 않는다. 서비스 롤도 UPDATE/DELETE 로 과거를 바꿀 수 없게 막는다(작업 삭제에 따른 cascade 제외).
create or replace function public.forbid_setup_event_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'machine_setup_events is append-only' using errcode = '55000';
end;
$$;
revoke all on function public.forbid_setup_event_update() from public, anon, authenticated;
create trigger trg_machine_setup_events_append_only
  before update on public.machine_setup_events
  for each row execute function public.forbid_setup_event_update();

-- ── updated_at ───────────────────────────────────────────────────────────────────────────────
create trigger set_forecast_model_mappings_updated_at before update on public.forecast_model_mappings
  for each row execute function public.handle_updated_at();
create trigger set_layout_plans_updated_at before update on public.layout_plans
  for each row execute function public.handle_updated_at();
create trigger set_layout_plan_assignments_updated_at before update on public.layout_plan_assignments
  for each row execute function public.handle_updated_at();

-- ── RLS: 읽기만. 계획·매핑은 관리자·엔지니어(/forecast·/layout-studio 와 같은 등급). ──────────────
alter table public.layout_geometries enable row level security;
alter table public.machine_layout_positions enable row level security;
alter table public.forecast_model_mappings enable row level security;
alter table public.layout_plans enable row level security;
alter table public.layout_plan_requirements enable row level security;
alter table public.layout_plan_assignments enable row level security;
alter table public.machine_setup_tasks enable row level security;
alter table public.machine_setup_events enable row level security;

create policy "factory read layout_geometries" on public.layout_geometries
  for select to authenticated
  using (factory_id = (select public.current_user_factory())
         and (select public.current_user_factory_role()) in ('admin', 'engineer'));
create policy "factory read machine_layout_positions" on public.machine_layout_positions
  for select to authenticated
  using (factory_id = (select public.current_user_factory())
         and (select public.current_user_factory_role()) in ('admin', 'engineer'));
create policy "factory read forecast_model_mappings" on public.forecast_model_mappings
  for select to authenticated
  using (factory_id = (select public.current_user_factory())
         and (select public.current_user_factory_role()) in ('admin', 'engineer'));
create policy "factory read layout_plans" on public.layout_plans
  for select to authenticated
  using (factory_id = (select public.current_user_factory())
         and (select public.current_user_factory_role()) in ('admin', 'engineer'));
create policy "factory read layout_plan_requirements" on public.layout_plan_requirements
  for select to authenticated
  using (factory_id = (select public.current_user_factory())
         and (select public.current_user_factory_role()) in ('admin', 'engineer'));
create policy "factory read layout_plan_assignments" on public.layout_plan_assignments
  for select to authenticated
  using (factory_id = (select public.current_user_factory())
         and (select public.current_user_factory_role()) in ('admin', 'engineer'));
-- 셋업은 현장 작업이다: 관리자·엔지니어는 전체, 운영자는 배정받은 설비만(설비 RLS 와 같은 술어).
create policy "factory read machine_setup_tasks" on public.machine_setup_tasks
  for select to authenticated
  using (factory_id = (select public.current_user_factory())
         and ((select public.current_user_factory_role()) in ('admin', 'engineer')
              or machine_id in (select unnest((select public.current_factory_machine_ids())))));
create policy "factory read machine_setup_events" on public.machine_setup_events
  for select to authenticated
  using (factory_id = (select public.current_user_factory())
         and ((select public.current_user_factory_role()) in ('admin', 'engineer')
              or task_id in (select t.id from public.machine_setup_tasks t
                             where t.factory_id = (select public.current_user_factory())
                               and t.machine_id in (select unnest((select public.current_factory_machine_ids()))))));

-- ── 권한 ─────────────────────────────────────────────────────────────────────────────────────
revoke all on public.layout_geometries, public.machine_layout_positions, public.forecast_model_mappings,
  public.layout_plans, public.layout_plan_requirements, public.layout_plan_assignments,
  public.machine_setup_tasks, public.machine_setup_events
  from public, anon, authenticated;
grant select on public.layout_geometries, public.machine_layout_positions, public.forecast_model_mappings,
  public.layout_plans, public.layout_plan_requirements, public.layout_plan_assignments,
  public.machine_setup_tasks, public.machine_setup_events
  to authenticated;
-- 없으면 서비스 롤 라우트가 42501 로 깨진다.
grant all on public.layout_geometries, public.machine_layout_positions, public.forecast_model_mappings,
  public.layout_plans, public.layout_plan_requirements, public.layout_plan_assignments,
  public.machine_setup_tasks, public.machine_setup_events
  to service_role;

commit;
