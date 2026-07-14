-- 권한 판정을 "하드코딩된 UUID"에서 "역할(role)" 기반으로 바꾼다.
--
-- ■ 왜
--   user_profiles 의 정책 2개가 관리자를 UUID 로 못박고 있었다:
--     auth.uid() = '3dc6483a-89c9-4ba8-9b9d-ecb9abba46fa'
--   즉 관리자는 영원히 그 한 사람뿐이다. 새 관리자를 추가해도 다른 사용자 프로필을 읽지도
--   관리하지도 못한다. 다중 공장으로 확장하면서 관리자/사용자가 늘어나면 바로 막힌다.
--   (다른 테이블들은 이미 role='admin' 기반으로 판정하고 있었다. user_profiles 만 예외였다)
--
-- ■ 함께 고치는 구멍
--   system_settings 의 정책 이름은 "관리자는 시스템 설정을 관리할 수 있음" 인데
--   실제 조건은 auth.role() = 'authenticated' 였다. 이름만 관리자고 조건은 "로그인한 아무나"다.
--   그래서 운영자가 PostgREST 로 supabase.from('system_settings').update(...) 를 직접 호출하면
--   교대 시간·OEE 임계값·회사명을 그대로 덮어쓸 수 있었다.
--   (직전 작업에서 RPC 와 API 라우트를 관리자 전용으로 막았지만, 테이블 정책이 열려 있으면
--    그 둘을 우회해 테이블을 직접 때릴 수 있다 — 세 번째 우회로였다)
--
-- ■ 재귀 주의
--   user_profiles 의 정책 안에서 user_profiles 를 조회하면 RLS 무한 재귀에 빠진다.
--   (정책을 평가하려고 테이블을 읽는데, 그 읽기가 다시 정책을 평가한다)
--   그래서 SECURITY DEFINER 헬퍼를 쓴다. 소유자 권한으로 실행되어 RLS 를 우회하므로 재귀가 끊긴다.

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
      SELECT 1 FROM public.user_profiles
      WHERE user_id = auth.uid() AND role = 'admin'
    );
$$;

COMMENT ON FUNCTION public.is_admin() IS
  '현재 요청자가 관리자(또는 서버의 service_role)인지 판정한다. '
  'SECURITY DEFINER 이므로 user_profiles 의 RLS 정책 안에서 호출해도 재귀하지 않는다.';

REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;


-- ── user_profiles ────────────────────────────────────────────────────────────
-- UUID 하드코딩 정책 제거
DROP POLICY IF EXISTS "Admin user full access" ON public.user_profiles;
DROP POLICY IF EXISTS "Admins can read all profiles v2" ON public.user_profiles;

-- 관리자는 모든 프로필을 읽고 관리할 수 있다 (역할 기반이므로 관리자가 늘어나도 자동 적용)
CREATE POLICY "Admins can read all profiles"
  ON public.user_profiles FOR SELECT
  USING (public.is_admin());

CREATE POLICY "Admins can manage profiles"
  ON public.user_profiles FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 남겨두는 정책:
--   "Users can read own profile"  (auth.uid() = user_id)
--   "Service role full access"    (서버 API 라우트용)
--
-- ⚠️ 일반 사용자에게 UPDATE 는 의도적으로 주지 않는다.
--    자기 행을 UPDATE 할 수 있으면 role 을 'admin' 으로 바꿔 권한을 상승시킬 수 있다.
--    개인 환경설정(language/theme_mode)은 update_my_preferences() RPC 로만 바꾼다.
--    그 함수는 갱신 가능한 컬럼이 못박혀 있어 role 을 건드릴 수 없다.


-- ── system_settings ──────────────────────────────────────────────────────────
-- 이름만 '관리자'였고 조건은 '로그인한 아무나'였던 쓰기 정책을 제거한다.
DO $$
DECLARE p record;
BEGIN
  FOR p IN
    SELECT policyname FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'system_settings' AND cmd = 'ALL'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.system_settings', p.policyname);
  END LOOP;
END $$;

-- 전역 시스템 설정의 변경은 관리자만.
CREATE POLICY "Only admins can modify system settings"
  ON public.system_settings FOR ALL
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- 읽기는 기존 정책("모든 인증된 사용자는 시스템 설정을 볼 수 있")을 그대로 유지한다.
-- 모든 사용자가 교대 시간·OEE 임계값 등을 읽어야 화면이 동작한다.


-- ── update_system_setting 의 권한 검사도 같은 판정을 쓰도록 통일 ─────────────
-- (판정 로직이 두 벌이면 나중에 한쪽만 고쳐져 어긋난다)
CREATE OR REPLACE FUNCTION public.update_system_setting(
  p_category text,
  p_key text,
  p_value text,
  p_reason text DEFAULT NULL::text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_setting_id uuid;
  v_old_value jsonb;
  v_new_value jsonb;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'only admin can update system settings';
  END IF;

  BEGIN
    v_new_value := jsonb_build_object('value', to_jsonb(p_value::text));
    IF p_value ~ '^[\[\{].*[\]\}]$' OR p_value ~ '^".*"$' OR p_value IN ('true', 'false', 'null') OR p_value ~ '^\d+(\.\d+)?$' THEN
      v_new_value := jsonb_build_object('value', p_value::jsonb);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_new_value := jsonb_build_object('value', p_value);
  END;

  SELECT id, setting_value INTO v_setting_id, v_old_value
  FROM system_settings
  WHERE category = p_category AND setting_key = p_key;

  IF v_setting_id IS NOT NULL THEN
    UPDATE system_settings
    SET setting_value = v_new_value,
        updated_at = now(),
        updated_by = v_user_id
    WHERE id = v_setting_id;

    INSERT INTO system_settings_audit (
      setting_id, category, setting_key, old_value, new_value,
      action, changed_by, change_reason
    ) VALUES (
      v_setting_id, p_category, p_key, v_old_value, v_new_value,
      'UPDATE', v_user_id, p_reason
    );
  ELSE
    INSERT INTO system_settings (
      category, setting_key, setting_value, default_value,
      description, data_type, is_active, is_system,
      created_by, updated_by
    ) VALUES (
      p_category, p_key, v_new_value, v_new_value,
      p_key || ' setting', 'string', true, false,
      v_user_id, v_user_id
    ) RETURNING id INTO v_setting_id;

    INSERT INTO system_settings_audit (
      setting_id, category, setting_key, new_value,
      action, changed_by, change_reason
    ) VALUES (
      v_setting_id, p_category, p_key, v_new_value,
      'CREATE', v_user_id, p_reason
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'setting_id', v_setting_id);
END;
$function$;

REVOKE ALL ON FUNCTION public.update_system_setting(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_system_setting(text, text, text, text) TO authenticated, service_role;
