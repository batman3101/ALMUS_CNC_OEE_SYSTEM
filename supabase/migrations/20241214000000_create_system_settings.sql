-- 시스템 설정 테이블 생성
-- 이 스크립트를 Supabase SQL Editor에서 실행하세요

-- 1. 시스템 설정 테이블 생성
CREATE TABLE IF NOT EXISTS system_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category VARCHAR(50) NOT NULL CHECK (category IN ('general', 'oee', 'notification', 'display', 'shift')),
  setting_key VARCHAR(100) NOT NULL,
  setting_value JSONB NOT NULL,
  value_type VARCHAR(20) NOT NULL CHECK (value_type IN ('string', 'number', 'boolean', 'json', 'color', 'time')),
  description TEXT,
  is_system BOOLEAN DEFAULT false, -- 시스템 필수 설정 여부
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  
  -- 제약조건
  CONSTRAINT system_settings_unique_key UNIQUE (category, setting_key),
  CONSTRAINT system_settings_key_not_empty CHECK (LENGTH(TRIM(setting_key)) > 0)
);

-- 2. 시스템 설정 변경 이력 테이블 생성
CREATE TABLE IF NOT EXISTS system_settings_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_id UUID NOT NULL REFERENCES system_settings(id) ON DELETE CASCADE,
  category VARCHAR(50) NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  old_value JSONB,
  new_value JSONB NOT NULL,
  changed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  change_reason TEXT
);

-- 3. 인덱스 생성
CREATE INDEX IF NOT EXISTS idx_system_settings_category ON system_settings(category);
CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(setting_key);
CREATE INDEX IF NOT EXISTS idx_system_settings_active ON system_settings(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_system_settings_system ON system_settings(is_system) WHERE is_system = true;

CREATE INDEX IF NOT EXISTS idx_system_settings_audit_setting ON system_settings_audit(setting_id);
CREATE INDEX IF NOT EXISTS idx_system_settings_audit_date ON system_settings_audit(changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_system_settings_audit_user ON system_settings_audit(changed_by);

-- 4. RLS 정책 설정
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings_audit ENABLE ROW LEVEL SECURITY;

-- 모든 인증된 사용자는 시스템 설정 조회 가능
CREATE POLICY "Authenticated users can view system settings" ON system_settings
  FOR SELECT USING (auth.role() = 'authenticated' AND is_active = true);

-- 관리자만 시스템 설정 수정 가능
CREATE POLICY "Only admins can modify system settings" ON system_settings
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    )
  );

-- 관리자와 엔지니어는 설정 변경 이력 조회 가능
CREATE POLICY "Admins and engineers can view settings audit" ON system_settings_audit
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() 
      AND role IN ('admin', 'engineer') 
      AND is_active = true
    )
  );

-- 5. 트리거 함수 생성

-- updated_at 자동 업데이트 트리거
CREATE TRIGGER update_system_settings_updated_at 
  BEFORE UPDATE ON system_settings 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 설정 변경 시 이력 기록 트리거 함수
CREATE OR REPLACE FUNCTION audit_system_settings_changes()
RETURNS TRIGGER AS $
BEGIN
  -- INSERT의 경우
  IF TG_OP = 'INSERT' THEN
    INSERT INTO system_settings_audit (
      setting_id, category, setting_key, old_value, new_value, changed_by
    ) VALUES (
      NEW.id, NEW.category, NEW.setting_key, NULL, NEW.setting_value, auth.uid()
    );
    RETURN NEW;
  END IF;
  
  -- UPDATE의 경우
  IF TG_OP = 'UPDATE' THEN
    -- 값이 실제로 변경된 경우만 이력 기록
    IF OLD.setting_value IS DISTINCT FROM NEW.setting_value THEN
      INSERT INTO system_settings_audit (
        setting_id, category, setting_key, old_value, new_value, changed_by
      ) VALUES (
        NEW.id, NEW.category, NEW.setting_key, OLD.setting_value, NEW.setting_value, auth.uid()
      );
    END IF;
    RETURN NEW;
  END IF;
  
  -- DELETE의 경우
  IF TG_OP = 'DELETE' THEN
    INSERT INTO system_settings_audit (
      setting_id, category, setting_key, old_value, new_value, changed_by
    ) VALUES (
      OLD.id, OLD.category, OLD.setting_key, OLD.setting_value, NULL, auth.uid()
    );
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- 설정 변경 이력 트리거 생성
CREATE TRIGGER audit_system_settings_trigger
  AFTER INSERT OR UPDATE OR DELETE ON system_settings
  FOR EACH ROW EXECUTE FUNCTION audit_system_settings_changes();

