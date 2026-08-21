-- 로컬/격리 브라우저 검증용 시드
--
-- 계약: docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.md 8절 V8(Browser/i18n)
--
-- ## 이 파일은 로컬 전용이다
--
-- 운영에 적용하지 않는다. ALV 는 계약 7절 P5(H7 승인)의 대상이므로 **운영에서는** 만들지
-- 않지만, 로컬에서는 교차 공장 격리를 실제로 보려면 두 공장이 있어야 한다.
--
-- ## auth.users 는 여기서 만들지 않는다
--
-- Supabase Auth admin API 로 먼저 만든다(비밀번호 해시·확인 상태를 API 가 관리한다).
-- 이 스크립트는 그 사용자에 프로필과 membership 을 붙일 뿐이다. 아래 이메일로 조회하므로
-- 사용자가 없으면 조용히 건너뛰지 않고 실패한다 — 시드가 반쯤 된 상태가 가장 헷갈린다.

begin;

-- ---------------------------------------------------------------------------
-- ALV 공장 (로컬 전용)
-- ---------------------------------------------------------------------------
insert into public.factories (id, code, name, timezone, default_language, is_active)
values ('22222222-2222-2222-2222-222222222222', 'ALV', 'ALMUS VINA', 'Asia/Ho_Chi_Minh', 'vi', true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- 도메인 매핑
-- ---------------------------------------------------------------------------
-- localhost 를 ALT 로 바인딩한다. 이래야 host 해석 경로가 실제로 동작하는 것을 브라우저에서
-- 볼 수 있다 — 단일 membership 우회 경로가 아니라 계약이 정한 1~3단계를 탄다.
insert into public.factory_domains (factory_id, hostname, is_primary, is_active)
values
  ((select id from public.factories where code='ALT'), 'localhost', true, true),
  ((select id from public.factories where code='ALT'), '127.0.0.1', false, true)
on conflict (hostname) do nothing;

-- ---------------------------------------------------------------------------
-- 사용자 프로필과 membership
-- ---------------------------------------------------------------------------
do $$
declare
  v_admin uuid;
  v_op    uuid;
  v_alt   uuid := (select id from public.factories where code='ALT');
begin
  select id into v_admin from auth.users where email = 'alt-admin@example.com';
  select id into v_op    from auth.users where email = 'alt-op@example.com';

  if v_admin is null or v_op is null then
    raise exception '시드 사용자가 없다. Auth admin API 로 먼저 만들어야 한다.';
  end if;

  -- user_profiles 는 전역 신원이다(계약 4.1). role 컬럼은 전환 기간 호환용으로만 채운다 —
  -- 권한의 원천은 factory_memberships 다.
  insert into public.user_profiles (user_id, name, role, email, is_active, language)
  values
    (v_admin, 'ALT 관리자', 'admin',    'alt-admin@example.com', true, 'ko'),
    (v_op,    'ALT 작업자', 'operator', 'alt-op@example.com',    true, 'ko')
  on conflict (user_id) do update
    set name = excluded.name, role = excluded.role, is_active = true;

  insert into public.factory_memberships (factory_id, user_id, role, is_active)
  values (v_alt, v_admin, 'admin', true), (v_alt, v_op, 'operator', true)
  on conflict (factory_id, user_id) do update
    set role = excluded.role, is_active = true;
end $$;

-- ---------------------------------------------------------------------------
-- 마스터 데이터 — 같은 이름을 두 공장에 둔다
-- ---------------------------------------------------------------------------
-- 계약 8절 고정 fixture: "두 공장에 동일한 machine/model/date/shift 와 서로 다른 생산값".
-- 이름이 같아야 격리가 실제로 이름이 아니라 factory_id 로 이뤄지는지 볼 수 있다.
insert into public.product_models (id, factory_id, model_name, is_active)
values
  ('d0000000-0000-4000-8000-000000000001', (select id from public.factories where code='ALT'), 'MODEL-A', true),
  ('d0000000-0000-4000-8000-000000000002', '22222222-2222-2222-2222-222222222222',            'MODEL-A', true)
on conflict (id) do nothing;

insert into public.model_processes (id, factory_id, model_id, process_name, process_order, tact_time_seconds, cavity_count)
values
  ('e0000000-0000-4000-8000-000000000001', (select id from public.factories where code='ALT'), 'd0000000-0000-4000-8000-000000000001', 'CNC1', 1, 576, 2),
  ('e0000000-0000-4000-8000-000000000002', '22222222-2222-2222-2222-222222222222',            'd0000000-0000-4000-8000-000000000002', 'CNC1', 1, 576, 2)
on conflict (id) do nothing;

insert into public.machines (id, factory_id, name, location, equipment_type, is_active, current_state, production_model_id, current_process_id)
values
  ('f0000000-0000-4000-8000-00000000a001', (select id from public.factories where code='ALT'), 'CNC-001', 'A동', 'CNC', true, 'NORMAL_OPERATION', 'd0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001'),
  ('f0000000-0000-4000-8000-00000000a002', (select id from public.factories where code='ALT'), 'CNC-002', 'A동', 'CNC', true, 'BREAKDOWN_REPAIR', 'd0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001'),
  -- ALV 도 같은 이름을 쓴다. 전역 UNIQUE 가 남아 있었다면 여기서 실패한다.
  ('f0000000-0000-4000-8000-00000000b001', '22222222-2222-2222-2222-222222222222', 'CNC-001', 'B동', 'CNC', true, 'NORMAL_OPERATION', 'd0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000002')
on conflict (id) do nothing;

-- 작업자 담당 설비 (ALT 의 CNC-001 만)
insert into public.user_machine_assignments (factory_id, user_id, machine_id, is_active)
select (select id from public.factories where code='ALT'),
       (select id from auth.users where email='alt-op@example.com'),
       'f0000000-0000-4000-8000-00000000a001', true
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 생산 실적 — 같은 날짜·교대, 서로 다른 값
-- ---------------------------------------------------------------------------
-- 값이 달라야 화면에 섞였을 때 바로 보인다. 같은 값이면 격리 실패를 눈으로 못 잡는다.
insert into public.production_records
  (factory_id, machine_id, date, shift, planned_runtime, actual_runtime, ideal_runtime,
   output_qty, defect_qty, availability, performance, quality, oee, tact_time_seconds, cavity_count)
values
  ((select id from public.factories where code='ALT'), 'f0000000-0000-4000-8000-00000000a001',
   current_date, 'A', 660, 600, 576, 60, 2, 0.9091, 0.9600, 0.9667, 0.8438, 576, 2),
  ((select id from public.factories where code='ALT'), 'f0000000-0000-4000-8000-00000000a002',
   current_date, 'A', 660, 480, 432, 45, 5, 0.7273, 0.9000, 0.8889, 0.5818, 576, 2),
  -- ALV: 같은 날짜·교대·설비명이지만 전혀 다른 값
  ('22222222-2222-2222-2222-222222222222', 'f0000000-0000-4000-8000-00000000b001',
   current_date, 'A', 660, 300, 192, 20, 0, 0.4545, 0.6400, 1.0000, 0.2909, 576, 2)
on conflict (machine_id, date, shift) do nothing;

-- ---------------------------------------------------------------------------
-- 설정 — 공장마다 다른 회사명
-- ---------------------------------------------------------------------------
-- 브랜딩이 공장별로 갈리는지 화면에서 바로 확인할 수 있는 가장 단순한 지표다.
insert into public.system_settings (factory_id, category, setting_key, setting_value, default_value, data_type, is_active)
values
  ('22222222-2222-2222-2222-222222222222', 'general', 'company_name', '{"value":"ALMUS VINA"}', '{"value":""}', 'string', true)
on conflict do nothing;

commit;
