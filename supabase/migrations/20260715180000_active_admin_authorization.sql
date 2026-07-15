-- 비활성화된 관리자 프로필이 기존 세션을 이용해 관리자 전용 RLS/RPC를
-- 계속 통과하지 못하도록 공통 권한 판정 함수에 활성 상태를 포함한다.
-- service_role은 서버 작업을 위해 기존과 동일하게 허용한다.

BEGIN;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    COALESCE(auth.jwt() ->> 'role', '') = 'service_role'
    OR EXISTS (
      SELECT 1
      FROM public.user_profiles
      WHERE user_id = auth.uid()
        AND role = 'admin'
        AND is_active IS TRUE
    );
$$;

COMMENT ON FUNCTION public.is_admin() IS
  '현재 요청자가 활성 관리자 프로필을 가진 사용자 또는 service_role인지 판정한다.';

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;

COMMIT;