-- 6. 기본 시스템 설정값 삽입
INSERT INTO system_settings (category, setting_key, setting_value, value_type, description, is_system) VALUES
-- 일반 설정
('general', 'company_name', '"CNC Manufacturing Co."', 'string', '회사명', true),
('general', 'company_logo_url', '""', 'string', '회사 로고 URL', false),
('general', 'timezone', '"Asia/Seoul"', 'string', '시간대 설정', true),
('general', 'language', '"ko"', 'string', '기본 언어 (ko/vi)', true),
('general', 'date_format', '"YYYY-MM-DD"', 'string', '날짜 형식', false),
('general', 'time_format', '"HH:mm:ss"', 'string', '시간 형식', false),

-- OEE 설정
('oee', 'target_oee', '0.85', 'number', 'OEE 목표값 (0-1)', true),
('oee', 'target_availability', '0.90', 'number', '가동률 목표값 (0-1)', true),
('oee', 'target_performance', '0.95', 'number', '성능 목표값 (0-1)', true),
('oee', 'target_quality', '0.99', 'number', '품질 목표값 (0-1)', true),
('oee', 'low_oee_threshold', '0.60', 'number', 'OEE 저하 임계값 (0-1)', true),
('oee', 'critical_oee_threshold', '0.40', 'number', 'OEE 위험 임계값 (0-1)', true),
('oee', 'downtime_alert_minutes', '30', 'number', '다운타임 알림 기준 (분)', true),

-- 교대 설정
('shift', 'shift_a_start', '"08:00"', 'time', 'A교대 시작 시간', true),
('shift', 'shift_a_end', '"20:00"', 'time', 'A교대 종료 시간', true),
('shift', 'shift_b_start', '"20:00"', 'time', 'B교대 시작 시간', true),
('shift', 'shift_b_end', '"08:00"', 'time', 'B교대 종료 시간', true),
('shift', 'break_time_minutes', '60', 'number', '교대별 휴식 시간 (분)', true),
('shift', 'shift_change_buffer_minutes', '15', 'number', '교대 교체 버퍼 시간 (분)', false),

-- 알림 설정
('notification', 'email_notifications_enabled', 'true', 'boolean', '이메일 알림 활성화', false),
('notification', 'browser_notifications_enabled', 'true', 'boolean', '브라우저 알림 활성화', false),
('notification', 'sound_notifications_enabled', 'true', 'boolean', '소리 알림 활성화', false),
('notification', 'notification_email', '""', 'string', '알림 수신 이메일', false),
('notification', 'alert_check_interval_seconds', '60', 'number', '알림 확인 간격 (초)', true),

-- 화면 설정
('display', 'theme_primary_color', '"#1890ff"', 'color', '주요 테마 색상', false),
('display', 'theme_success_color', '"#52c41a"', 'color', '성공 색상', false),
('display', 'theme_warning_color', '"#faad14"', 'color', '경고 색상', false),
('display', 'theme_error_color', '"#ff4d4f"', 'color', '오류 색상', false),
('display', 'dashboard_refresh_interval_seconds', '30', 'number', '대시보드 새로고침 간격 (초)', true),
('display', 'chart_animation_enabled', 'true', 'boolean', '차트 애니메이션 활성화', false),
('display', 'compact_mode', 'false', 'boolean', '컴팩트 모드', false),
('display', 'show_machine_images', 'true', 'boolean', '설비 이미지 표시', false);

-- 7. 유틸리티 함수 생성

-- 설정값 조회 함수
CREATE OR REPLACE FUNCTION get_system_setting(p_category VARCHAR, p_key VARCHAR)
RETURNS JSONB AS $
DECLARE
  result JSONB;
BEGIN
  SELECT setting_value INTO result
  FROM system_settings
  WHERE category = p_category 
    AND setting_key = p_key 
    AND is_active = true;
  
  RETURN result;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- 설정값 업데이트 함수
