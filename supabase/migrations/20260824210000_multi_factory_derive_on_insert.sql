-- 쓰기 경로의 factory_id 를 **부모 행에서 유도**한다
--
-- ## 무엇이 깨져 있었나 (2026-08-24 브라우저 UI 검증에서 발견)
--
-- ALV 에서 생산 데이터를 저장하니 400 이 났다:
--
--   null value in column "factory_id" of relation "production_records"
--   violates not-null constraint
--
-- 조사해 보니 **공장 소유 테이블에 INSERT 하면서 factory_id 를 전혀 언급하지 않는 함수가
-- 12개**였다:
--
--   apply_machine_update, audit_role_change, audit_system_settings_change,
--   close_shift_upsert_v3, correct_open_downtime_reason, delete_production_record,
--   log_machine_status_change, report_shift_progress, save_daily_production,
--   toggle_machine_downtime, update_system_setting, upsert_downtime_entry
--
-- 즉 **모든 쓰기 경로가 깨져 있었다.** NOT NULL 이 시끄럽게 막아 준 덕에 조용한 오염은
-- 없었지만, 앱은 아무것도 저장할 수 없는 상태였다.
--
-- ## 왜 함수마다 인자를 늘리지 않는가
--
-- CLAUDE.md: 인자 목록이 다르면 `create or replace` 가 오버로드를 만들고, 옛 함수를 DROP
-- 하면 마이그레이션과 배포 사이에 "함수 없음" 창이 생긴다. 12개 함수에 그 절차를 12번
-- 반복하는 것은 위험도 12배다.
--
-- 그리고 인자로 받으면 **호출자마다 빠뜨릴 기회**가 생긴다. 실제로 그렇게 빠뜨려서 여기까지
-- 왔다.
--
-- ## 부모에서 유도하는 것이 왜 짐작이 아닌가
--
-- 이 테이블들의 factory 는 **모호하지 않다**:
--
--   production_records, machine_logs, machine_status_history, downtime_entries,
--   production_shift_states, production_progress_reports  ->  machine_id 로 결정
--   system_settings_audit                                  ->  setting_id 로 결정
--
-- `machines.id` 는 PK 라 전역 유일하고, 그 행의 factory_id 는 NOT NULL 이며 변하지 않는다.
-- 그래서 "이 설비의 공장"은 추측이 아니라 **조회**다.
--
-- 요청이 준 값을 믿는 것과도 다르다. 유도의 출처는 요청이 아니라 **DB 안의 부모 행**이다.
--
-- ## 명시적으로 준 값은 건드리지 않는다
--
-- 트리거는 `factory_id IS NULL` 일 때만 채운다. 이미 채워져 있으면 그대로 두고, 그 값이
-- 부모와 어긋나면 **복합 FK 가 거부한다**(20260821110000). 즉 트리거는 편의이지 경계가
-- 아니며, 경계는 그대로 제약이 지킨다.
--
-- ## audit_log 는 여기서 다루지 않는다 — ⚠️ 이 판단은 틀렸다. 20260824220000 이 고쳤다.
--
-- 원래 여기에는 "`audit_log` 의 유일한 쓰기 경로인 `audit_role_change` 는 역할 변경을
-- 기록하므로 공장 귀속에 운영 결정이 필요하다"고 적혀 있었다. **둘 다 사실이 아니었다:**
--
--   - `audit_role_change` 라는 함수는 이 저장소에 존재하지 않는다.
--   - 실제 쓰기 경로는 `correct_open_downtime_reason`(비가동 사유 정정, 무조건)과
--     `close_shift_upsert_v3`(하향 마감)이다. 둘 다 운영 중인 기능이다.
--
-- 없는 함수를 근거로 예외 처리한 탓에, `audit_log.factory_id` 가 NOT NULL 이 된 뒤로
-- 비가동 사유 정정이 100% 실패하고 하향 마감이 트랜잭션째 롤백되는 상태였다.
-- 20260824220000 이 (table_name, record_id) 로 부모를 되짚는 트리거를 달아 닫았다.
--
-- 교훈: **"쓰기 경로가 하나뿐"이라는 주장은 세어 보고 적어야 한다.** 이 주석은 세지 않고
-- 적었고, 그래서 두 개를 놓쳤다.

begin;

/**
 * 설비로부터 공장을 유도한다.
 *
 * `new.machine_id` 가 NULL 이면 아무것도 하지 않는다 — 그런 행이 있어도 되는지는 각
 * 테이블의 제약이 판단할 일이지 이 트리거가 정할 일이 아니다.
 */
create or replace function public.derive_factory_from_machine()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.factory_id is null and new.machine_id is not null then
    select m.factory_id into new.factory_id
    from public.machines m
    where m.id = new.machine_id;
  end if;
  return new;
end $$;

/**
 * 설정 행으로부터 공장을 유도한다(감사 기록).
 */
create or replace function public.derive_factory_from_setting()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.factory_id is null and new.setting_id is not null then
    select s.factory_id into new.factory_id
    from public.system_settings s
    where s.id = new.setting_id;
  end if;
  return new;
end $$;

-- 설비를 부모로 갖는 테이블들
do $$
declare
  t text;
begin
  foreach t in array array[
    'production_records',
    'machine_logs',
    'machine_status_history',
    'downtime_entries',
    'production_shift_states',
    'production_progress_reports'
  ]
  loop
    execute format('drop trigger if exists trg_%s_derive_factory on public.%I', t, t);
    -- BEFORE INSERT 여야 한다. AFTER 면 NOT NULL 검사가 먼저 돌아 이미 실패한 뒤다.
    execute format(
      'create trigger trg_%s_derive_factory before insert on public.%I '
      'for each row execute function public.derive_factory_from_machine()', t, t);
  end loop;
end $$;

drop trigger if exists trg_system_settings_audit_derive_factory on public.system_settings_audit;
create trigger trg_system_settings_audit_derive_factory
  before insert on public.system_settings_audit
  for each row execute function public.derive_factory_from_setting();

revoke all on function public.derive_factory_from_machine() from public, anon, authenticated;
revoke all on function public.derive_factory_from_setting() from public, anon, authenticated;

/**
 * 유도가 실제로 동작하는지 확인한다.
 *
 * 마이그레이션이 "적용됐다"와 "동작한다"는 다르다. 트리거는 이름만 맞고 아무것도 안 할 수
 * 있다(조건이 틀렸거나, AFTER 로 걸렸거나). 실제로 factory_id 없이 한 행을 넣어 본다.
 */
do $$
declare
  v_machine uuid;
  v_expected uuid;
  v_got uuid;
  v_rec uuid;
begin
  select id, factory_id into v_machine, v_expected from public.machines limit 1;
  if v_machine is null then
    raise notice 'SKIP: 설비가 없어 유도를 확인할 수 없다';
    return;
  end if;

  insert into public.production_records (machine_id, date, shift, output_qty)
  values (v_machine, date '1900-01-01', 'A', 0)
  returning record_id, factory_id into v_rec, v_got;

  if v_got is distinct from v_expected then
    raise exception 'factory_id 유도 실패: 기대 % / 실제 %', v_expected, v_got;
  end if;

  delete from public.production_records where record_id = v_rec;
  raise notice 'PASS: factory_id 가 설비에서 유도된다';
end $$;

commit;
