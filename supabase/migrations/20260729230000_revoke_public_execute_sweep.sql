-- 190000 의 정정 — **미래 함수는 기본 권한으로 막을 수 없다.**
--
-- ## 190000 이 틀렸던 부분
--
-- 거기서 이렇게 적었다: "이 문장 뒤로 postgres 가 만드는 새 함수는 PUBLIC EXECUTE 를 받지
-- 않는다."  틀렸다. 바로 다음 마이그레이션(220000)이 만든 함수를 익명 키로 불러 봤더니
-- 그대로 실행됐다:
--
--   POST /rest/v1/rpc/update_system_settings_batch  → 200 {"ok":false,"reason":"updates_empty"}
--
-- 아무 grant 도 붙이지 않은 빈 함수로 격리 실험해 원인을 확인했다:
--
--   create function public.__acl_probe__() returns integer language sql immutable as 'select 1';
--   → proacl = {=X/postgres, postgres=X/postgres, authenticated=X/postgres, service_role=X/postgres}
--                ↑ PUBLIC
--
-- 그런데 postgres 의 기본 ACL 에는 PUBLIC 이 **없다**(실측):
--   pg_default_acl(postgres, public, function) = {postgres=X, authenticated=X, service_role=X}
--
-- 즉 Supabase 플랫폼이 새로 만들어진 함수에 EXECUTE 를 PUBLIC 으로 **되돌려 부여한다.**
-- `alter default privileges` 는 그 뒤에 일어나는 일을 막지 못한다. 이건 우리가 끌 수 있는
-- 스위치가 아니다.
--
-- ## 그래서 방침을 바꾼다
--
-- "기본값으로 예방한다" → **"만들 때마다 명시적으로 회수하고, 빠뜨리면 검사가 잡는다."**
--
-- 새 RPC 를 추가하는 모든 마이그레이션은 이 두 줄을 함께 써야 한다:
--
--   revoke execute on function public.<new_rpc>(<args>) from public;
--   grant  execute on function public.<new_rpc>(<args>) to <필요한 역할만>;
--
-- 빠뜨리면 `supabase/tests/anon_access_invariants.sql` 의 A2 가 잡는다. 실제로 이번에
-- 그렇게 잡혔다 — `npm run check:grants`(블랙박스)는 휘발성 함수를 실행하지 않으므로
-- **놓쳤고**, 카탈로그를 훑는 A2 만 걸렀다. 두 검사를 나눠 둔 이유가 이 자리에서 증명됐다.

-- ── 지금 PUBLIC EXECUTE 가 남아 있는 비확장 함수를 전수 회수 ──────────────────
--
-- 이름을 나열하지 않는다(#1 에서 배운 것). 확장 소유 함수는 건드리지 않는다 — btree_gist 의
-- gbt_* 수백 개는 연산자 클래스 내부 구현이고, 익명이 불러도 얻을 정보가 없는 순수 함수다.
do $$
declare
  v_fn record;
  v_count integer := 0;
begin
  for v_fn in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and exists (
        select 1 from unnest(coalesce(p.proacl, acldefault('f', p.proowner))) a
        where a::text like '=%'
      )
      and not exists (
        select 1 from pg_depend d
        where d.objid = p.oid and d.classid = 'pg_proc'::regclass and d.deptype = 'e'
      )
  loop
    execute format('revoke execute on function public.%I(%s) from public', v_fn.proname, v_fn.args);
    v_count := v_count + 1;
  end loop;
  raise notice 'PUBLIC EXECUTE 회수: %개 함수', v_count;
end $$;

-- 배치 RPC 는 라우트(service_role)만 부른다. 브라우저에서 부를 이유가 없다.
grant execute on function public.update_system_settings_batch(jsonb, text) to service_role;
