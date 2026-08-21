-- ALT/ALV 멀티테넌시 P1-3: 공장 소유 테이블에 factory_id 추가 (expand)
--
-- 계약: docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.md 4.2 / 4.3 / 7절 P1-3
-- 인벤토리: docs/workflows/D1_D2_INVENTORY_LEDGER.md 5절
--
-- ## nullable 로 시작하는 이유
--
-- expand -> backfill -> cutover -> contract 순서를 지킨다. 지금 NOT NULL 을 걸면 기존
-- 5만+6만행에 즉시 값이 있어야 하고, 그건 배포와 backfill 을 하나의 원자적 사건으로
-- 묶어야 한다는 뜻이다 — 되돌릴 수 없는 구조다.
--
-- **단, nullable 은 임시다.** 계약 1절은 "NULL factory_id = ALT 같은 영구 호환 규칙"을
-- 금지한다. NOT NULL 은 P4 contract 마이그레이션에서 닫는다. 그때까지 NULL 은 "아직
-- 채워지지 않음"이지 "ALT"가 아니다.
--
-- ## 복합 FK 를 NOT VALID 로 거는 이유
--
-- VALIDATE 는 전체 테이블을 스캔하면서 잠금을 잡는다. 6만행 테이블에서 그것을 배포 시점에
-- 하면 운영이 멈춘다. NOT VALID 로 걸면 **이후 쓰기는 즉시 검증**되고, 기존 행 검증은
-- backfill 이 끝난 뒤 P4 에서 별도로 한다.
--
-- ## 판정 보류 2개를 공장 소유로 넣은 근거
--
-- 계약 4.2 는 "글로벌로 남길 항목은 H1 에서 불변 카탈로그임을 증명해야 한다"고 쓴다.
-- 즉 **기본값이 공장 소유**이고 글로벌이 예외다.
--
--   - `machine_status_descriptions`: 계약 4.2 가 "수정 가능한 상태 설명·분류·템플릿은
--     공장 소유로 본다"고 명시한다. 이 테이블은 수정 가능하다.
--   - `audit_log`: 계약 4.2 의 "공장별 audit/history" 에 해당한다. 감사 기록이 공장을
--     넘나들면 ALV 관리자가 ALT 의 변경 이력을 읽는다.
--
-- 둘 다 H1 에서 뒤집을 수 있다. 뒤집는 방향(공장 소유 -> 글로벌)이 그 반대보다 안전하다.

begin;

-- ---------------------------------------------------------------------------
-- 1. 부모 테이블 — 자식이 참조할 (factory_id, id) UNIQUE 가 필요하다
-- ---------------------------------------------------------------------------
alter table public.product_models add column if not exists factory_id uuid;
alter table public.model_processes add column if not exists factory_id uuid;
alter table public.machines add column if not exists factory_id uuid;
alter table public.system_settings add column if not exists factory_id uuid;

-- ---------------------------------------------------------------------------
-- 2. 사실 테이블
-- ---------------------------------------------------------------------------
alter table public.machine_logs                add column if not exists factory_id uuid;
alter table public.machine_status_history      add column if not exists factory_id uuid;
alter table public.downtime_entries            add column if not exists factory_id uuid;
alter table public.production_records          add column if not exists factory_id uuid;
alter table public.production_shift_states     add column if not exists factory_id uuid;
alter table public.production_progress_reports add column if not exists factory_id uuid;
alter table public.alert_acknowledgements      add column if not exists factory_id uuid;
alter table public.system_settings_audit       add column if not exists factory_id uuid;
alter table public.machine_status_descriptions add column if not exists factory_id uuid;
alter table public.audit_log                   add column if not exists factory_id uuid;

