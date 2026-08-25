-- 운영 baseline: 저장소에 정의가 없던 함수 9개 (2026-08-21 실측 추출)
--
-- ## 왜 이 파일이 필요한가
--
-- `00000000000000_baseline_schema.sql` 를 넣은 뒤 로컬 적용을 다시 돌렸더니 네 번째
-- 마이그레이션에서 멈췄다:
--
--   Applying migration 20251116070200_update_system_setting_rpc_function.sql...
--   ERROR: function public.audit_system_settings_change() does not exist (SQLSTATE 42883)
--
-- 저장소 마이그레이션이 **참조는 하지만 생성하지는 않는** 함수들이 있었다. 전수 조사 결과
-- 운영 함수 38개 중 9개가 그랬다. 테이블 11개에 이어 함수 9개 — 같은 종류의 구멍이다.
--
-- 대부분 트리거 보조 함수라 "당연히 있겠거니" 하고 넘어가기 쉬운 것들이다. 바로 그래서
-- 아무도 부재를 눈치채지 못했다.
--
-- ## 원문 보존
--
-- `pg_get_functiondef()` 출력을 그대로 옮겼다. 손으로 다듬으면 운영과 미세하게 달라지고,
-- 그 차이는 로컬에서 통과하고 운영에서 실패하는 종류의 버그가 된다.

begin;

-- ---------------------------------------------------------------------------
-- updated_at 유지 (세 개가 같은 일을 한다 — 운영 현실 그대로 보존한다)
-- ---------------------------------------------------------------------------
-- 정리하고 싶어지지만 하지 않는다. baseline 의 목적은 개선이 아니라 **재현**이다.
-- 통합은 별도 마이그레이션에서 의도적으로 해야 한다.

CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.update_downtime_entries_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 감사
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_role_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF OLD.role != NEW.role THEN
    INSERT INTO audit_log (table_name, record_id, action, old_values, new_values, changed_by)
    VALUES (
      'user_profiles',
      NEW.user_id,
      'role_change',
      jsonb_build_object('role', OLD.role),
      jsonb_build_object('role', NEW.role),
      auth.uid()
    );
  END IF;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.audit_system_settings_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO system_settings_audit (
      setting_id, category, setting_key, new_value, action, changed_by
    ) VALUES (
      NEW.id, NEW.category, NEW.setting_key, NEW.setting_value, 'CREATE', auth.uid()
    );
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.setting_value != NEW.setting_value THEN
      INSERT INTO system_settings_audit (
        setting_id, category, setting_key, old_value, new_value, action, changed_by
      ) VALUES (
        NEW.id, NEW.category, NEW.setting_key, OLD.setting_value, NEW.setting_value, 'UPDATE', auth.uid()
      );
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO system_settings_audit (
      setting_id, category, setting_key, old_value, action, changed_by
    ) VALUES (
      OLD.id, OLD.category, OLD.setting_key, OLD.setting_value, 'DELETE', auth.uid()
    );
    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 설비 상태
-- ---------------------------------------------------------------------------
-- 새 로그가 열리면 같은 설비의 이전 열린 로그를 닫는다.
-- 이 트리거가 andon RPC 와 이중으로 기록해 0분 유령 로그를 만든 전례가 있다(2026-07-20).
CREATE OR REPLACE FUNCTION public.close_previous_machine_log()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  UPDATE machine_logs
  SET
    end_time = NEW.start_time,
    duration = EXTRACT(EPOCH FROM (NEW.start_time - start_time))::INTEGER / 60
  WHERE machine_id = NEW.machine_id
    AND end_time IS NULL
    AND log_id != NEW.log_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.set_operator_id()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF NEW.operator_id IS NULL THEN
    NEW.operator_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$function$;

-- 설비의 현재 공정이 그 설비의 생산 모델에 속하는지 검증한다.
-- 멀티테넌시에서는 여기에 "같은 공장인가"까지 더해져야 하지만, 그 강화는 복합 FK 가
-- DB 수준에서 대신한다(20260821110000_multi_factory_expand_columns.sql).
CREATE OR REPLACE FUNCTION public.validate_machine_process_model()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF NEW.production_model_id IS NOT NULL AND NEW.current_process_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM model_processes
      WHERE id = NEW.current_process_id
      AND model_id = NEW.production_model_id
    ) THEN
      RAISE EXCEPTION '선택한 공정이 해당 생산 모델에 속하지 않습니다. (공정 ID: %, 모델 ID: %)',
        NEW.current_process_id, NEW.production_model_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 설정 조회
-- ---------------------------------------------------------------------------
-- 공장 인자가 없다. 멀티테넌시 cutover 에서 factory-scoped 버전으로 대체된다 —
-- 인자를 추가하면 오버로드가 생기므로 **새 이름 + 구버전 유지**의 3단계 배포가 필요하다.
CREATE OR REPLACE FUNCTION public.get_system_setting(p_category text, p_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  RETURN (
    SELECT setting_value->'value'
    FROM system_settings
    WHERE category = p_category
      AND setting_key = p_key
      AND is_active = true
    LIMIT 1
  );
END;
$function$;

commit;
