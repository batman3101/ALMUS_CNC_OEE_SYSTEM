-- 개인 환경설정(언어/테마)을 전역 system_settings 에서 분리해 사용자별로 저장한다.
--
-- 배경 (실측으로 확인된 버그):
--   언어 토글과 테마 토글이 system_settings 의 default_language / theme_mode 를 직접 수정했다.
--   그런데 system_settings 에는 user_id 가 없다 — 회사 전체가 공유하는 "단일 전역 행"이다.
--   게다가 SystemSettingsContext 는 설정 변경을 Realtime 브로드캐스트로 모든 접속 클라이언트에
--   전파한다. 그 결과:
--     - A 사용자가 언어를 한국어로 바꾸면 B 사용자 화면도 한국어로 바뀐다.
--     - A 와 B 가 서로 다른 언어를 원하면 두 클라이언트가 같은 행을 두고 계속 되돌려 써서
--       ko <-> vi 가 몇 초 간격으로 무한히 뒤집힌다. (system_settings_audit 에 그대로 기록돼 있다)
--   "한국어로 바꿔도 몇 초 뒤 베트남어로 돌아간다"는 증상의 실제 원인이 이것이다.
--
-- 설계:
--   개인 환경설정(언어/테마)  -> user_profiles 의 사용자별 컬럼. 본인만 변경.
--   시스템 설정(교대/OEE/회사) -> system_settings 전역 행. 관리자만 변경.
--   system_settings.default_language / display.theme_mode 는 그대로 두되, 의미를 바꾼다:
--     "사용 중 강제되는 값"이 아니라 "아직 개인 설정을 고르지 않은 사용자의 기본값".
--   따라서 아래 컬럼은 NULL 을 허용한다. NULL = 아직 고르지 않음 = 시스템 기본값을 따른다.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS language   text,
  ADD COLUMN IF NOT EXISTS theme_mode text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_language_check'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_language_check
      CHECK (language IS NULL OR language IN ('ko', 'vi'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_profiles_theme_mode_check'
  ) THEN
    ALTER TABLE public.user_profiles
      ADD CONSTRAINT user_profiles_theme_mode_check
      CHECK (theme_mode IS NULL OR theme_mode IN ('light', 'dark'));
  END IF;
END $$;

COMMENT ON COLUMN public.user_profiles.language   IS '사용자 개인 언어 설정. NULL 이면 system_settings.general.default_language 를 따른다.';
COMMENT ON COLUMN public.user_profiles.theme_mode IS '사용자 개인 테마 설정. NULL 이면 system_settings.display.theme_mode 를 따른다.';


-- 본인의 개인 환경설정만 바꾸는 전용 함수.
--
-- user_profiles 에 일반 UPDATE 정책을 열어주면 사용자가 자기 role 을 'admin' 으로 바꿀 수 있다.
-- 그래서 UPDATE 를 열지 않고, 갱신 가능한 컬럼을 이 함수 안에 못박는다.
-- 인자가 NULL 이면 해당 항목은 건드리지 않는다(부분 갱신).
CREATE OR REPLACE FUNCTION public.update_my_preferences(
  p_language   text DEFAULT NULL,
  p_theme_mode text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF p_language IS NOT NULL AND p_language NOT IN ('ko', 'vi') THEN
    RAISE EXCEPTION 'invalid language: %', p_language;
  END IF;

  IF p_theme_mode IS NOT NULL AND p_theme_mode NOT IN ('light', 'dark') THEN
    RAISE EXCEPTION 'invalid theme_mode: %', p_theme_mode;
  END IF;

  UPDATE public.user_profiles
     SET language   = COALESCE(p_language,   language),
         theme_mode = COALESCE(p_theme_mode, theme_mode),
         updated_at = now()
   WHERE user_id = v_user_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_my_preferences(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_my_preferences(text, text) TO authenticated, service_role;


-- 전역 시스템 설정 변경은 관리자(또는 서버의 service_role)만 가능하도록 제한한다.
--
-- 기존에는 SECURITY DEFINER 인데 anon/authenticated 에게 EXECUTE 가 열려 있어서,
-- 운영자/엔지니어는 물론 비로그인 사용자도 교대 시간·OEE 임계값·회사명 등
-- 모든 전역 설정을 덮어쓸 수 있었다.
-- 본문 로직은 기존과 동일하고, 맨 앞의 권한 검사와 search_path 고정만 추가한다.
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

  -- 권한 검사: 서버(service_role) 이거나 관리자여야 한다.
  IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE user_id = v_user_id AND role = 'admin'
    ) THEN
      RAISE EXCEPTION 'only admin can update system settings';
    END IF;
  END IF;

  -- Parse the new value intelligently
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
    SET
      setting_value = v_new_value,
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

-- 비로그인(anon) 은 전역 설정을 만질 이유가 없다.
REVOKE ALL ON FUNCTION public.update_system_setting(text, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_system_setting(text, text, text, text) TO authenticated, service_role;
-- authenticated 에게 EXECUTE 는 남기되, 함수 내부에서 관리자만 통과시킨다
-- (관리자가 설정 페이지에서 직접 호출하는 경로를 유지하기 위함).
