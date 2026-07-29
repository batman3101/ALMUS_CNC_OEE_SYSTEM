-- 적대적 재감사 #2 (CRITICAL) · #4 (HIGH) — 쓰기 경계를 DB 에서 강제한다.
--
-- ## #2 무엇이 문제였나
--
-- 이 시스템의 설계 전제는 "API/RPC 가 유일한 쓰기 경계"다. 소유권 확인, 낙관적 동시성
-- (expected_version), advisory lock, 감사 로그가 전부 그 경계 안에 있다:
--   src/app/api/downtime-entries/[id]/route.ts
--   supabase/migrations/20260715160000_independent_downtime_lifecycle.sql
--
-- 그런데 운영 DB 는 `authenticated` 에게 `downtime_entries` 의 INSERT·UPDATE·DELETE 를
-- 그대로 주고 있었고, 운영자 정책은 **역할과 담당 machine_id 만** 본다. 기록 소유자,
-- 계정 활성 여부, 버전 일치, 잠금 참여를 하나도 강제하지 않는다.
--
-- 결과: 담당 설비를 가진 운영자가 PostgREST 로 테이블을 직접 치면 다른 운영자의 기록도,
-- 과거 비가동도, CAS 와 잠금 **밖에서** 바꿀 수 있었다. 즉 위 전제는 DB 에서 거짓이었다.
--
-- ## 왜 이 결함이 가장 중요한가 — 개별 항목이 아니라 부류다
--
-- 전제가 거짓인 동안에는 API 층에 넣는 모든 불변조건이 **권고사항**이지 강제가 아니다.
-- 마감 원자성(#5·#6)도, 진척 시간창도, 감사 로그도 "그런데 PostgREST 로 직접 치면?" 이
-- 항상 따라붙는다. 그래서 여기서는 downtime_entries 하나가 아니라 **경계 전체**를 닫는다.
--
-- 적용 범위를 실측으로 정했다. 브라우저(anon-key = authenticated 역할) 클라이언트가 직접
-- 쓰는 테이블은 저장소 전체에서 **두 개뿐**이다:
--   src/components/model-info/ModelInfoManager.tsx → product_models, model_processes
-- 나머지 모든 쓰기는 API 라우트가 service_role 로 수행한다(RPC 포함 — toggle_machine_downtime,
-- correct_open_downtime_reason, report_shift_progress, close_shift_upsert_v2,
-- confirm_shift_defect 는 전부 supabaseAdmin 호출). 따라서 그 둘만 남기고 회수해도
-- 앱 동작은 바뀌지 않는다.
--
-- ## 두 겹으로 막는 이유
--
-- grant 회수와 정책 제거를 **둘 다** 한다. 어느 하나만으로도 충분하지만,
--  - grant 만 회수하면 정책은 "운영자가 쓸 수 있다"고 계속 말한다 — 스키마가 거짓말을 한다.
--  - 정책만 지우면 나중에 누가 정책을 되살릴 때 grant 가 그대로라 바로 열린다.
-- 둘 다 닫으면 어느 쪽이 되살아나도 나머지가 잡는다.

-- ── #2-a. 쓰기 grant 회수 ─────────────────────────────────────────────────────
-- SELECT 는 남긴다 — 읽기는 20260729140000 의 담당설비 스코프 정책이 이미 좁히고 있고,
-- Realtime 구독(machines·machine_logs·production_records)이 이 권한으로 동작한다.
revoke insert, update, delete on public.downtime_entries from authenticated;
revoke insert, update, delete on public.production_records from authenticated;
revoke insert, update, delete on public.machines from authenticated;
revoke insert, update, delete on public.machine_logs from authenticated;
revoke insert, update, delete on public.system_settings from authenticated;
revoke insert, update, delete on public.user_profiles from authenticated;

-- ── #2-b. 이제 발화할 수 없는 쓰기 정책 제거 ─────────────────────────────────
drop policy if exists "Operator can insert downtime for assigned machines" on public.downtime_entries;
drop policy if exists "Operator can update downtime for assigned machines" on public.downtime_entries;
drop policy if exists "Operator can delete downtime for assigned machines" on public.downtime_entries;

-- 관리자 전권 정책은 FOR ALL 이라 읽기까지 덮는다. 읽기는 남겨야 하므로 SELECT 로 좁힌다.
drop policy if exists "Admin can do everything on downtime_entries" on public.downtime_entries;
create policy "Admin can read downtime_entries"
  on public.downtime_entries
  for select to authenticated
  using ((select public.current_user_role()) = 'admin');

-- ── #4. 비활성·비정상 역할 계정의 직접 접근 차단 ─────────────────────────────
--
-- `current_user_role()` / `current_user_machines()` 는 `is_active` 를 보지 않았다.
-- API 의 `requireUser` 는 비활성 계정을 막지만, **유효한 JWT 로 PostgREST 를 직접 치면**
-- 그 검사를 지나간다. 계정을 비활성화해도 토큰이 만료될 때까지 읽기 권한이 남는다.
--
-- 조건을 **정책이 아니라 함수 안에** 넣는 이유가 중요하다. 세 스코프 정책의 술어는
-- `machine_id::text in (select unnest(public.current_user_machines()))` 형태여야 하는데,
-- 이건 취향이 아니라 성능 요구사항이다 — `= any(...)` 로 쓰면 같은 조회가 **166배** 느려진다
-- (20260729140000 의 측정표 참조). 함수 안에서 좁히면 정책 술어가 한 글자도 바뀌지 않으므로
-- 그 함정을 다시 건드리지 않는다.
--
-- 역할 검사도 여기 넣는다. 담당설비 분기가 역할을 확인하지 않아서, `assigned_machines` 가
-- 채워진 채 역할이 잘못된 계정(예: 오타로 'operater')이 생기면 그 설비들에 접근할 수 있었다.
-- "담당 설비는 **활성 운영자에게만** 있다"를 함수의 정의로 만든다.
--
-- 두 함수 모두 조건 불일치 시 **행이 없어** NULL 을 돌려준다. NULL 은
--   - `in ('admin','engineer')` → NULL → 참이 아님 → 거부
--   - `unnest(NULL)` → 0행 → 어떤 machine_id 와도 매칭 실패 → 거부
-- 즉 양쪽 다 fail-closed 다. 이 성질이 없으면 비활성 계정이 오히려 전권을 얻을 수 있다.
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.user_profiles
  where user_id = (select auth.uid())
    and is_active
$$;

create or replace function public.current_user_machines()
returns text[]
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(assigned_machines, '{}') from public.user_profiles
  where user_id = (select auth.uid())
    and is_active
    and role = 'operator'
$$;

-- ══ 적용 전 확인 ══════════════════════════════════════════════════════════════
--
-- [성능] 정책 술어는 바뀌지 않았지만 함수 본문에 조건이 늘었다. user_profiles 는
--        user_id 인덱스 단건 조회라 영향이 없어야 한다. 적용 후 재측정으로 확인한다
--        (기준: operator/production_records 12.9ms · buffers 793).
--
-- [기능] 브라우저 테스트로 확인할 것:
--        andon 시작·재개, 사유 정정, 진척 저장, 교대 마감, 불량 확정, 모델 정보 편집.
--        전부 service_role 경로라 통과해야 한다. 하나라도 42501 이 나오면 그 경로가
--        브라우저에서 직접 쓰고 있었다는 뜻이므로 되돌리지 말고 그 경로를 API 로 옮긴다.
