-- 모델·공정 마스터를 다른 테이블과 **같은 쓰기 경계**에 세운다.
--
-- ## 무엇이 문제였나 (2026-08-04 운영 DB 실측)
--
-- 핵심 도메인 테이블은 `authenticated` 에게 `SELECT` 만 열려 있다:
--
--   production_records   SELECT
--   downtime_entries     SELECT
--   machines             SELECT
--
-- 그런데 이 둘만 예외였다:
--
--   product_models   SELECT, INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
--   model_processes  SELECT, INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES
--
-- 게다가 두 테이블의 RLS 정책은 역할만 보고 **`is_active` 를 보지 않았다**:
--
--   exists (select 1 from user_profiles
--           where user_id = auth.uid() and role = any(array['admin','engineer']))
--
-- 그래서 규칙이 두 벌이 됐다. 서버 API 는 admin/engineer 를 요구하고 `requireUser` 가
-- `is_active` 도 검사하는데, 화면이 실제로 쓰던 경로는 브라우저 → PostgREST → 이 정책이었다.
-- **약한 쪽이 진짜 규칙이었다.**
--
-- 이 저장소에는 이미 옳은 헬퍼가 있다 — `current_user_role()` 은 `is_active` 를 본다.
-- 두 정책만 그 헬퍼를 쓰지 않고 조건을 인라인으로 다시 적었고, 다시 적으면서 조건이 빠졌다.
-- `pageAccess.ts` 가 배운 교훈과 같은 형태다: 규칙을 두 번 적으면 언젠가 한쪽만 바뀐다.
--
-- ## 무엇을 바꾸나
--
--  1. 쓰기 권한 회수 — 읽기(`SELECT`)만 남긴다. 쓰기는 서버 API(서비스 롤)만 한다.
--     `src/app/api/product-models/[id]` 와 `src/app/api/model-processes/[id]` 의
--     PUT/DELETE 가 이 마이그레이션과 같은 변경에서 추가됐다.
--  2. `ALL` 정책을 `SELECT` 전용으로 교체하고, 술어를 `current_user_role()` 로 바꾼다.
--     권한과 정책 **양쪽**을 닫는다 — 한쪽만 닫으면 다른 쪽이 되살아났을 때 조용히 열린다.
--  3. 읽기 대상 역할은 **바뀌지 않는다**. 기존 정책도 admin/engineer 만 허용했으므로
--     운영자는 원래 이 테이블을 PostgREST 로 읽을 수 없었다. 달라지는 것은
--     "비활성 계정이 제외된다"는 점뿐이다.
--
-- ## 배포 순서
--
-- 이 마이그레이션은 **쓰기를 막기만** 한다. 앱이 아직 브라우저에서 직접 쓰고 있으면
-- 모델·공정 편집이 실패한다. 따라서 **코드 배포 이후**에 적용한다.
-- (반대 순서로 적용해도 데이터는 안전하지만 화면이 먼저 깨진다.)

-- ── 1. 쓰기 권한 회수 ────────────────────────────────────────────────────────
-- TRUNCATE 는 RLS 를 따르지 않는다. PostgREST 가 노출하지 않아 웹에서 도달할 수는 없지만,
-- 정책으로 막히지 않는 권한을 남겨 둘 이유가 없다.
revoke insert, update, delete, truncate, trigger, references
  on public.product_models from authenticated;
revoke insert, update, delete, truncate, trigger, references
  on public.model_processes from authenticated;

revoke all on public.product_models from anon;
revoke all on public.model_processes from anon;

grant select on public.product_models to authenticated;
grant select on public.model_processes to authenticated;

-- ── 2. 정책 교체 ─────────────────────────────────────────────────────────────
drop policy if exists "Admin and Engineer full access on product_models" on public.product_models;
drop policy if exists "Admin and Engineer full access on model_processes" on public.model_processes;

-- 술어를 스칼라 서브쿼리로 감싼다. 그러지 않으면 `current_user_role()` 이 **행마다**
-- 평가된다 — 이 저장소가 RLS 술어에서 이미 한 번 겪은 성능 함정과 같은 종류다.
create policy "Active managers can read product models"
  on public.product_models
  for select
  to authenticated
  using ((select public.current_user_role()) in ('admin', 'engineer'));

create policy "Active managers can read model processes"
  on public.model_processes
  for select
  to authenticated
  using ((select public.current_user_role()) in ('admin', 'engineer'));

-- ── 3. oee_calculations — 쓰지 않는 테이블의 열린 쓰기 표면을 닫는다 ──────────
--
-- 실측: 행 0개, 애플리케이션 코드에서 참조 없음. 그런데 정책이
--   cmd=ALL, using=(auth.role()='authenticated'), with_check=NULL
-- 이었다. `ALL` 정책에서 `with_check` 가 NULL 이면 Postgres 는 `USING` 식을 검사에도 쓴다.
-- 즉 **운영자를 포함한 모든 로그인 사용자가 자유롭게 INSERT/UPDATE/DELETE 할 수 있었다.**
--
-- 테이블을 DROP 하는 것이 더 깨끗하지만 되돌릴 수 없다. 여기서는 쓰기 표면만 닫고,
-- DROP 여부는 별도 확인 사항으로 남긴다.
revoke insert, update, delete, truncate, trigger, references
  on public.oee_calculations from authenticated;
revoke all on public.oee_calculations from anon;

drop policy if exists "인증된 사용자는 OEE 계산을 관리할 수 있음" on public.oee_calculations;
