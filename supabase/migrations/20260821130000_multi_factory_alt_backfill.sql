-- ALT/ALV 멀티테넌시 P1-4: ALT 공장 생성과 기존 데이터 backfill
--
-- 계약: docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.md 7절 P1-4 / 4.3
--
-- ## 왜 ALT 공장 row 는 지금 만들 수 있나
--
-- D3(제품/운영 결정)는 아직 미확정이지만, ALT 공장 자체의 값은 **운영 system_settings 에서
-- 실측**된다:
--
--   general.company_name     = 'ALMUS TECH'
--   general.timezone         = 'Asia/Ho_Chi_Minh'
--   general.default_language = 'vi'
--
-- 추측이 아니라 현재 운영이 실제로 쓰는 값이다. 계약 1절이 금지하는 것은 근거 없는 추측이지
-- 실측값 사용이 아니다.
--
-- **hostname 은 만들지 않는다.** `factory_domains` 는 비워 둔다 — 도메인 바인딩은 D3 미확정
-- 이고, 틀린 바인딩은 곧 잘못된 공장에 쓰기다. 도메인 없이도 backfill 과 격리 검증은 된다.
--
-- **membership 도 만들지 않는다.** 사용자 15명의 공장 배정은 사람 결정이다(H1).
--
-- ## orphan 처리
--
-- 계약 4.3: "orphan 은 근거 없이 ALT 로 귀속하지 않고 quarantine/report 후 사람 결정으로
-- 보상한다."
--
-- 이 시점의 DB 에는 공장이 ALT 하나뿐이므로 모든 기존 행이 ALT 다 — 이것은 추측이 아니라
-- 동어반복이다. 그러나 **부모에서 파생할 수 없는 행**은 다르다. 아래 backfill 은 사실
-- 테이블의 factory_id 를 부모(machines / product_models / system_settings)에서 가져오므로,
-- 부모가 없는 자식은 자연스럽게 NULL 로 남는다. 그 잔여를 마지막에 보고한다.

begin;

-- ---------------------------------------------------------------------------
-- 1. ALT 공장
-- ---------------------------------------------------------------------------
-- 고정 UUID 를 쓴다. 재실행·재현·문서 참조에서 같은 값이어야 추적이 가능하다.
insert into public.factories (id, code, name, timezone, default_language, is_active)
values (
  '00000000-0000-4000-8000-00000000a17e',  -- 'ALT' 를 담은 안정적 식별자
  'ALT',
  'ALMUS TECH',
  'Asia/Ho_Chi_Minh',
  'vi',
  true
)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 2. 부모부터 채운다
-- ---------------------------------------------------------------------------
-- 순서가 중요하다. 자식이 부모에서 factory_id 를 파생하므로 부모가 먼저 채워져야 한다.
-- 복합 FK 가 NOT VALID 라 순서를 어겨도 즉시 실패하지는 않지만, 그때는 자식이 NULL 로
-- 남아 조용히 누락된다.
update public.product_models
   set factory_id = (select id from public.factories where code = 'ALT')
 where factory_id is null;

update public.system_settings
   set factory_id = (select id from public.factories where code = 'ALT')
 where factory_id is null;

update public.machine_status_descriptions
   set factory_id = (select id from public.factories where code = 'ALT')
 where factory_id is null;

-- ---------------------------------------------------------------------------
-- 3. 부모에서 파생하는 자식
-- ---------------------------------------------------------------------------
update public.model_processes mp
   set factory_id = pm.factory_id
  from public.product_models pm
 where mp.model_id = pm.id and mp.factory_id is null;

update public.machines
   set factory_id = (select id from public.factories where code = 'ALT')
 where factory_id is null;

update public.system_settings_audit ssa
   set factory_id = ss.factory_id
  from public.system_settings ss
 where ssa.setting_id = ss.id and ssa.factory_id is null;

-- 설비에서 파생하는 사실 테이블들.
-- 여기서 machines 를 조인하는 것이 핵심이다 — 상수로 ALT 를 넣으면 "부모에서 파생"이
-- 아니라 "전부 ALT 라고 가정"이 되고, 그것은 계약이 금지하는 무근거 귀속이다.
update public.machine_logs ml
   set factory_id = m.factory_id
  from public.machines m
 where ml.machine_id = m.id and ml.factory_id is null;

update public.machine_status_history msh
   set factory_id = m.factory_id
  from public.machines m
 where msh.machine_id = m.id and msh.factory_id is null;

update public.downtime_entries de
   set factory_id = m.factory_id
  from public.machines m
 where de.machine_id = m.id and de.factory_id is null;