-- ---------------------------------------------------------------------------
-- 3. factories FK
-- ---------------------------------------------------------------------------
-- 값이 있으면 반드시 실재하는 공장이어야 한다. NULL 은 아직 허용된다(위 주석 참조).
--
-- 루프로 접지 않고 **한 줄씩 명시한다.** 이 규약의 검사자는 사람과 grep 이다
-- (`__tests__/factoryScopeLedger.test.ts` 가 마이그레이션 전문을 훑는다). 동적 SQL 로 접으면
-- 제약 이름이 문자열 조립 결과로만 존재해서, 목록에서 테이블 하나가 빠져도 diff 에 드러나지
-- 않는다. 장황함은 여기서 비용이 아니라 기능이다.
--
-- drop-then-add 로 멱등성을 얻는다. NOT VALID FK 는 기존 행을 검사하지 않으므로 재생성이
-- 저렴하다.
alter table public.product_models drop constraint if exists product_models_factory_id_fkey;
alter table public.product_models add constraint product_models_factory_id_fkey
  foreign key (factory_id) references public.factories(id) not valid;

alter table public.model_processes drop constraint if exists model_processes_factory_id_fkey;
alter table public.model_processes add constraint model_processes_factory_id_fkey
  foreign key (factory_id) references public.factories(id) not valid;

alter table public.machines drop constraint if exists machines_factory_id_fkey;
alter table public.machines add constraint machines_factory_id_fkey
  foreign key (factory_id) references public.factories(id) not valid;

alter table public.system_settings drop constraint if exists system_settings_factory_id_fkey;
alter table public.system_settings add constraint system_settings_factory_id_fkey
  foreign key (factory_id) references public.factories(id) not valid;

alter table public.system_settings_audit drop constraint if exists system_settings_audit_factory_id_fkey;
alter table public.system_settings_audit add constraint system_settings_audit_factory_id_fkey
  foreign key (factory_id) references public.factories(id) not valid;

alter table public.machine_logs drop constraint if exists machine_logs_factory_id_fkey;
alter table public.machine_logs add constraint machine_logs_factory_id_fkey
  foreign key (factory_id) references public.factories(id) not valid;

alter table public.machine_status_history drop constraint if exists machine_status_history_factory_id_fkey;
alter table public.machine_status_history add constraint machine_status_history_factory_id_fkey
  foreign key (factory_id) references public.factories(id) not valid;

alter table public.machine_status_descriptions drop constraint if exists machine_status_descriptions_factory_id_fkey;
alter table public.machine_status_descriptions add constraint machine_status_descriptions_factory_id_fkey
  foreign key (factory_id) references public.factories(id) not valid;

alter table public.downtime_entries drop constraint if exists downtime_entries_factory_id_fkey;
alter table public.downtime_entries add constraint downtime_entries_factory_id_fkey
  foreign key (factory_id) references public.factories(id) not valid;

alter table public.production_records drop constraint if exists production_records_factory_id_fkey;
alter table public.production_records add constraint production_records_factory_id_fkey
  foreign key (factory_id) references public.factories(id) not valid;

alter table public.production_shift_states drop constraint if exists production_shift_states_factory_id_fkey;
alter table public.production_shift_states add constraint production_shift_states_factory_id_fkey
  foreign key (factory_id) references public.factories(id) not valid;

alter table public.production_progress_reports drop constraint if exists production_progress_reports_factory_id_fkey;
alter table public.production_progress_reports add constraint production_progress_reports_factory_id_fkey
  foreign key (factory_id) references public.factories(id) not valid;

alter table public.alert_acknowledgements drop constraint if exists alert_acknowledgements_factory_id_fkey;
alter table public.alert_acknowledgements add constraint alert_acknowledgements_factory_id_fkey
  foreign key (factory_id) references public.factories(id) not valid;

alter table public.audit_log drop constraint if exists audit_log_factory_id_fkey;
alter table public.audit_log add constraint audit_log_factory_id_fkey
  foreign key (factory_id) references public.factories(id) not valid;

