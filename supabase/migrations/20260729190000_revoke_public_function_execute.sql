-- 180000 의 보완 — `revoke ... from anon` 만으로는 익명을 막지 못한다.
--
-- ## 무엇을 놓쳤나
--
-- 180000 을 적용한 직후 `supabase/tests/anon_access_invariants.sql` 의 A2 가 실패했다.
-- 익명 REST 호출도 여전히 성공했다:
--
--   POST /rest/v1/rpc/get_system_setting {"p_category":"shift","p_key":"shift_a_start"}
--     → 200  "08:00"      (revoke execute ... from anon 을 적용한 **뒤에도**)
--
-- 원인은 Postgres 의 함수 기본 ACL 이다. 함수는 생성될 때 **EXECUTE 가 PUBLIC 에 부여**된다:
--
--   proacl = {=X/postgres, postgres=X/postgres, authenticated=X/postgres, ...}
--             ↑ 앞의 빈 이름이 PUBLIC
--
-- 특정 역할에서 회수해도 PUBLIC 이 계속 주고 있으면 그 역할은 여전히 실행할 수 있다.
-- `has_function_privilege('anon', ...)` 가 true 로 남는 이유이자, revoke 가 조용히 무의미해지는
-- 이유다. **회수는 권한이 실제로 있는 곳에서 해야 한다.**
--
-- (자기 점검용 메모: 이때 `proacl::text like '%=X/%'` 로 PUBLIC 부여를 찾으려 했다가 37개
--  함수가 전부 뚫린 것으로 오판했다. 그 패턴은 `authenticated=X/postgres` 에도 걸린다.
--  PUBLIC 부여는 ACL **항목이 `=` 로 시작**하는 경우다 — 실제 대상은 아래 2개뿐이었다.)
--
-- ## 나머지 쓰기 RPC 는 왜 안전했나
--
-- `delete_production_record` · `update_system_setting` 등은 익명 호출 시 `42501 permission
-- denied` 가 나온다(실측). 이들은 PUBLIC 부여가 없고 역할별로만 부여돼 있어 180000 의
-- 전수 회수로 이미 닫혔다. 즉 이 마이그레이션의 대상은 정확히 "PUBLIC 부여가 남은 함수"다.

-- ── 1. PUBLIC 부여 회수 ───────────────────────────────────────────────────────

-- SECURITY DEFINER 라 RLS 를 우회해 system_settings 를 읽는다. 테이블 직접 조회는 401 인데
-- 이 RPC 로는 값이 나왔다 — 정책을 우회하는 뒷문이었다.
revoke execute on function public.get_system_setting(text, text) from public;
grant execute on function public.get_system_setting(text, text) to authenticated, service_role;

-- 트리거 함수. 트리거 발화는 함수 EXECUTE 권한을 검사하지 않으므로(테이블의 TRIGGER 권한을
-- 본다) 아무에게도 부여할 필요가 없다.
revoke execute on function public.enforce_progress_monotonic() from public, anon;

-- ── 2. 미래 함수의 기본값 ─────────────────────────────────────────────────────
--
-- ⚠️ 이 문장 뒤로 **postgres 가 만드는 새 함수는 PUBLIC EXECUTE 를 받지 않는다.**
--    따라서 앞으로 RPC 를 추가하는 마이그레이션은 반드시 명시적으로 부여해야 한다:
--
--      grant execute on function public.<new_rpc>(<args>) to authenticated, service_role;
--
--    잊으면 앱에서 그 RPC 호출이 42501 로 즉시 실패한다. 시끄러운 실패를 고른 이유는,
--    반대쪽 실패(부여를 잊지 않아 조용히 익명에게 열림)가 지금까지 반복해서 우리를 문
--    실패 모드이기 때문이다. 깨지면 보이는 쪽이 낫다.
alter default privileges in schema public revoke execute on functions from public;
