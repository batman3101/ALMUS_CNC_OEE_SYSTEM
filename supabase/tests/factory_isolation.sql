-- 공장 격리 negative test (로컬/격리 staging 전용)
--
-- 계약: docs/workflows/GRAPH_ALT_ALV_MULTI_FACTORY.md 8절 V1/V2
--
-- ## 실행
--
--   npx supabase start                     # baseline + 전체 마이그레이션 적용
--   docker exec -i supabase_db_CNC_OEE --     psql -U postgres -d postgres -q -f - < supabase/tests/factory_isolation.sql
--
-- 전부 `PASS` 여야 한다. 마지막에 rollback 하므로 데이터는 남지 않는다.
--
-- ## 왜 이 파일이 필요한가
--
-- 정적 검사(`__tests__/factoryScopeLedger.test.ts` 47건)는 "규약이 SQL 에 적혀 있는가"를
-- 확인한다. 이 파일은 "실제로 그렇게 동작하는가"를 확인한다. 둘은 다른 질문이고, 실제로
-- 이 파일만이 잡은 결함이 둘 있었다:
--
--   1. 전역 UNIQUE(name) 잔존 — 공장 범위 UNIQUE 를 추가했지만 낡은 것을 지우지 않아
--      ALT/ALV 가 같은 설비명을 쓸 수 없었다. "추가했다"는 grep 되지만 "남아 있다"는
--      넣어 봐야 안다.
--   2. 트리거가 factory_id 를 채우지 않음 — contract 적용 후 **정상 생산기록 저장이
--      실패**했다. 스키마만 factory-aware 가 되면 앱이 아예 동작하지 않는다.
--
-- 새 격리 규약을 추가할 때는 이 파일에도 케이스를 더한다.

begin;
-- ALT 는 backfill 이 이미 만들었다. ALV 만 추가한다.
-- 시드(seed_browser_check.sql)가 이미 ALV 를 만들었을 수 있다. 이 파일은 시드 유무와
-- 무관하게 돌아야 하므로 멱등하게 둔다.
insert into public.factories (id, code, name, timezone, default_language)
values ('22222222-2222-2222-2222-222222222222','ALV','ALMUS VINA','Asia/Ho_Chi_Minh','vi')
on conflict (code) do nothing;

\set alt '(select id from public.factories where code=''ALT'')'

