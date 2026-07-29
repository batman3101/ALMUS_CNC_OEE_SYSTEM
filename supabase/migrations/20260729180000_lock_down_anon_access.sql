-- 적대적 재감사 #1 · #10 (+ 감사에 없던 anon RPC 누출) — 익명 접근을 전면 차단한다.
--
-- ## 무엇이 뚫려 있었나 (2026-07-29 실측, 익명 REST 호출로 확증)
--
--   GET /rest/v1/model_processes_snapshot_20260716        → 206, 61행
--   GET /rest/v1/tact_original_from_records_20260716      → 206, 16행
--   GET /rest/v1/production_records_pre_recalc_20260716   → 206, 3,850행   ← 실 생산 데이터
--   GET /rest/v1/function_defs_backup_20260717            → 206, 1행
--   POST /rest/v1/rpc/get_system_setting                  → 200, "08:00"   ← RLS 우회
--
-- 인증 없이. 대조군인 `production_records` / `machines` / `system_settings` 는 401 이었다.
-- 네 백업 테이블은 RLS 가 꺼져 있고 정책이 0개인데 anon 에게 `arwdDxtm`(SELECT·INSERT·
-- UPDATE·DELETE·TRUNCATE·REFERENCES·TRIGGER)가 통째로 부여돼 있었다. 읽히는 것만이 아니라
-- **지워질 수 있었다.**
--
-- ## 왜 20260729150000 이 이걸 못 막았나 — 이 마이그레이션의 존재 이유
--
-- 직전 마이그레이션은 `revoke all on table <이름 나열> from anon` 이었다. 목록에 없는
-- 테이블은 그대로 남는다. 그리고 이 네 개는 **마이그레이션 밖에서** 만들어졌다(저장소 전체
-- 검색 결과 참조 0곳 — 7월 데이터 정리 때 psql 로 만든 롤백용 사본이다). 즉 열거 목록에
-- 있을 수가 없었다.
--
--   열거는 "지금 아는 것"만 고친다. 스키마 드리프트는 정의상 모르는 것이다.
--   그래서 여기서는 **전수(`all tables in schema`)** 로 회수한다. 이 형태를 유지할 것.
--
-- ## 안전성 근거 (적용 전 실측)
--
--   - anon 을 참조하는 RLS 정책: **0개**. 정책이 anon 에 의존하지 않으므로 권한 회수가
--     기존 동작을 바꾸지 않는다.
--   - 앱은 로그인 전 public 스키마를 읽지 않는다(인증은 auth 스키마가 처리).
--   - 프로젝트 함수 중 anon 이 EXECUTE 가능한 것은 아래 2개뿐이었다. 나머지 anon 실행
--     가능 함수는 전부 btree_gist 확장 내부(gbt_*)라 건드리지 않는다 — 확장 소유 객체를
--     회수하면 인덱스 연산자 클래스가 깨질 수 있고, 보안상 얻는 것도 없다.

-- ── 1. 익명 노출 백업 테이블 제거 ──────────────────────────────────────────────
--
-- 보존이 아니라 **삭제**를 고른 이유: 이들은 7월 14~17일 수정(유령 행 정리, cavity÷tact
-- 되돌리기, 함수 정의 백업)의 롤백 재료다. 그 수정들은 이미 운영 반영·검증까지 끝났고,
-- 저장소가 관리하지 않는 객체로 남아 있는 한 다음 권한 점검에서 또 빠진다. RLS 를 켜서
-- 살려 두면 "관리되지 않는 테이블"이라는 원인은 그대로 남는다. (데이터 삭제는 사용자가
-- 명시적으로 승인함 — 2026-07-29)
drop table if exists public.model_processes_snapshot_20260716;
drop table if exists public.tact_original_from_records_20260716;
drop table if exists public.production_records_pre_recalc_20260716;
drop table if exists public.function_defs_backup_20260717;
-- 이건 anon 노출은 없었지만(RLS on, grant 없음) 같은 성격의 관리되지 않는 잔해다.
drop table if exists public.production_records_ghost_backup_20260714;

-- 익명에게 열려 있던 디버그 뷰. 내용은 **호출자 자신의** 인증 컨텍스트뿐이라(auth.uid(),
-- JWT role, 세션 유효 여부) 다른 사용자 데이터가 새지는 않았다. 그래도 지운다 — RLS 진단용
-- 임시 객체가 운영에 남아 익명에게 응답하고 있을 이유가 없고, 이것 역시 마이그레이션이
-- 관리하지 않는 잔해다. (감사 보고서에는 없던 항목 — `npm run check:grants` 가 찾아냈다.)
drop view if exists public.user_profiles_rls_debug;

-- ── 2. 기존 객체: anon 권한 전수 회수 ─────────────────────────────────────────
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- 프로젝트 SECURITY DEFINER 함수의 anon EXECUTE.
--
-- `get_system_setting` 은 SECURITY DEFINER 라 **RLS 를 우회해** system_settings 를 읽는다.
-- 테이블 직접 조회는 401 로 막히는데 이 RPC 로는 200 이 나왔다 — 정책을 우회하는 뒷문이었다.
-- authenticated 에는 남긴다(`src/lib/systemSettings.ts` 가 브라우저에서 호출한다).
revoke execute on function public.get_system_setting(text, text) from anon;
revoke execute on function public.is_admin() from anon;

-- ── 3. 미래 객체: 기본값에서 anon 제거 ────────────────────────────────────────
--
-- 150000 은 tables 만 덮었다. sequence 는 rwU, function 은 X 가 anon 에 기본 부여된
-- 상태로 남아 있었다(실측). 세 종류를 모두 닫는다.
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from anon;

-- ⚠️ 여기서 닫지 **못하는** 것 — 정직하게 남긴다.
--
-- `alter default privileges` 는 **실행 역할이 만드는** 객체에만 적용된다. 위 문장들은
-- `postgres` 에 대한 것이다. 운영 DB 에는 `supabase_admin` 소유의 기본 ACL 도 있고 그쪽은
-- public 스키마 미래 테이블에 anon `arwdDxtm` 를 그대로 부여한다. 그런데 마이그레이션
-- 실행자(`postgres`)는 `supabase_admin` 의 멤버가 아니라(`pg_has_role` = false) 그 기본값을
-- 바꿀 권한이 없다. Supabase 플랫폼이 소유하는 영역이다.
--
-- 실질 위험은 낮다 — 이 프로젝트의 테이블은 전부 postgres 로 생성된다. 그러나 "막았다"고
-- 적으면 거짓이 되므로, 막는 대신 **놓치면 반드시 드러나게** 한다:
--   `npm run check:grants` (scripts/check-anon-grants.mjs)
-- 익명 키로 모든 public 테이블·SECURITY DEFINER 함수를 실제로 두드려 보는 블랙박스 검사다.
-- 카탈로그를 읽는 대신 공격자와 같은 자리에서 확인하므로, 경로가 어떻게 열리든 잡힌다.