-- ---------------------------------------------------------------------------
-- 4. factory 선두 index
-- ---------------------------------------------------------------------------
-- RLS 술어가 factory_id 를 먼저 비교하므로 index 도 factory 가 선두여야 한다.
-- 계약 5.2: "EXISTS/InitPlan 과 factory 선두 index 를 사용하고 EXPLAIN ANALYZE 로 검증".
create index if not exists idx_product_models_factory on public.product_models (factory_id);
create index if not exists idx_model_processes_factory on public.model_processes (factory_id);
create index if not exists idx_machines_factory on public.machines (factory_id);
create index if not exists idx_system_settings_factory on public.system_settings (factory_id);

create index if not exists idx_machine_logs_factory_machine
  on public.machine_logs (factory_id, machine_id);
create index if not exists idx_machine_status_history_factory
  on public.machine_status_history (factory_id, machine_id);
create index if not exists idx_downtime_entries_factory_machine
  on public.downtime_entries (factory_id, machine_id);
create index if not exists idx_production_records_factory_date
  on public.production_records (factory_id, date);
create index if not exists idx_production_shift_states_factory_date
  on public.production_shift_states (factory_id, date);
create index if not exists idx_production_progress_reports_factory
  on public.production_progress_reports (factory_id, machine_id);
create index if not exists idx_alert_acknowledgements_factory
  on public.alert_acknowledgements (factory_id);
create index if not exists idx_system_settings_audit_factory
  on public.system_settings_audit (factory_id);
create index if not exists idx_machine_status_descriptions_factory
  on public.machine_status_descriptions (factory_id);
create index if not exists idx_audit_log_factory on public.audit_log (factory_id);

-- ---------------------------------------------------------------------------
-- 5. (factory_id, id) UNIQUE — 복합 FK 의 참조 대상
-- ---------------------------------------------------------------------------
-- id 가 이미 PK 라 이 UNIQUE 는 논리적으로 잉여로 보이지만, Postgres 는 복합 FK 의
-- 참조 대상으로 **정확히 그 컬럼 조합의 unique 제약**을 요구한다. 이것이 있어야
-- (factory_id, machine_id) -> machines(factory_id, id) 형태를 걸 수 있다.
create unique index if not exists uq_product_models_factory_id
  on public.product_models (factory_id, id);
create unique index if not exists uq_model_processes_factory_id
  on public.model_processes (factory_id, id);
create unique index if not exists uq_machines_factory_id
  on public.machines (factory_id, id);
create unique index if not exists uq_system_settings_factory_id
  on public.system_settings (factory_id, id);

-- ---------------------------------------------------------------------------
-- 6. 공장 범위 유일성
-- ---------------------------------------------------------------------------
-- 계약 4.3: "설비·모델·공정 이름의 유일성은 전역이 아니라 공장 범위다."
-- ALT 와 ALV 가 같은 설비명 CNC-001 을 각자 쓸 수 있어야 한다.
--
-- backfill 전에는 factory_id 가 NULL 이라 이 index 가 NULL 행들을 서로 다르게 취급한다
-- (Postgres 에서 NULL 은 서로 같지 않다). 그래서 지금 만들어도 기존 데이터와 충돌하지 않고,
-- backfill 이 끝나면 자동으로 유효해진다.
create unique index if not exists uq_machines_factory_name
  on public.machines (factory_id, name);
create unique index if not exists uq_product_models_factory_name
  on public.product_models (factory_id, model_name);
create unique index if not exists uq_system_settings_factory_category_key
  on public.system_settings (factory_id, category, setting_key);

