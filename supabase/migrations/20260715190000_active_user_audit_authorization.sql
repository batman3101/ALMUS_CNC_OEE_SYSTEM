-- system_settings_audit의 오래된 INSERT 정책은 authenticated 사용자라면
-- 누구든 임의 감사 행을 기록할 수 있었다. 기존 적용 이력은 수정하지 않고,
-- 현재 존재하는 모든 정책을 제거한 뒤 활성 사용자 기준의 최소 권한 정책으로 교체한다.

BEGIN;

ALTER TABLE public.system_settings_audit ENABLE ROW LEVEL SECURITY;

-- 설치 환경마다 과거 정책 구성이 다를 수 있으므로 알려진 이름만 제거하지 않고
-- 실제 catalog를 기준으로 이 테이블의 정책을 모두 정리한다. 재실행 시에도 안전하다.
DO $$
DECLARE
  policy_record record;
BEGIN
  FOR policy_record IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'system_settings_audit'
  LOOP
    EXECUTE format(
      'DROP POLICY IF EXISTS %I ON public.system_settings_audit',
      policy_record.policyname
    );
  END LOOP;
END $$;

-- anon은 감사 로그에 직접 접근할 이유가 없다. authenticated 사용자는 조회만
-- 가능하며, 감사 행 생성은 설정 변경 RPC/API 또는 service_role로 제한한다.
REVOKE ALL ON TABLE public.system_settings_audit FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.system_settings_audit FROM authenticated;
GRANT SELECT ON TABLE public.system_settings_audit TO authenticated;
GRANT INSERT ON TABLE public.system_settings_audit TO service_role;

CREATE POLICY "Active admins and engineers can view audit logs"
  ON public.system_settings_audit
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_profiles
      WHERE user_profiles.user_id = auth.uid()
        AND user_profiles.role IN ('admin', 'engineer')
        AND user_profiles.is_active IS TRUE
    )
  );

-- update_system_setting은 SECURITY DEFINER 함수이므로 authenticated에 테이블 INSERT
-- 권한을 주지 않아도 함수 소유자 권한으로 감사 행을 기록한다. REST 직접 INSERT는
-- service_role만 허용해 활성 관리자도 감사 로그 원본을 임의로 위조하지 못하게 한다.
CREATE POLICY "Service role can insert audit logs"
  ON public.system_settings_audit
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- 이 뷰는 브라우저의 systemSettings 클라이언트가 직접 조회한다. PostgreSQL의
-- 기본 view 소유자 권한으로 기반 테이블 RLS를 우회하지 않도록 호출자 권한으로 실행한다.
ALTER VIEW public.recent_settings_changes
  SET (security_invoker = true);

REVOKE ALL ON TABLE public.recent_settings_changes FROM anon;
REVOKE ALL ON TABLE public.recent_settings_changes FROM authenticated;
GRANT SELECT ON TABLE public.recent_settings_changes TO authenticated;

COMMIT;
