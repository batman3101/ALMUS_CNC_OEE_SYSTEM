-- ALT/ALV 멀티테넌시 P4: contract — 전역 유일성 제거, NOT NULL, FK 검증
--
-- 계약: docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.md 7절 P4 / 4.3
--
-- ## ⚠ 이 마이그레이션은 backfill 이 끝난 뒤에만 성공한다
--
-- NOT NULL 이 남은 NULL 을 거부하므로, orphan 이 있으면 여기서 멈춘다. 그것이 의도다 —
-- backfill 마이그레이션의 orphan 경고를 사람이 처리하지 않고 지나칠 수 없게 만드는 게이트다.
--
-- 운영 적용은 계약의 Human Gate H6 대상이다.
--
-- ## 왜 전역 유일성 제거가 이 파일의 핵심인가
--
-- 로컬 격리 검증에서 실제로 걸린 결함이다:
--
--   ERROR: duplicate key value violates unique constraint "machines_name_key"
--   DETAIL: Key (name)=(CNC-001) already exists.
--
-- expand 마이그레이션이 공장 범위 UNIQUE 를 **추가**했지만 기존 전역 UNIQUE 를 **제거하지
-- 않았다.** 둘 다 있으면 좁은 쪽이 아니라 넓은 쪽이 이긴다 — ALT 와 ALV 는 같은 설비명을
-- 쓸 수 없다. 계약 4.3 의 "설비·모델·공정 이름의 유일성은 전역이 아니라 공장 범위다" 가
-- 깨진다.
--
-- 정적 검사와 계약 테스트 47건은 이것을 잡지 못했다. "추가했다"는 grep 으로 확인되지만
-- "낡은 것이 남아 있다"는 실제로 데이터를 넣어 봐야 드러난다. baseline 을 복원해 로컬
-- 재현을 가능하게 만든 이유가 정확히 이것이다.

begin;

-- ---------------------------------------------------------------------------
-- 1. 전역 유일성 제거
-- ---------------------------------------------------------------------------
-- 각 제약의 공장 범위 대체물은 expand 마이그레이션이 이미 만들어 두었다:
--   machines_name_key              -> uq_machines_factory_name
--   product_models_model_name_key  -> uq_product_models_factory_name
--   system_settings_setting_key_key-> uq_system_settings_factory_category_key
--
-- 대체물이 없는 상태로 드롭하면 유일성이 통째로 사라진다. 순서가 안전을 만든다.
alter table public.machines drop constraint if exists machines_name_key;
alter table public.product_models drop constraint if exists product_models_model_name_key;
alter table public.system_settings drop constraint if exists system_settings_setting_key_key;

-- ---------------------------------------------------------------------------
-- 2. factory_id NOT NULL
-- ---------------------------------------------------------------------------
-- 계약 1절: "NULL factory_id = ALT 같은 영구 호환 규칙은 금지한다."
-- expand 단계의 nullable 은 임시였고 여기서 닫는다. 이 시점 이후 factory_id 없는 행은
-- 존재할 수 없으므로, "공장을 모르는 데이터"라는 상태가 사라진다.
alter table public.product_models              alter column factory_id set not null;
alter table public.model_processes             alter column factory_id set not null;
alter table public.machines                    alter column factory_id set not null;
alter table public.system_settings             alter column factory_id set not null;
alter table public.system_settings_audit       alter column factory_id set not null;
alter table public.machine_logs                alter column factory_id set not null;
alter table public.machine_status_history      alter column factory_id set not null;
alter table public.machine_status_descriptions alter column factory_id set not null;
alter table public.downtime_entries            alter column factory_id set not null;
alter table public.production_records          alter column factory_id set not null;
alter table public.production_shift_states     alter column factory_id set not null;
alter table public.production_progress_reports alter column factory_id set not null;
alter table public.alert_acknowledgements      alter column factory_id set not null;
alter table public.audit_log                   alter column factory_id set not null;

-- ---------------------------------------------------------------------------
-- 3. 복합 FK 검증
-- ---------------------------------------------------------------------------
-- expand 에서 NOT VALID 로 걸었던 것들을 여기서 검증한다. NOT VALID FK 는 **이후 쓰기는
-- 이미 막고 있었다** — VALIDATE 는 기존 행이 규약을 지키는지 확인하는 절차다.
--
-- 전체 스캔이므로 큰 테이블에서 시간이 걸린다. 잠금은 SHARE UPDATE EXCLUSIVE 라
-- 읽기와 쓰기를 막지 않는다(ACCESS EXCLUSIVE 가 아니다).
alter table public.product_models              validate constraint product_models_factory_id_fkey;
alter table public.model_processes             validate constraint model_processes_factory_id_fkey;
alter table public.machines                    validate constraint machines_factory_id_fkey;
alter table public.system_settings             validate constraint system_settings_factory_id_fkey;
alter table public.system_settings_audit       validate constraint system_settings_audit_factory_id_fkey;
alter table public.machine_logs                validate constraint machine_logs_factory_id_fkey;
alter table public.machine_status_history      validate constraint machine_status_history_factory_id_fkey;
alter table public.machine_status_descriptions validate constraint machine_status_descriptions_factory_id_fkey;
alter table public.downtime_entries            validate constraint downtime_entries_factory_id_fkey;
alter table public.production_records          validate constraint production_records_factory_id_fkey;
alter table public.production_shift_states     validate constraint production_shift_states_factory_id_fkey;
alter table public.production_progress_reports validate constraint production_progress_reports_factory_id_fkey;
alter table public.alert_acknowledgements      validate constraint alert_acknowledgements_factory_id_fkey;
alter table public.audit_log                   validate constraint audit_log_factory_id_fkey;

alter table public.machine_logs                validate constraint machine_logs_factory_machine_id_fkey;
alter table public.machine_status_history      validate constraint machine_status_history_factory_machine_id_fkey;
alter table public.downtime_entries            validate constraint downtime_entries_factory_machine_id_fkey;
alter table public.production_records          validate constraint production_records_factory_machine_id_fkey;
alter table public.production_shift_states     validate constraint production_shift_states_factory_machine_id_fkey;
alter table public.production_progress_reports validate constraint production_progress_reports_factory_machine_id_fkey;
alter table public.model_processes             validate constraint model_processes_factory_model_id_fkey;
alter table public.system_settings_audit       validate constraint system_settings_audit_factory_setting_id_fkey;
alter table public.machines                    validate constraint machines_factory_production_model_fkey;
alter table public.machines                    validate constraint machines_factory_current_process_fkey;
alter table public.user_machine_assignments    validate constraint user_machine_assignments_machine_fkey;

commit;
