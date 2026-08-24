-- 복합 FK 로 대체된 낡은 단일 컬럼 FK 제거
--
-- ## 왜 필요한가 — 실측된 전면 장애
--
-- expand 마이그레이션이 복합 FK 를 **추가**하면서 기존 단일 컬럼 FK 를 **남겨 두었다.**
-- 그 결과 자식↔부모 사이에 관계가 둘이 되고, PostgREST 는 어느 쪽으로 embed 할지 몰라
-- 거부한다:
--
--   {"code":"PGRST201",
--    "details":[{"relationship":"production_records_factory_machine_id_fkey using
--                production_records(factory_id, machine_id) and machines(factory_id, id)"},
--               {"relationship":"production_records_machine_id_fkey using
--                production_records(machine_id) and machines(id)"}]}
--
-- `machines!inner(...)` 형태의 embed 를 쓰는 **모든 Route 가 500** 이 된다. 실측으로
-- `/api/production-records` 와 `/api/alerts` 가 대시보드를 통째로 비웠다.
--
-- 전역 UNIQUE(name) 잔존과 **똑같은 형태의 실수**다 — 새 제약을 더하면서 낡은 것을 지우지
-- 않았다. 그때는 유일성이, 이번엔 관계가 중복됐다. 마이그레이션 SQL·계약 테스트 56건·
-- psql 격리 테스트가 모두 통과했다. PostgREST 를 실제로 쳐야만 드러난다.
--
-- ## 무결성은 약해지지 않는다
--
-- 복합 FK 는 단일 FK 보다 **엄격하다**. `(factory_id, machine_id) -> machines(factory_id, id)`
-- 가 참이면 `machine_id -> machines(id)` 도 반드시 참이다. 그러니 단일 FK 는 이제 잉여다.
--
-- ## ON DELETE CASCADE 는 복합 FK 로 옮긴다
--
-- 낡은 FK 대부분이 `on delete cascade` 를 달고 있었다. 그것까지 함께 지우면 설비를 지울 때
-- 자식 행이 남아 삭제가 막힌다. 그래서 복합 FK 를 **cascade 를 붙여 재생성**한다.
--
-- 삭제 규칙까지 옮겨야 한다는 것이 이 마이그레이션의 핵심이다. 제약을 갈아끼울 때
-- 사라지기 쉬운 것은 존재 여부가 아니라 **부가 동작**이다.
--
-- ## machines 의 부모 참조는 cascade 를 쓰지 않았다
--
-- `production_model_id` / `current_process_id` 의 기존 FK 에는 삭제 규칙이 없다(모델을
-- 지운다고 설비를 지우면 안 된다). 그래서 그쪽 복합 FK 는 규칙 없이 둔다.

begin;

-- ---------------------------------------------------------------------------
-- 1. 설비를 참조하는 사실 테이블 — 복합 FK 에 cascade 를 얹고 단일 FK 제거
-- ---------------------------------------------------------------------------
alter table public.machine_logs drop constraint if exists machine_logs_factory_machine_id_fkey;
alter table public.machine_logs add constraint machine_logs_factory_machine_id_fkey
  foreign key (factory_id, machine_id) references public.machines(factory_id, id)
  on delete cascade;
alter table public.machine_logs drop constraint if exists machine_logs_machine_id_fkey;

alter table public.machine_status_history drop constraint if exists machine_status_history_factory_machine_id_fkey;
alter table public.machine_status_history add constraint machine_status_history_factory_machine_id_fkey
  foreign key (factory_id, machine_id) references public.machines(factory_id, id)
  on delete cascade;
alter table public.machine_status_history drop constraint if exists machine_status_history_machine_id_fkey;

alter table public.downtime_entries drop constraint if exists downtime_entries_factory_machine_id_fkey;
alter table public.downtime_entries add constraint downtime_entries_factory_machine_id_fkey
  foreign key (factory_id, machine_id) references public.machines(factory_id, id)
  on delete cascade;
alter table public.downtime_entries drop constraint if exists downtime_entries_machine_id_fkey;

alter table public.production_records drop constraint if exists production_records_factory_machine_id_fkey;
alter table public.production_records add constraint production_records_factory_machine_id_fkey
  foreign key (factory_id, machine_id) references public.machines(factory_id, id)
  on delete cascade;
alter table public.production_records drop constraint if exists production_records_machine_id_fkey;

alter table public.production_shift_states drop constraint if exists production_shift_states_factory_machine_id_fkey;
alter table public.production_shift_states add constraint production_shift_states_factory_machine_id_fkey
  foreign key (factory_id, machine_id) references public.machines(factory_id, id)
  on delete cascade;
alter table public.production_shift_states drop constraint if exists production_shift_states_machine_id_fkey;

alter table public.production_progress_reports drop constraint if exists production_progress_reports_factory_machine_id_fkey;
alter table public.production_progress_reports add constraint production_progress_reports_factory_machine_id_fkey
  foreign key (factory_id, machine_id) references public.machines(factory_id, id)
  on delete cascade;
alter table public.production_progress_reports drop constraint if exists production_progress_reports_machine_id_fkey;

-- ---------------------------------------------------------------------------
-- 2. 모델/공정/설정 참조
-- ---------------------------------------------------------------------------
alter table public.model_processes drop constraint if exists model_processes_factory_model_id_fkey;
alter table public.model_processes add constraint model_processes_factory_model_id_fkey
  foreign key (factory_id, model_id) references public.product_models(factory_id, id)
  on delete cascade;
alter table public.model_processes drop constraint if exists model_processes_model_id_fkey;

alter table public.system_settings_audit drop constraint if exists system_settings_audit_factory_setting_id_fkey;
alter table public.system_settings_audit add constraint system_settings_audit_factory_setting_id_fkey
  foreign key (factory_id, setting_id) references public.system_settings(factory_id, id)
  on delete cascade;
alter table public.system_settings_audit drop constraint if exists system_settings_audit_setting_id_fkey;

-- machines 의 부모 참조. 기존 FK 에 삭제 규칙이 없었으므로 그대로 둔다.
alter table public.machines drop constraint if exists machines_production_model_id_fkey;
alter table public.machines drop constraint if exists machines_current_process_id_fkey;

-- ---------------------------------------------------------------------------
-- 3. 확인
-- ---------------------------------------------------------------------------
-- 같은 (자식, 부모) 쌍에 FK 가 둘 이상 남아 있으면 PostgREST embed 가 또 깨진다.
-- `auth.users` 를 두 번 참조하는 경우(created_by/updated_by 처럼 **역할이 다른** 참조)는
-- 정상이므로 public 스키마 안의 쌍만 본다.
do $$
declare
  r record;
  v_bad int := 0;
begin
  for r in
    select conrelid::regclass::text as child, confrelid::regclass::text as parent, count(*) as n
    from pg_constraint
    where contype = 'f'
      and connamespace = 'public'::regnamespace
      and confrelid::regclass::text not like 'auth.%'
    group by conrelid, confrelid
    having count(*) > 1
  loop
    raise warning 'PostgREST embed 모호: % -> % (FK %개)', r.child, r.parent, r.n;
    v_bad := v_bad + 1;
  end loop;

  if v_bad = 0 then
    raise notice '중복 관계 없음 — embed 안전';
  else
    raise exception '중복 관계 %쌍이 남아 있다. PostgREST embed 가 PGRST201 로 실패한다', v_bad;
  end if;
end $$;

commit;
