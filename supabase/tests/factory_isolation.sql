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
insert into public.factories (id, code, name, timezone, default_language)
values ('22222222-2222-2222-2222-222222222222','ALV','ALMUS VINA','Asia/Ho_Chi_Minh','vi');

\set alt '(select id from public.factories where code=''ALT'')'

insert into public.machines (id, factory_id, name)
values ('aaaaaaaa-0000-0000-0000-000000000001', (select id from public.factories where code='ALT'), 'ISO-TEST-01');
insert into public.machines (id, factory_id, name)
values ('bbbbbbbb-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','ISO-TEST-01');

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
  values ('22222222-2222-2222-2222-222222222222','aaaaaaaa-0000-0000-0000-000000000001','2026-08-21','A',10);
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
  values ('cccccccc-0000-0000-0000-000000000001','22222222-2222-2222-2222-222222222222','ISO-MODEL-X');
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
  values ('22222222-2222-2222-2222-222222222222','general','company_name','{"value":"ALMUS VINA"}','{"value":""}');
  raise notice 'PASS: 같은 설정 키가 다른 공장에 공존 가능';
exception when unique_violation then raise notice 'FAIL: 전역 설정 유일성이 남아 있다'; end $$;
rollback to sp8;

rollback;
