-- Codex 감사 후속(2026-07-29) MEDIUM #10: anon 역할의 테이블 grant 회수.
--
-- ⚠ 이 마이그레이션은 아직 운영에 적용하지 않았다.
--
-- ══ 지금 뚫려 있는 것은 아니다 ═══════════════════════════════════════════
--
-- 운영 DB 실측 결과, 핵심 6개 테이블에 anon 이 SELECT·INSERT·UPDATE·DELETE·TRUNCATE·
-- REFERENCES·TRIGGER 를 전부 갖고 있다. 다만 20260715200000 이 anon 정책을 모두 제거했고
-- 모든 테이블에 RLS 가 켜져 있어(relrowsecurity = true), **정책이 없으면 거부**이므로 anon 은
-- 현재 차단된다. 즉시 악용 가능한 구멍이 아니다.
--
-- 문제는 이것이 **단일 실패점**이라는 것이다. 누군가 편의를 위해 anon 정책을 하나 추가하거나,
-- RLS 를 잠시 끄고 되돌리지 않거나, 새 테이블에 이 grant 패턴을 복사하는 순간 테이블 전체가
-- 인터넷에 열린다. NEXT_PUBLIC_SUPABASE_ANON_KEY 는 브라우저 번들에 들어 있어 누구나 가진다.
--
-- 방어는 두 겹이어야 한다. RLS 는 "정책이 허용해야 통과", grant 는 "권한이 있어야 시도 가능".
-- 지금은 한 겹뿐이다.
--
-- 참고 — production_progress_reports / production_shift_states 에는 grant 가 아예 없다.
-- 새 테이블은 이미 옳은 패턴으로 만들어지고 있고, 오래된 테이블만 정리되지 않았다.
--
-- ══ 로그인 이전 경로 확인 (완료) ══════════════════════════════════════════
--
-- src/lib/systemSettings.ts 는 브라우저 클라이언트를 쓰므로 로그인 이전에는 anon 상태로
-- system_settings 를 조회할 수 있다. 그 경로가 깨질까 확인했더니:
--
--     "모든 인증된 사용자는 시스템 설정을 볼 수 있" | TO public | SELECT
--       qual: (select auth.role()) = 'authenticated'
--
-- 정책 대상은 public 이지만 술어가 authenticated 를 요구하므로 **anon SELECT 는 이미
-- 거부된다.** grant 회수는 동작을 바꾸지 않는다 — 이미 막혀 있는 것을 문서화된 상태로
-- 만들 뿐이다. 나머지 5개 테이블은 anon 정책이 아예 없어 마찬가지다.

revoke all on table
  public.machines,
  public.machine_logs,
  public.production_records,
  public.downtime_entries,
  public.user_profiles,
  public.system_settings
from anon;

-- authenticated 의 TRUNCATE 는 **RLS 가 막지 못한다.** 행 단위 정책이 아니라 테이블 단위
-- 명령이기 때문이다. 정상 앱 동작에 필요 없으므로 함께 회수한다.
-- REFERENCES / TRIGGER 도 앱이 쓰지 않는다.
revoke truncate, references, trigger on table
  public.machines,
  public.machine_logs,
  public.production_records,
  public.downtime_entries,
  public.user_profiles,
  public.system_settings
from authenticated;

-- 앞으로 만들어지는 테이블에 같은 패턴이 복사되지 않도록 기본 권한도 닫는다.
-- (이미 만들어진 테이블에는 영향이 없다 — 위 revoke 가 그 몫이다)
alter default privileges in schema public revoke all on tables from anon;

-- ══ 적용 전 확인 ══════════════════════════════════════════════════════════
--
-- 1. 로그아웃 상태에서 로그인 페이지가 정상 렌더되는지 (회사명·로고 등 anon 조회 경로).
--    위 분석대로라면 변화가 없어야 한다 — 원래 못 읽고 있었다.
-- 2. 로그인 후 대시보드가 정상인지 (authenticated 의 SELECT/INSERT/UPDATE/DELETE 는 유지).
-- 3. 관리자 설비 등록·수정·비활성화가 정상인지.
