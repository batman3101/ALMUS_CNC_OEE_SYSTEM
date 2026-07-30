-- 익명(anon) 접근 표면 불변조건 (적대적 재감사 #1 · #10).
--
-- 실행: psql "$DATABASE_URL" -f supabase/tests/anon_access_invariants.sql
--   또는 에이전트 세션에서 MCP execute_sql 로 DO 블록 실행.
-- 판정: 'ALL_ANON_INVARIANTS_PASSED' 로 시작하는 예외면 성공. 그 외 예외는 위반 내용.
-- 이 스크립트는 **읽기 전용**이다(카탈로그 조회만). 마지막 예외는 다른 불변조건 파일과
-- 판정 방식을 맞추기 위한 것이다.
--
-- ## `npm run check:grants` 와의 분담 — 왜 둘 다 필요한가
--
-- 그 스크립트는 anon 키로 실제 HTTP 를 쏘는 블랙박스 검사다. 공격자와 같은 자리라 가장
-- 강한 증거지만, **휘발성(VOLATILE) 함수는 실행할 수 없다** — 인자를 맞춰 호출하는 순간
-- 함수 본문이 돌아 운영 데이터를 바꿀 수 있고, 이 프로젝트의 PostgREST 는
-- `Prefer: tx=rollback` 을 적용하지 않는다(실측). 그래서 그쪽은 테이블·비휘발성 RPC 만
-- 본다.
--
-- 이 파일은 SQL 을 쓸 수 있는 자리라 정반대의 강점을 가진다: `has_function_privilege` 로
-- **실행하지 않고** 모든 함수의 권한을 본다. 실제로 2026-07-29 감사에서 걸린
-- `get_system_setting`(SECURITY DEFINER 로 RLS 를 우회해 system_settings 를 읽는데 anon
-- EXECUTE 가 있었다)이 바로 휘발성이라, 블랙박스 검사만 있었다면 놓쳤을 항목이다.
--
-- ## 왜 열거하지 않는가
--
-- 직전 마이그레이션(150000)은 테이블 이름을 나열해 회수했고, 마이그레이션 밖에서 만들어진
-- 백업 테이블 4개가 목록에 없어 익명에게 열린 채 남았다(3,850행 생산 데이터 포함).
-- 여기서는 pg_class·pg_proc 를 **전수** 훑는다. 새 객체가 생기면 자동으로 검사 대상이
-- 되므로, 다음번 드리프트는 조용히 지나가지 못한다.

do $$
declare
  v_bad text;
  v_count integer;
begin
  -- [A1] public 스키마의 어떤 테이블·뷰도 anon 권한을 가지지 않는다.
  select string_agg(c.relname || ' (' || a::text || ')', ', ' order by c.relname), count(*)
    into v_bad, v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral unnest(coalesce(c.relacl, acldefault('r', c.relowner))) a
  where n.nspname = 'public'
    and c.relkind in ('r', 'v', 'm', 'p', 'f')
    and a::text like 'anon=%';
  if v_count > 0 then
    raise exception 'A1 anon 이 접근 가능한 테이블/뷰 %개: %', v_count, v_bad;
  end if;

  -- [A2] 프로젝트 함수 중 anon 이 EXECUTE 할 수 있는 것이 없다.
  --
  -- 확장(btree_gist 등)이 소유한 함수는 제외한다 — gbt_* 수백 개는 인덱스 연산자 클래스의
  -- 내부 구현이고, 회수하면 확장이 깨질 수 있으며 보안상 얻는 것도 없다(익명이 호출해도
  -- 얻을 정보가 없는 순수 함수다). pg_depend 로 확장 소속을 판별하므로 이름 패턴에
  -- 의존하지 않는다.
  select string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
                    ', ' order by p.proname), count(*)
    into v_bad, v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prokind = 'f'
    and has_function_privilege('anon', p.oid, 'EXECUTE')
    and not exists (
      select 1 from pg_depend d
      where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
    );
  if v_count > 0 then
    raise exception 'A2 anon 이 실행 가능한 프로젝트 함수 %개: %', v_count, v_bad;
  end if;

  -- [A3] postgres 가 만드는 미래 객체의 기본 ACL 에 anon 이 없다.
  --
  -- 이게 없으면 다음에 만드는 테이블이 다시 익명에게 열린 채로 태어난다. 150000 은 tables
  -- 만 닫았고 sequence·function 은 열려 있었다(실측).
  select string_agg(
           coalesce(dn.nspname, '(all)') || '/' ||
           case d.defaclobjtype when 'r' then 'table' when 'S' then 'sequence'
                                when 'f' then 'function' else d.defaclobjtype::text end,
           ', '),
         count(*)
    into v_bad, v_count
  from pg_default_acl d
  left join pg_namespace dn on dn.oid = d.defaclnamespace
  cross join lateral unnest(d.defaclacl) a
  where pg_get_userbyid(d.defaclrole) = 'postgres'
    and dn.nspname = 'public'
    and a::text like 'anon=%';
  if v_count > 0 then
    raise exception 'A3 postgres 의 public 기본 ACL 에 anon 이 남아 있음: %', v_bad;
  end if;

  -- [A4] 경고 전용 — 여기서 고칠 수 없는 것.
  --
  -- `supabase_admin` 소유의 기본 ACL 은 public 미래 테이블에 anon 전권을 준다. 그런데
  -- 마이그레이션 실행자(postgres)는 supabase_admin 의 멤버가 아니라 그 기본값을 바꿀 수
  -- 없다(Supabase 플랫폼 소유 영역). 이 프로젝트의 테이블은 전부 postgres 로 생성되므로
  -- 실질 위험은 낮지만, "막았다"고 적으면 거짓이 되므로 상태를 매 실행마다 알린다.
  -- A1 이 전수 검사라, 이 경로로 객체가 생겨도 다음 실행에서 반드시 걸린다.
  select count(*) into v_count
  from pg_default_acl d
  left join pg_namespace dn on dn.oid = d.defaclnamespace
  cross join lateral unnest(d.defaclacl) a
  where pg_get_userbyid(d.defaclrole) = 'supabase_admin'
    and dn.nspname = 'public'
    and a::text like 'anon=%';
  if v_count > 0 then
    raise warning 'A4 (수정 불가) supabase_admin 기본 ACL 에 anon 이 남아 있음 — A1 이 사후 탐지로 담당';
  end if;

  raise exception 'ALL_ANON_INVARIANTS_PASSED';
end $$;