-- ---------------------------------------------------------------------------
-- 7. 복합 FK (factory_id, parent_id) -> parent(factory_id, id)
-- ---------------------------------------------------------------------------
-- 이것이 이 마이그레이션의 핵심이다. 단일 컬럼 FK 는 "이 설비가 존재한다"만 보장하지만,
-- 복합 FK 는 "이 행과 그 설비가 **같은 공장**이다"를 DB 수준에서 보장한다.
--
-- 계약 1절: "최종 보안 경계는 Host, UI 필터 또는 클라이언트 상태가 아니라 PostgreSQL
-- 제약조건과 RLS 다." 제약조건 쪽 절반이 여기다.
-- 위와 같은 이유로 한 줄씩 명시한다. 이 목록이 곧 "공장을 넘나들 수 없는 관계"의 정의이고,
-- 사람이 읽어서 빠진 것을 찾을 수 있어야 한다.
alter table public.machine_logs drop constraint if exists machine_logs_factory_machine_id_fkey;
alter table public.machine_logs add constraint machine_logs_factory_machine_id_fkey
  foreign key (factory_id, machine_id) references public.machines(factory_id, id) not valid;

alter table public.machine_status_history drop constraint if exists machine_status_history_factory_machine_id_fkey;
alter table public.machine_status_history add constraint machine_status_history_factory_machine_id_fkey
  foreign key (factory_id, machine_id) references public.machines(factory_id, id) not valid;

alter table public.downtime_entries drop constraint if exists downtime_entries_factory_machine_id_fkey;
alter table public.downtime_entries add constraint downtime_entries_factory_machine_id_fkey
  foreign key (factory_id, machine_id) references public.machines(factory_id, id) not valid;

alter table public.production_records drop constraint if exists production_records_factory_machine_id_fkey;
alter table public.production_records add constraint production_records_factory_machine_id_fkey
  foreign key (factory_id, machine_id) references public.machines(factory_id, id) not valid;

alter table public.production_shift_states drop constraint if exists production_shift_states_factory_machine_id_fkey;
alter table public.production_shift_states add constraint production_shift_states_factory_machine_id_fkey
  foreign key (factory_id, machine_id) references public.machines(factory_id, id) not valid;

alter table public.production_progress_reports drop constraint if exists production_progress_reports_factory_machine_id_fkey;
alter table public.production_progress_reports add constraint production_progress_reports_factory_machine_id_fkey
  foreign key (factory_id, machine_id) references public.machines(factory_id, id) not valid;

alter table public.model_processes drop constraint if exists model_processes_factory_model_id_fkey;
alter table public.model_processes add constraint model_processes_factory_model_id_fkey
  foreign key (factory_id, model_id) references public.product_models(factory_id, id) not valid;

alter table public.system_settings_audit drop constraint if exists system_settings_audit_factory_setting_id_fkey;
alter table public.system_settings_audit add constraint system_settings_audit_factory_setting_id_fkey
  foreign key (factory_id, setting_id) references public.system_settings(factory_id, id) not valid;

-- machines 자신의 부모(모델·공정)도 같은 공장이어야 한다.
-- 이 둘이 없으면 ALT 설비가 ALV 모델을 생산 모델로 지정할 수 있다.
alter table public.machines drop constraint if exists machines_factory_production_model_fkey;
alter table public.machines add constraint machines_factory_production_model_fkey
  foreign key (factory_id, production_model_id) references public.product_models(factory_id, id) not valid;

alter table public.machines drop constraint if exists machines_factory_current_process_fkey;
alter table public.machines add constraint machines_factory_current_process_fkey
  foreign key (factory_id, current_process_id) references public.model_processes(factory_id, id) not valid;

-- ---------------------------------------------------------------------------
-- 8. user_machine_assignments -> machines 복합 FK
-- ---------------------------------------------------------------------------
-- core_tables 마이그레이션에서 걸지 못했던 절반이다. machines 에 (factory_id, id) UNIQUE 가
-- 이제 생겼으므로 여기서 건다. 이로써 assignment 는 membership 과 machine 양쪽에 복합 FK 를
-- 갖는다(계약 4.3).
alter table public.user_machine_assignments
  drop constraint if exists user_machine_assignments_machine_fkey;
alter table public.user_machine_assignments
  add constraint user_machine_assignments_machine_fkey
  foreign key (factory_id, machine_id) references public.machines(factory_id, id)
  on delete cascade not valid;

commit;
