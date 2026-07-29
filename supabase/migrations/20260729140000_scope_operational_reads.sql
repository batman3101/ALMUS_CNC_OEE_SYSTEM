-- Codex 감사(2026-07-29) HIGH #3 수정 2/2: 읽기 범위를 역할·담당 설비로 좁힌다.
--
-- ⚠ **성능 검증이 이 단계의 핵심 리스크였다.** 실제로 측정했고, 초안의 술어가 166배
--   느린 것을 발견해 고쳤다 — 아래 "술어의 모양이 성능을 결정한다" 참조.
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
-- 참고 — 2026-07-29 현재 운영자 6명 **전원이 800대 전체를 배정**받고 있어, 이 정책이 지금
-- 당장 막는 것은 없다. 그래도 넣는 이유는 경계가 **배정을 좁히는 순간** 성립해야 하기
-- 때문이다. 지금 없으면 나중에 배정을 좁혀도 PostgREST 직접 호출로 여전히 다 보인다.
--
-- ══ 왜 헬퍼 함수를 쓰는가 ════════════════════════════════════════════════
--
-- SECURITY DEFINER 는 **정확성**을 위해 필요하다 — 정책 안에서 user_profiles 를 직접 읽으면
-- user_profiles 자신의 RLS 가 다시 걸려 재귀가 된다.
--
-- ══ 술어의 모양이 성능을 결정한다 (2026-07-29 운영 DB 실측) ═══════════════
--
-- **STABLE 함수라고 해서 한 번만 평가되지 않는다.** 술어 모양에 따라 행마다 다시 불린다.
-- 운영 데이터(production_records 24,516행, 운영자 담당설비 800대)로 세 가지를 측정했다.
-- 쿼리는 `select * from production_records where date >= current_date - 7` (9,139행 반환),
-- 역할은 operator, 측정은 전부 롤백 트랜잭션 안에서:
--
--   정책 없음(기준선)                             4.2 ms   buffers    782
--   machine_id::text = any (fn())               701.1 ms   buffers 73,894   ← 166배
--   (select fn()) @> array[machine_id::text]    294.9 ms   buffers 55,797   ←  70배
--   machine_id::text in (select unnest(fn()))    12.9 ms   buffers    793   ← 3배 (채택)
--
-- 무엇이 달랐나:
--
--   * `= any(fn())` — 함수가 **행마다** 호출된다. 9,139번의 user_profiles 조회가 buffers 를
--     73,894 까지 밀어올린다. STABLE 은 "같은 트랜잭션에서 같은 값" 을 보장할 뿐,
--     플래너가 결과를 캐시한다는 뜻이 아니다.
--
--   * `(select fn()) @> array[...]` — `(select …)` 로 감싸 InitPlan 이 잡혀 함수 호출은
--     1회로 줄었다(Supabase 문서가 권하는 방법). 그런데도 여전히 느리다. 800개짜리 text[]
--     는 TOAST 에 저장되고, `@>` 가 **행마다 detoast** 하기 때문이다(buffers 55,797).
--     배열을 값으로 다루는 한 이 비용은 사라지지 않는다.
--
--   * `in (select unnest(fn()))` — 플래너가 **hashed SubPlan** 으로 바꾼다. 800개를 한 번
--     해시 테이블로 만들고 행마다 O(1) 조회를 한다. buffers 가 기준선과 같아진다(793 vs 782).
--
-- 그래서 아래 세 정책은 모두 `in (select unnest(...))` 형태를 쓴다. **이 모양을 바꾸지 마라.**
-- `= any(...)` 가 더 자연스러워 보이지만 그것이 정확히 166배 느린 버전이다.
--
-- 격리 검증(같은 롤백 트랜잭션): 담당을 2대로 좁힌 운영자는 24,516행 중 **61행(설비 2대)**
-- 만 본다. 빠르기만 하고 막지 못하면 의미가 없으므로 성능과 함께 확인했다.

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
    (select public.current_user_role()) in ('admin', 'engineer')
    or machine_id::text in (select unnest(public.current_user_machines()))
  );

-- ── machines ──────────────────────────────────────────────────────────────
drop policy if exists "Authenticated can read machines" on public.machines;

create policy "Scoped read machines"
  on public.machines
  for select to authenticated
  using (
    (select public.current_user_role()) in ('admin', 'engineer')
    or id::text in (select unnest(public.current_user_machines()))
  );

-- ── machine_logs ──────────────────────────────────────────────────────────
-- 20260729130000 이 쓰기를 막고 남긴 읽기 정책을 같은 기준으로 좁힌다.
drop policy if exists "Authenticated can read machine_logs" on public.machine_logs;

create policy "Scoped read machine_logs"
  on public.machine_logs
  for select to authenticated
  using (
    (select public.current_user_role()) in ('admin', 'engineer')
    or machine_id::text in (select unnest(public.current_user_machines()))
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
--   확인한다. current_user_machines() 가 '{}' 를 돌려주면 unnest 가 0행이라 IN 이 항상 false 다.