insert into public.machines (id, factory_id, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', (select id from public.factories where code='ALT'), 'ISO-TEST-01')
on conflict (id) do nothing;
insert into public.machines (id, factory_id, name)
values ('bbbbbbbb-0000-0000-0000-000000000001', (select id from public.factories where code='ALV'), 'ISO-TEST-01')
on conflict (id) do nothing;

\echo '=== 1) 같은 설비명이 두 공장에 공존한다 (공장 범위 유일성) ==='
select f.code, m.name from public.machines m join public.factories f on f.id=m.factory_id
 where m.name='ISO-TEST-01' order by f.code;

\echo '=== 2) 같은 공장 안 중복 설비명 거부 ==='
savepoint sp1;
do $$ begin
  insert into public.machines (factory_id, name)
  values ((select id from public.factories where code='ALT'),'ISO-TEST-01');
  raise notice 'FAIL: 같은 공장 중복 설비명이 통과했다';
exception when unique_violation then raise notice 'PASS: 같은 공장 중복 설비명 거부됨'; end $$;
rollback to sp1;

\echo '=== 3) 교차 공장 생산기록 거부 (복합 FK) ==='
savepoint sp2;
do $$ begin
  insert into public.production_records (factory_id, machine_id, date, shift, output_qty)
  values ((select id from public.factories where code='ALV'),'aaaaaaaa-0000-0000-0000-000000000001','2026-08-21','A',10);
  raise notice 'FAIL: 교차 공장 생산기록이 통과했다';
exception when foreign_key_violation then raise notice 'PASS: 교차 공장 생산기록 거부됨'; end $$;
rollback to sp2;

\echo '=== 4) 동일 공장 생산기록 통과 ==='
savepoint sp3;
do $$ begin
  insert into public.production_records (factory_id, machine_id, date, shift, output_qty)
  values ((select id from public.factories where code='ALT'),'aaaaaaaa-0000-0000-0000-000000000001','2026-08-21','A',10);
  raise notice 'PASS: 동일 공장 생산기록 통과';
exception when others then raise notice 'FAIL: 동일 공장인데 거부됨 - %', sqlerrm; end $$;
rollback to sp3;

\echo '=== 5) factory_id 없는 행은 거부된다 (NOT NULL) ==='
savepoint sp4;
do $$ begin
  insert into public.machines (name) values ('ISO-TEST-NULL');
  raise notice 'FAIL: factory_id 없는 설비가 통과했다';
exception when not_null_violation then raise notice 'PASS: factory_id 없는 설비 거부됨'; end $$;
rollback to sp4;

\echo '=== 6) membership 없는 설비 배정 거부 ==='
savepoint sp5;
do $$ begin
  insert into public.user_machine_assignments (factory_id, user_id, machine_id)
  values ((select id from public.factories where code='ALT'), gen_random_uuid(), 'aaaaaaaa-0000-0000-0000-000000000001');
  raise notice 'FAIL: membership 없는 배정이 통과했다';
exception when foreign_key_violation then raise notice 'PASS: membership 없는 배정 거부됨'; end $$;
rollback to sp5;

\echo '=== 7) 실재하지 않는 공장 거부 ==='
savepoint sp6;
do $$ begin
  insert into public.machines (factory_id, name) values ('99999999-9999-9999-9999-999999999999','ISO-TEST-99');
  raise notice 'FAIL: 없는 공장이 통과했다';
exception when foreign_key_violation then raise notice 'PASS: 없는 공장 거부됨'; end $$;
rollback to sp6;

\echo '=== 8) 교차 공장 모델 지정 거부 ==='
savepoint sp7;
insert into public.product_models (id, factory_id, model_name)
  values ('cccccccc-0000-0000-0000-000000000001', (select id from public.factories where code='ALV'), 'ISO-MODEL-X')
  on conflict (id) do nothing;
do $$ begin
  update public.machines set production_model_id='cccccccc-0000-0000-0000-000000000001'
   where id='aaaaaaaa-0000-0000-0000-000000000001';
  raise notice 'FAIL: ALT 설비가 ALV 모델을 지정했다';
exception when foreign_key_violation then raise notice 'PASS: 교차 공장 모델 지정 거부됨'; end $$;
rollback to sp7;

\echo '=== 9) 같은 설정 키가 두 공장에 공존한다 ==='
savepoint sp8;
do $$ begin
  insert into public.system_settings (factory_id, category, setting_key, setting_value, default_value)
  values ((select id from public.factories where code='ALV'),'general','iso_test_key','{"value":"x"}','{"value":""}');
  insert into public.system_settings (factory_id, category, setting_key, setting_value, default_value)
  values ((select id from public.factories where code='ALT'),'general','iso_test_key','{"value":"y"}','{"value":""}');
  raise notice 'PASS: 같은 설정 키가 다른 공장에 공존 가능';
exception when unique_violation then raise notice 'FAIL: 전역 설정 유일성이 남아 있다'; end $$;
rollback to sp8;

rollback;

-- ---------------------------------------------------------------------------
-- RLS cutover 이후: 인자 없는 helper 의 fail-closed 성질
-- ---------------------------------------------------------------------------
-- 아래는 DB 제약이 아니라 **정책 술어**를 보는 검사다. 실제 JWT 로 PostgREST 를 치는
-- 검증(V2)은 supabase/tests/README 의 절차를 따르고, 여기서는 helper 자체의 성질만 본다.
\echo '=== 10) membership 이 없으면 current_user_factory() 는 NULL 이다 ==='
do $$
declare v uuid;
begin
  -- auth.uid() 가 NULL 인 컨텍스트(=인증 없음)에서는 매칭되는 membership 이 없다.
  select public.current_user_factory() into v;
  if v is null then
    raise notice 'PASS: 인증 없는 컨텍스트에서 NULL — factory_id = NULL 은 어떤 행과도 매치되지 않는다';
  else
    raise notice 'FAIL: 인증 없이 공장이 특정됐다 (%)', v;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 공장 범위 RPC (2026-08-24)
-- ---------------------------------------------------------------------------
-- 위 1~10 은 **제약**을 본다 — 잘못된 쓰기가 거부되는가. 아래는 **읽기·집계**를 본다.
-- 이 둘은 다른 종류의 실패다. 제약은 어긋나면 소리를 내지만, 집계가 두 공장을 합치면
-- 아무 소리도 나지 않는다. 그냥 숫자가 커질 뿐이다.
--
-- 왜 "합보다 작다"를 보는가: 각 공장 결과가 전체보다 작다는 것만으로는 부족하다(둘 다
-- 전체일 수도 있다). ALT + ALV = 전체 이면서 각각이 전체보다 작아야 진짜로 나뉜 것이다.

\echo '=== 11) 분석 RPC 가 공장별로 나뉜다 ==='
do $$
declare
  v_alt uuid := (select id from public.factories where code='ALT');
  v_alv uuid := (select id from public.factories where code='ALV');
  v_all bigint;
  v_a   bigint;
  v_b   bigint;
begin
  select total_records into v_all from public.analytics_oee_records_summary('2000-01-01');
  select total_records into v_a   from public.analytics_oee_records_summary_scoped(v_alt,'2000-01-01');
  select total_records into v_b   from public.analytics_oee_records_summary_scoped(v_alv,'2000-01-01');

  if v_all = 0 then
    raise notice 'SKIP: production_records 가 비어 있어 판정할 수 없다 (0 은 분리도 누수도 증명하지 못한다)';
  elsif v_a + v_b = v_all and v_a < v_all and v_b < v_all then
    raise notice 'PASS: 요약 통계가 분리됨 (전체 % = ALT % + ALV %)', v_all, v_a, v_b;
  else
    raise notice 'FAIL: 요약 통계가 새고 있다 (전체 % / ALT % / ALV %)', v_all, v_a, v_b;
  end if;
end $$;

-- 12·13 은 행을 만든다. 위 1~9 의 트랜잭션은 이미 rollback 되었으므로 여기서 새로 연다.
begin;

\echo '=== 12) 설비가 없는 공장은 빈 결과를 낸다 (NULL 이 아니라 빈 배열) ==='
-- 래퍼가 `p_machine_ids => NULL` 을 넘기면 원본은 "설비 조건 없음" = 전 공장으로 읽는다.
-- 설비가 하나도 없는 공장에서 그 실수가 일어나면 **다른 공장 전체**가 결과로 나온다.
-- 가장 조용한 형태의 누수라서 따로 못박는다.
do $$
declare
  v_empty uuid;
  v_ids uuid[];
  v_rows bigint;
begin
  -- timezone 은 NOT NULL 이고 기본값이 없다. 기존 공장의 값을 빌려 온다 — 여기에 상수를
  -- 적으면 이 파일이 두 번째 타임존 원본이 되고, 언젠가 실제 설정과 갈라진다.
  insert into public.factories (code, name, timezone, is_active)
  select 'ISOEMPTY', 'ISO 빈 공장', f.timezone, true
  from public.factories f where f.code = 'ALT'
  returning id into v_empty;

  select public.factory_machine_ids(v_empty, null) into v_ids;
  select count(*) into v_rows from public.analytics_oee_by_machine_scoped(v_empty, '2000-01-01');

  if v_ids = '{}'::uuid[] and v_rows = 0 then
    raise notice 'PASS: 설비 없는 공장 -> 빈 배열, 결과 0행';
  else
    raise notice 'FAIL: 설비 없는 공장이 %행을 돌려줬다 (ids=%)', v_rows, v_ids;
  end if;
end $$;

\echo '=== 13) 설정 쓰기가 다른 공장을 건드리지 않는다 ==='
do $$
declare
  v_alt uuid := (select id from public.factories where code='ALT');
  v_alv uuid := (select id from public.factories where code='ALV');
  v_alt_after text;
  v_alv_after text;
begin
  perform public.update_system_setting_scoped(v_alt,'general','iso_rpc_key','ALT_VALUE','iso');
  perform public.update_system_setting_scoped(v_alv,'general','iso_rpc_key','ALV_VALUE','iso');
  -- ALV 만 다시 쓴다. ALT 는 그대로여야 한다.
  perform public.update_system_setting_scoped(v_alv,'general','iso_rpc_key','ALV_CHANGED','iso');

  select setting_value->>'value' into v_alt_after
    from public.system_settings where factory_id=v_alt and category='general' and setting_key='iso_rpc_key';
  select setting_value->>'value' into v_alv_after
    from public.system_settings where factory_id=v_alv and category='general' and setting_key='iso_rpc_key';

  if v_alt_after = 'ALT_VALUE' and v_alv_after = 'ALV_CHANGED' then
    raise notice 'PASS: ALV 변경이 ALT 를 건드리지 않음 (ALT=% / ALV=%)', v_alt_after, v_alv_after;
  else
    raise notice 'FAIL: 설정 쓰기가 공장을 넘었다 (ALT=% / ALV=%)', v_alt_after, v_alv_after;
  end if;
end $$;

-- 검사용으로 만든 공장·설정은 남기지 않는다.
rollback;

-- ---------------------------------------------------------------------------
-- 공장 선택은 Route 와 RLS 가 함께 읽는다 (2026-08-24)
-- ---------------------------------------------------------------------------
-- 이 검사가 존재하는 이유: 선택이 쿠키에 있던 동안 **RLS 는 그것을 보지 못했다.** 그래서
-- 다중 소속 사용자의 화면이 두 공장을 섞었다 — 배지와 설비 수는 ALV, 교대 설정은 ALT.
--
-- 소속이 하나인 사용자에게는 나타나지 않는다. 정확히 이 기능을 쓰는 사람만 겪는 결함이라
-- "대충 돌려보기"로는 절대 안 잡힌다. 그래서 못박는다.

begin;

\echo '=== 14) current_user_factory() 가 저장된 선택을 따른다 ==='
do $$
declare
  v_user uuid;
  v_alt  uuid := (select id from public.factories where code = 'ALT');
  v_alv  uuid := (select id from public.factories where code = 'ALV');
  v_got  uuid;
begin
  -- 두 공장 모두에 활성 membership 이 있는 사용자가 필요하다. 없으면 이 검사는 성립하지
  -- 않는다 — "통과"로 위장하지 않고 건너뛴다고 말한다.
  select fm.user_id into v_user
  from public.factory_memberships fm
  where fm.is_active
  group by fm.user_id
  having count(distinct fm.factory_id) >= 2
  limit 1;

  if v_user is null then
    raise notice 'SKIP: 다중 소속 사용자가 없어 판정할 수 없다 (이 결함은 다중 소속에서만 난다)';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  insert into public.user_factory_selection (user_id, factory_id) values (v_user, v_alv)
    on conflict (user_id) do update set factory_id = excluded.factory_id;
  select public.current_user_factory() into v_got;

  if v_got = v_alv then
    raise notice 'PASS: RLS 헬퍼가 선택(ALV)을 따른다';
  else
    raise notice 'FAIL: ALV 를 골랐는데 RLS 는 % 를 본다 — Route 와 어긋난다', v_got;
  end if;

  update public.user_factory_selection set factory_id = v_alt where user_id = v_user;
  select public.current_user_factory() into v_got;
  if v_got = v_alt then
    raise notice 'PASS: 되돌리기도 따른다 (ALT)';
  else
    raise notice 'FAIL: ALT 로 되돌렸는데 RLS 는 % 를 본다', v_got;
  end if;

  perform set_config('request.jwt.claims', null, true);
end $$;

\echo '=== 15) 소속 밖 공장은 선택으로 저장되지 않는다 ==='
do $$
declare
  v_user uuid;
  v_other uuid;
begin
  -- 한 공장에만 속한 사용자를 찾아, 속하지 않은 공장을 선택해 본다.
  select fm.user_id into v_user
  from public.factory_memberships fm
  where fm.is_active
  group by fm.user_id
  having count(distinct fm.factory_id) = 1
  limit 1;

  if v_user is null then
    raise notice 'SKIP: 단일 소속 사용자가 없어 판정할 수 없다';
    return;
  end if;

  select f.id into v_other from public.factories f
  where f.id not in (
    select fm.factory_id from public.factory_memberships fm
    where fm.user_id = v_user and fm.is_active
  )
  limit 1;

  if v_other is null then
    raise notice 'SKIP: 이 사용자가 속하지 않은 공장이 없다';
    return;
  end if;

  begin
    insert into public.user_factory_selection (user_id, factory_id) values (v_user, v_other)
      on conflict (user_id) do update set factory_id = excluded.factory_id;
    raise notice 'FAIL: 소속 없는 공장이 선택으로 저장됐다';
  exception when check_violation then
    raise notice 'PASS: 소속 밖 공장 선택은 거부됨';
  end;
end $$;

-- 검사 흔적을 남기지 않는다.
rollback;

-- ---------------------------------------------------------------------------
-- 쓰기 경로의 factory_id 유도 (2026-08-24)
-- ---------------------------------------------------------------------------
-- 이 검사가 존재하는 이유: 공장 소유 테이블에 INSERT 하는 **12개 함수가 factory_id 를 전혀
-- 언급하지 않았다**(save_daily_production, close_shift_upsert_v3, upsert_downtime_entry,
-- toggle_machine_downtime, apply_machine_update, report_shift_progress ...).
--
-- NOT NULL 이 막아 준 덕에 조용한 오염은 없었지만, 앱은 **아무것도 저장할 수 없는 상태**
-- 였다. 브라우저에서 생산 데이터를 넣어 보고서야 드러났다.
--
-- 함수마다 인자를 늘리는 대신 부모 행에서 유도한다(20260824210000). 그 유도가 실제로
-- 동작하는지 여기서 못박는다 — 트리거는 이름만 맞고 아무것도 안 할 수 있다.

begin;

\echo '=== 16) factory_id 없이 INSERT 하면 설비에서 유도된다 ==='
do $$
declare
  v_machine uuid;
  v_expected uuid;
  v_got uuid;
begin
  select id, factory_id into v_machine, v_expected from public.machines limit 1;
  if v_machine is null then
    raise notice 'SKIP: 설비가 없어 판정할 수 없다';
    return;
  end if;

  insert into public.production_records (machine_id, date, shift, output_qty)
  values (v_machine, date '1900-01-01', 'A', 0)
  returning factory_id into v_got;

  if v_got = v_expected then
    raise notice 'PASS: production_records.factory_id 가 설비에서 유도됨';
  else
    raise notice 'FAIL: 기대 % / 실제 %', v_expected, v_got;
  end if;
end $$;

\echo '=== 17) 명시적으로 준 factory_id 는 덮어쓰지 않는다 ==='
-- 유도는 편의이지 경계가 아니다. 값이 이미 있으면 그대로 두고, 부모와 어긋나면 복합 FK 가
-- 거부한다 — 트리거가 "고쳐 주면" 잘못된 공장 쓰기가 조용히 성공하게 된다.
do $$
declare
  v_machine uuid;
  v_own uuid;
  v_other uuid;
begin
  select id, factory_id into v_machine, v_own from public.machines limit 1;
  select id into v_other from public.factories where id <> v_own limit 1;

  if v_machine is null or v_other is null then
    raise notice 'SKIP: 다른 공장이 없어 판정할 수 없다';
    return;
  end if;

  begin
    insert into public.production_records (factory_id, machine_id, date, shift, output_qty)
    values (v_other, v_machine, date '1900-01-02', 'A', 0);
    raise notice 'FAIL: 설비와 다른 공장으로 기록이 저장됐다';
  exception when foreign_key_violation then
    raise notice 'PASS: 설비와 다른 공장 지정은 복합 FK 가 거부';
  end;
end $$;

-- 검사 흔적을 남기지 않는다.
rollback;