CREATE OR REPLACE FUNCTION update_system_setting(
  p_category VARCHAR,
  p_key VARCHAR,
  p_value JSONB,
  p_reason TEXT DEFAULT NULL
)
RETURNS BOOLEAN AS $
DECLARE
  setting_exists BOOLEAN;
BEGIN
  -- 설정이 존재하는지 확인
  SELECT EXISTS(
    SELECT 1 FROM system_settings 
    WHERE category = p_category AND setting_key = p_key
  ) INTO setting_exists;
  
  IF setting_exists THEN
    -- 기존 설정 업데이트
    UPDATE system_settings 
    SET 
      setting_value = p_value,
      updated_at = NOW(),
      updated_by = auth.uid()
    WHERE category = p_category AND setting_key = p_key;
    
    -- 변경 이유가 있으면 audit 테이블에 추가
    IF p_reason IS NOT NULL THEN
      UPDATE system_settings_audit 
      SET change_reason = p_reason
      WHERE setting_id = (
        SELECT id FROM system_settings 
        WHERE category = p_category AND setting_key = p_key
      )
      AND changed_at = (
        SELECT MAX(changed_at) FROM system_settings_audit 
        WHERE setting_id = (
          SELECT id FROM system_settings 
          WHERE category = p_category AND setting_key = p_key
        )
      );
    END IF;
    
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- 카테고리별 설정 조회 함수
CREATE OR REPLACE FUNCTION get_settings_by_category(p_category VARCHAR)
RETURNS TABLE (
  setting_key VARCHAR,
  setting_value JSONB,
  value_type VARCHAR,
  description TEXT,
  is_system BOOLEAN
) AS $
BEGIN
  RETURN QUERY
  SELECT 
    s.setting_key,
    s.setting_value,
    s.value_type,
    s.description,
    s.is_system
  FROM system_settings s
  WHERE s.category = p_category 
    AND s.is_active = true
  ORDER BY s.setting_key;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- 모든 활성 설정 조회 함수
CREATE OR REPLACE FUNCTION get_all_active_settings()
RETURNS TABLE (
  category VARCHAR,
  setting_key VARCHAR,
  setting_value JSONB,
  value_type VARCHAR,
  description TEXT
) AS $
BEGIN
  RETURN QUERY
  SELECT 
    s.category,
    s.setting_key,
    s.setting_value,
    s.value_type,
    s.description
  FROM system_settings s
  WHERE s.is_active = true
  ORDER BY s.category, s.setting_key;
END;
$ LANGUAGE plpgsql SECURITY DEFINER;

-- 8. 뷰 생성

-- 설정 요약 뷰
CREATE OR REPLACE VIEW system_settings_summary AS
SELECT 
  category,
  COUNT(*) as total_settings,
  COUNT(*) FILTER (WHERE is_system = true) as system_settings,
  COUNT(*) FILTER (WHERE is_active = true) as active_settings,
  MAX(updated_at) as last_updated
FROM system_settings
GROUP BY category
ORDER BY category;

-- 최근 설정 변경 이력 뷰
CREATE OR REPLACE VIEW recent_settings_changes AS
SELECT 
  sa.id,
  sa.category,
  sa.setting_key,
  sa.old_value,
  sa.new_value,
  sa.changed_at,
  up.name as changed_by_name,
  sa.change_reason
FROM system_settings_audit sa
LEFT JOIN user_profiles up ON sa.changed_by = up.user_id
ORDER BY sa.changed_at DESC
LIMIT 50;

-- 뷰 접근 권한 설정
GRANT SELECT ON system_settings_summary TO authenticated;
GRANT SELECT ON recent_settings_changes TO authenticated;

-- 9. 함수 실행 권한 설정
GRANT EXECUTE ON FUNCTION get_system_setting(VARCHAR, VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_settings_by_category(VARCHAR) TO authenticated;
GRANT EXECUTE ON FUNCTION get_all_active_settings() TO authenticated;

-- 관리자만 설정 업데이트 함수 실행 가능
GRANT EXECUTE ON FUNCTION update_system_setting(VARCHAR, VARCHAR, JSONB, TEXT) TO authenticated;

-- 설정 완료 메시지
SELECT 'System settings database schema has been created successfully!' as message;