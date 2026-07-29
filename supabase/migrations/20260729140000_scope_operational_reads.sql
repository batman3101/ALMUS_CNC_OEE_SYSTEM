-- Codex 감사(2026-07-29) HIGH #3 수정 2/2: 읽기 범위를 역할·담당 설비로 좁힌다.
--
-- ⚠ 이 마이그레이션은 아직 운영에 적용하지 않았다.
-- ⚠ **성능 검증이 이 단계의 핵심 리스크다.** 파일 끝의 적용 전 확인을 반드시 먼저 수행한다.
--
-- ══ 무엇이 문제였나 ═══════════════════════════════════════════════════════
--
--     "Authenticated can read machines"            | FOR SELECT TO authenticated | USING (true)
--     "Authenticated can read production_records"  | FOR SELECT TO authenticated | USING (true)
--
-- 운영자는 API 를 통하면 `assertMachineAccess` 로 담당 설비만 볼 수 있다. 그러나 브라우저
-- 번들에 실린 anon 키와 자기 JWT 로 PostgREST 를 직접 호출하면 그 검사를 지나 **전 설비의
-- 생산실적**을 조회할 수 있었다. useRealtimeData 의 클라이언트 스코프는 전송량을 줄일 뿐
-- 보안 경계가 아니다(그 파일 주석도 이미 그렇게 적어 두었다).
--
-- ══ 왜 헬퍼 함수를 쓰는가 ════════════════════════════════════════════════
--
-- RLS 술어는 **행마다** 평가된다. 정책 안에 `EXISTS (select 1 from user_profiles ...)` 를
-- 직접 쓰면 production_records 32.5만 행에서 실행계획이 무너진다. STABLE SECURITY DEFINER
-- 함수로 감싸면 Postgres 가 한 번 평가한 결과를 재사용할 수 있다.
--
-- SECURITY DEFINER 는 성능만이 아니라 **정확성**을 위해서도 필요하다 — 정책 안에서
-- user_profiles 를 읽으면 user_profiles 자신의 RLS 가 다시 걸려 재귀가 된다.

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from public.user_profiles where user_id = (select auth.uid())
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
$$;

-- 익명 사용자는 이 함수를 부를 이유가 없다.
revoke all on function public.current_user_role() from public, anon;
revoke all on function public.current_user_machines() from public, anon;
grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.current_user_machines() to authenticated, service_role;

-- ── production_records ────────────────────────────────────────────────────
drop policy if exists "Authenticated can read production_records" on public.production_records;

create policy "Scoped read production_records"
  on public.production_records
  for select to authenticated
  using (
    public.current_user_role() in ('admin', 'engineer')
    or machine_id::text = any (public.current_user_machines())
  );

-- ── machines ──────────────────────────────────────────────────────────────
drop policy if exists "Authenticated can read machines" on public.machines;

create policy "Scoped read machines"
  on public.machines
  for select to authenticated
  using (
    public.current_user_role() in ('admin', 'engineer')
    or id::text = any (public.current_user_machines())
  );

-- ── machine_logs ──────────────────────────────────────────────────────────
-- 20260729130000 이 쓰기를 막고 남긴 읽기 정책을 같은 기준으로 좁힌다.
drop policy if exists "Authenticated can read machine_logs" on public.machine_logs;

create policy "Scoped read machine_logs"
  on public.machine_logs
  for select to authenticated
  using (
    public.current_user_role() in ('admin', 'engineer')
    or machine_id::text = any (public.current_user_machines())
  );

-- ══ 적용 전 확인 (전부 통과해야 운영 반영) ═════════════════════════════════
--
-- [성능] — 이것이 이 마이그레이션에서 가장 큰 위험이다.
--   스테이징 또는 브랜치 DB 에서 아래 세 쿼리의 EXPLAIN ANALYZE 를 **적용 전후로 비교**한다.
--   machine_id 인덱스가 계속 쓰이는지, Seq Scan 으로 바뀌지 않는지 본다.
--     (a) 대시보드 최근 실적:  select * from production_records where date >= <7일 전>
--     (b) 기간 조회:           select * from production_records where date between <월초> and <월말>
--     (c) 설비별 조회:         select * from production_records where machine_id = <uuid>
--
--   참고 — `analytics_*` RPC 들은 service_role 로 실행되어 RLS 를 우회하므로 영향받지 않는다.
--   영향권은 **클라이언트 직접 쿼리 경로**(useRealtimeData 등)뿐이며, 이 사실이 위험을 크게
--   낮춘다. 그래도 측정 없이 넘어가지 않는다.
--
-- [기능] — 세 역할로 실제 로그인해 확인한다. UI 가 조용히 비는 것이 가장 흔한 실패다.
--   admin    : 설비 목록 전체, 전 설비 실적, 리포트
--   engineer : 설비 목록 전체, 분석 화면
--   operator : 담당 설비만 보이는가, 담당 외 설비가 사라졌는가, 대시보드가 비지 않는가
--
-- [경계] — 담당 설비가 **빈 배열**인 운영자로 로그인해 앱이 오류 없이 빈 상태를 보여주는지
--   확인한다. current_user_machines() 가 '{}' 를 돌려주므로 `= any('{}')` 는 항상 false 다.