-- `production_records` 의 UPDATE 는 트리거를 깨운다 — 그리고 그 트리거는 교대 상태를
-- 다시 쓴다(20260715160000 의 `sync_production_shift_state_after_write`):
--
--   INSERT INTO production_shift_states (...) VALUES (..., 'WORKING')
--   ON CONFLICT DO UPDATE SET status=..., updated_at=clock_timestamp(), version=version+1
--
-- factory_id 만 채우는 이 UPDATE 는 교대 상태와 아무 상관이 없는데, 그대로 두면
-- **55,782행의 `updated_at` 과 `version` 이 바뀐다.** 결과는 두 가지로 나쁘다:
--
--   1. 아무도 손대지 않은 교대가 "방금 수정됨"으로 보인다. 나중에 "누가 이걸 바꿨나"를
--      되짚을 때 이 마이그레이션이 모든 흔적을 덮어쓴 상태다.
--   2. `version` 은 낙관적 동시성(CAS)의 지문이다. 전부 밀리면 그 순간 화면을 열어 둔
--      사용자는 저장할 때 영문 모를 충돌을 맞는다.
--
-- 상태 값 자체가 뒤집힐 위험은 데이터가 배제한다 — 2026-08-24 실측으로 "비-WORKING 인데
-- 생산기록이 있는" 교대는 0건이다. 그래도 위 두 부작용은 남으므로 트리거를 잠시 끈다.
-- (같은 트리거 때문에 유령 행이 생겼던 전례가 있다: 2026-07-16 데이터 정리.)
--
-- 트리거 이름이 없을 수도 있으므로 존재를 확인하고 끈다. `disable trigger` 는 이 트랜잭션
-- 안에서만 유효하지 않다 — 아래에서 반드시 되돌린다. 마이그레이션 전체가 begin/commit 로
-- 감싸져 있어 중간 실패 시에도 원래 상태로 돌아간다.
do $$
begin
  if exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'production_records'
      and t.tgname = 'sync_production_shift_state_after_write'
  ) then
    alter table public.production_records
      disable trigger sync_production_shift_state_after_write;
  end if;
end $$;

update public.production_records pr
   set factory_id = m.factory_id
  from public.machines m
 where pr.machine_id = m.id and pr.factory_id is null;

do $$
begin
  if exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'production_records'
      and t.tgname = 'sync_production_shift_state_after_write'
  ) then
    alter table public.production_records
      enable trigger sync_production_shift_state_after_write;
  end if;
end $$;

update public.production_shift_states pss
   set factory_id = m.factory_id
  from public.machines m
 where pss.machine_id = m.id and pss.factory_id is null;

update public.production_progress_reports ppr
   set factory_id = m.factory_id
  from public.machines m
 where ppr.machine_id = m.id and ppr.factory_id is null;

-- ---------------------------------------------------------------------------
-- 4. 부모가 없는 테이블
-- ---------------------------------------------------------------------------
-- alert_acknowledgements 와 audit_log 는 설비/설정 부모가 없다(alert_key 는 문자열,
-- audit_log 는 table_name+record_id 다형 참조). 이 시점에 공장이 하나뿐이므로 ALT 다.
update public.alert_acknowledgements
   set factory_id = (select id from public.factories where code = 'ALT')
 where factory_id is null;

update public.audit_log
   set factory_id = (select id from public.factories where code = 'ALT')
 where factory_id is null;

-- ---------------------------------------------------------------------------
-- 5. 잔여 보고
-- ---------------------------------------------------------------------------
-- 남은 NULL 은 부모가 없는 자식 = orphan 이다. 조용히 ALT 로 덮지 않고 **알린다.**
-- 계약 4.3 이 요구하는 quarantine/report 의 최소 형태다.
--
-- 예외를 던지지 않는 이유: 이 마이그레이션의 일은 근거 있는 것을 채우는 것이지 판정이
-- 아니다. orphan 이 있으면 사람이 보고 결정해야 하며, 그 결정 전에 contract(NOT NULL)로
-- 넘어가면 안 된다 — contract 가 실패하는 것으로 그 게이트가 강제된다.
do $$
declare
  r record;
  total bigint := 0;
begin
  for r in
    select 'machine_logs' as t, count(*) as n from public.machine_logs where factory_id is null
    union all select 'machine_status_history', count(*) from public.machine_status_history where factory_id is null
    union all select 'downtime_entries', count(*) from public.downtime_entries where factory_id is null
    union all select 'production_records', count(*) from public.production_records where factory_id is null
    union all select 'production_shift_states', count(*) from public.production_shift_states where factory_id is null
    union all select 'production_progress_reports', count(*) from public.production_progress_reports where factory_id is null
    union all select 'model_processes', count(*) from public.model_processes where factory_id is null
    union all select 'system_settings_audit', count(*) from public.system_settings_audit where factory_id is null
  loop
    if r.n > 0 then
      raise warning 'ORPHAN: %.factory_id 가 %건 비어 있다 — 부모를 찾을 수 없다', r.t, r.n;
      total := total + r.n;
    end if;
  end loop;

  if total = 0 then
    raise notice 'backfill 완료: orphan 0건';
  else
    raise warning 'backfill 완료: orphan 총 %건. contract(NOT NULL) 전에 사람 결정이 필요하다', total;
  end if;
end $$;

commit;
