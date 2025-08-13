-- CNC OEE 모니터링 시스템 데이터베이스 초기 설정
-- 이 스크립트를 Supabase SQL Editor에서 실행하세요

-- 1. 사용자 프로필 테이블 생성
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'operator', 'engineer')),
  assigned_machines TEXT[] DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- 제약조건
  CONSTRAINT user_profiles_name_not_empty CHECK (LENGTH(TRIM(name)) > 0)
);

-- 2. 설비 테이블 생성
CREATE TABLE IF NOT EXISTS machines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  location VARCHAR(100),
  model_type VARCHAR(100),
  default_tact_time INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- 제약조건
  CONSTRAINT machines_name_unique UNIQUE (name),
  CONSTRAINT machines_name_not_empty CHECK (LENGTH(TRIM(name)) > 0),
  CONSTRAINT machines_tact_time_positive CHECK (default_tact_time > 0)
);

-- 3. 설비 로그 테이블 생성
CREATE TABLE IF NOT EXISTS machine_logs (
  log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  state VARCHAR(20) NOT NULL CHECK (state IN (
    'NORMAL_OPERATION', 'MAINTENANCE', 'MODEL_CHANGE', 
    'PLANNED_STOP', 'PROGRAM_CHANGE', 'TOOL_CHANGE', 'TEMPORARY_STOP'
  )),
  start_time TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time TIMESTAMP WITH TIME ZONE,
  duration INTEGER,
  operator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- 제약조건
  CONSTRAINT machine_logs_end_after_start CHECK (end_time IS NULL OR end_time >= start_time),
  CONSTRAINT machine_logs_duration_positive CHECK (duration IS NULL OR duration >= 0),
  CONSTRAINT machine_logs_no_overlap EXCLUDE USING gist (
    machine_id WITH =,
    tstzrange(start_time, COALESCE(end_time, 'infinity'::timestamptz)) WITH &&
  ) WHERE (end_time IS NULL OR start_time < end_time)
);

-- 4. 생산 실적 테이블 생성
CREATE TABLE IF NOT EXISTS production_records (
  record_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  machine_id UUID NOT NULL REFERENCES machines(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  shift VARCHAR(1) CHECK (shift IN ('A', 'B')),
  planned_runtime INTEGER,
  actual_runtime INTEGER,
  ideal_runtime INTEGER,
  output_qty INTEGER DEFAULT 0,
  defect_qty INTEGER DEFAULT 0,
  availability DECIMAL(5,4),
  performance DECIMAL(5,4),
  quality DECIMAL(5,4),
  oee DECIMAL(5,4),
  operator_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- 제약조건
  CONSTRAINT production_records_unique_machine_date_shift UNIQUE (machine_id, date, shift),
  CONSTRAINT production_records_runtime_positive CHECK (
    planned_runtime IS NULL OR planned_runtime >= 0
  ),
  CONSTRAINT production_records_actual_runtime_positive CHECK (
    actual_runtime IS NULL OR actual_runtime >= 0
  ),
  CONSTRAINT production_records_ideal_runtime_positive CHECK (
    ideal_runtime IS NULL OR ideal_runtime >= 0
  ),
  CONSTRAINT production_records_output_qty_positive CHECK (output_qty >= 0),
  CONSTRAINT production_records_defect_qty_positive CHECK (defect_qty >= 0),
  CONSTRAINT production_records_defect_not_exceed_output CHECK (defect_qty <= output_qty),
  CONSTRAINT production_records_availability_range CHECK (
    availability IS NULL OR (availability >= 0 AND availability <= 1)
  ),
  CONSTRAINT production_records_performance_range CHECK (
    performance IS NULL OR (performance >= 0 AND performance <= 2)
  ),
  CONSTRAINT production_records_quality_range CHECK (
    quality IS NULL OR (quality >= 0 AND quality <= 1)
  ),
  CONSTRAINT production_records_oee_range CHECK (
    oee IS NULL OR (oee >= 0 AND oee <= 1)
  )
);

-- 5. 인덱스 생성 (성능 최적화)
-- 설비 로그 인덱스
CREATE INDEX IF NOT EXISTS idx_machine_logs_machine_time ON machine_logs(machine_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_machine_logs_state ON machine_logs(state);
CREATE INDEX IF NOT EXISTS idx_machine_logs_operator ON machine_logs(operator_id);
CREATE INDEX IF NOT EXISTS idx_machine_logs_end_time ON machine_logs(end_time) WHERE end_time IS NULL;

-- 생산 실적 인덱스
CREATE INDEX IF NOT EXISTS idx_production_records_date ON production_records(date DESC, machine_id);
CREATE INDEX IF NOT EXISTS idx_production_records_machine ON production_records(machine_id);
CREATE INDEX IF NOT EXISTS idx_production_records_shift ON production_records(shift);
CREATE INDEX IF NOT EXISTS idx_production_records_oee ON production_records(oee DESC) WHERE oee IS NOT NULL;

-- 사용자 프로필 인덱스
CREATE INDEX IF NOT EXISTS idx_user_profiles_role ON user_profiles(role);
CREATE INDEX IF NOT EXISTS idx_user_profiles_active ON user_profiles(is_active) WHERE is_active = true;

-- 설비 인덱스
CREATE INDEX IF NOT EXISTS idx_machines_active ON machines(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_machines_location ON machines(location);
CREATE INDEX IF NOT EXISTS idx_machines_model_type ON machines(model_type);

-- 6. Row Level Security (RLS) 활성화
ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE machine_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_records ENABLE ROW LEVEL SECURITY;

-- 7. RLS 정책 생성

-- ===========================================
-- 사용자 프로필 테이블 정책
-- ===========================================

-- 사용자는 본인 프로필만 조회 가능
CREATE POLICY "Users can view own profile" ON user_profiles
  FOR SELECT USING (auth.uid() = user_id);

-- 사용자는 본인 프로필만 수정 가능 (역할 변경 제외)
CREATE POLICY "Users can update own profile" ON user_profiles
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id AND 
    role = (SELECT role FROM user_profiles WHERE user_id = auth.uid())
  );

-- 관리자는 모든 사용자 프로필 관리 가능
CREATE POLICY "Admins can manage all profiles" ON user_profiles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    )
  );

-- 관리자는 새 사용자 프로필 생성 가능
CREATE POLICY "Admins can create profiles" ON user_profiles
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    )
  );

-- ===========================================
-- 설비 테이블 정책
-- ===========================================

-- 모든 인증된 사용자는 활성 설비 조회 가능
CREATE POLICY "Authenticated users can view active machines" ON machines
  FOR SELECT USING (
    auth.role() = 'authenticated' AND is_active = true
  );

-- 관리자만 설비 관리 가능
CREATE POLICY "Admins can manage machines" ON machines
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    )
  );

-- 엔지니어는 설비 정보 수정 가능 (삭제 제외)
CREATE POLICY "Engineers can update machines" ON machines
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() AND role = 'engineer' AND is_active = true
    )
  );

-- ===========================================
-- 설비 로그 테이블 정책
-- ===========================================

-- 관리자와 엔지니어는 모든 설비 로그 접근 가능
CREATE POLICY "Admins and engineers can access all machine logs" ON machine_logs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() 
      AND role IN ('admin', 'engineer') 
      AND is_active = true
    )
  );

-- 운영자는 담당 설비 로그만 접근 가능
CREATE POLICY "Operators can access assigned machine logs" ON machine_logs
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() 
      AND role = 'operator' 
      AND is_active = true
      AND machine_logs.machine_id::text = ANY(assigned_machines)
    )
  );

-- 운영자는 본인이 생성한 로그만 수정 가능
CREATE POLICY "Operators can update own logs" ON machine_logs
  FOR UPDATE USING (
    operator_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() AND role = 'operator' AND is_active = true
    )
  );

-- ===========================================
-- 생산 실적 테이블 정책
-- ===========================================

-- 관리자와 엔지니어는 모든 생산 실적 접근 가능
CREATE POLICY "Admins and engineers can access all production records" ON production_records
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() 
      AND role IN ('admin', 'engineer') 
      AND is_active = true
    )
  );

-- 운영자는 담당 설비 생산 실적만 접근 가능
CREATE POLICY "Operators can access assigned machine records" ON production_records
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() 
      AND role = 'operator' 
      AND is_active = true
      AND production_records.machine_id::text = ANY(assigned_machines)
    )
  );

-- 운영자는 본인이 입력한 실적만 수정 가능
CREATE POLICY "Operators can update own records" ON production_records
  FOR UPDATE USING (
    operator_id = auth.uid() AND
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() AND role = 'operator' AND is_active = true
    )
  );

-- ===========================================
-- 추가 보안 정책
-- ===========================================

-- 비활성 사용자는 모든 테이블 접근 차단
CREATE POLICY "Block inactive users from user_profiles" ON user_profiles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() AND is_active = true
    )
  );

-- 로그 생성 시 운영자 ID 자동 설정
CREATE OR REPLACE FUNCTION set_operator_id()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.operator_id IS NULL THEN
    NEW.operator_id := auth.uid();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER set_machine_log_operator
  BEFORE INSERT ON machine_logs
  FOR EACH ROW EXECUTE FUNCTION set_operator_id();

CREATE TRIGGER set_production_record_operator
  BEFORE INSERT ON production_records
  FOR EACH ROW EXECUTE FUNCTION set_operator_id();

-- 8. 트리거 함수 생성 (updated_at 자동 업데이트)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- 9. 트리거 생성
CREATE TRIGGER update_user_profiles_updated_at 
  BEFORE UPDATE ON user_profiles 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_machines_updated_at 
  BEFORE UPDATE ON machines 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_production_records_updated_at 
  BEFORE UPDATE ON production_records 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 10. 샘플 데이터 삽입 (선택사항)
-- 관리자 계정이 이미 있다면 주석 해제하여 사용
/*
INSERT INTO user_profiles (user_id, name, role) VALUES 
  ('your-admin-user-id', '관리자', 'admin');

INSERT INTO machines (name, location, model_type, default_tact_time) VALUES 
  ('CNC-001', 'A동 1층', 'MAZAK-VTC-200', 30),
  ('CNC-002', 'A동 1층', 'MAZAK-VTC-200', 30),
  ('CNC-003', 'A동 2층', 'OKUMA-LB-3000', 45);
*/

-- 10. 보안 및 데이터 무결성 함수

-- 설비 상태 변경 시 이전 로그 자동 종료 함수
CREATE OR REPLACE FUNCTION close_previous_machine_log()
RETURNS TRIGGER AS $$
BEGIN
  -- 같은 설비의 미완료 로그를 종료
  UPDATE machine_logs 
  SET 
    end_time = NEW.start_time,
    duration = EXTRACT(EPOCH FROM (NEW.start_time - start_time))::INTEGER / 60
  WHERE machine_id = NEW.machine_id 
    AND end_time IS NULL 
    AND log_id != NEW.log_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER close_previous_log_trigger
  AFTER INSERT ON machine_logs
  FOR EACH ROW EXECUTE FUNCTION close_previous_machine_log();

-- 사용자 역할 변경 감사 함수
CREATE OR REPLACE FUNCTION audit_role_change()
RETURNS TRIGGER AS $$
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
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 감사 로그 테이블 생성
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name VARCHAR(50) NOT NULL,
  record_id UUID NOT NULL,
  action VARCHAR(20) NOT NULL,
  old_values JSONB,
  new_values JSONB,
  changed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 감사 로그 RLS 정책 (관리자만 접근)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Only admins can view audit log" ON audit_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM user_profiles 
      WHERE user_id = auth.uid() AND role = 'admin' AND is_active = true
    )
  );

-- 역할 변경 감사 트리거 생성
CREATE TRIGGER audit_user_role_changes
  AFTER UPDATE ON user_profiles
  FOR EACH ROW EXECUTE FUNCTION audit_role_change();

-- 11. 유틸리티 함수 생성

-- 설비 현재 상태 조회 함수
CREATE OR REPLACE FUNCTION get_machine_current_state(machine_uuid UUID)
RETURNS TABLE (
  state VARCHAR(20),
  start_time TIMESTAMP WITH TIME ZONE,
  duration_minutes INTEGER,
  operator_name VARCHAR(100)
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    ml.state,
    ml.start_time,
    EXTRACT(EPOCH FROM (NOW() - ml.start_time))::INTEGER / 60 as duration_minutes,
    up.name as operator_name
  FROM machine_logs ml
  LEFT JOIN user_profiles up ON ml.operator_id = up.user_id
  WHERE ml.machine_id = machine_uuid 
    AND ml.end_time IS NULL
  ORDER BY ml.start_time DESC
  LIMIT 1;
END;
$$ LANGUAGE plpgsql;

-- OEE 계산 함수
CREATE OR REPLACE FUNCTION calculate_oee(
  p_machine_id UUID,
  p_date DATE,
  p_shift VARCHAR(1) DEFAULT NULL
)
RETURNS TABLE (
  availability DECIMAL(5,4),
  performance DECIMAL(5,4),
  quality DECIMAL(5,4),
  oee DECIMAL(5,4)
) AS $$
DECLARE
  v_planned_runtime INTEGER := 480; -- 8시간 = 480분 (기본값)
  v_actual_runtime INTEGER := 0;
  v_ideal_runtime INTEGER := 0;
  v_output_qty INTEGER := 0;
  v_defect_qty INTEGER := 0;
  v_tact_time INTEGER;
BEGIN
  -- 설비의 기본 Tact Time 조회
  SELECT default_tact_time INTO v_tact_time
  FROM machines WHERE id = p_machine_id;
  
  -- 실제 가동 시간 계산 (NORMAL_OPERATION 상태 시간 합계)
  SELECT COALESCE(SUM(
    CASE 
      WHEN ml.end_time IS NOT NULL THEN 
        EXTRACT(EPOCH FROM (ml.end_time - ml.start_time))::INTEGER / 60
      ELSE 
        EXTRACT(EPOCH FROM (NOW() - ml.start_time))::INTEGER / 60
    END
  ), 0) INTO v_actual_runtime
  FROM machine_logs ml
  WHERE ml.machine_id = p_machine_id
    AND ml.state = 'NORMAL_OPERATION'
    AND DATE(ml.start_time) = p_date
    AND (p_shift IS NULL OR 
         (p_shift = 'A' AND EXTRACT(HOUR FROM ml.start_time) BETWEEN 8 AND 19) OR
         (p_shift = 'B' AND (EXTRACT(HOUR FROM ml.start_time) >= 20 OR EXTRACT(HOUR FROM ml.start_time) < 8)));
  
  -- 생산 실적 조회
  SELECT COALESCE(output_qty, 0), COALESCE(defect_qty, 0)
  INTO v_output_qty, v_defect_qty
  FROM production_records
  WHERE machine_id = p_machine_id 
    AND date = p_date 
    AND (p_shift IS NULL OR shift = p_shift);
  
  -- 이상적 가동 시간 계산
  v_ideal_runtime := v_output_qty * v_tact_time;
  
  -- OEE 지표 계산
  RETURN QUERY SELECT
    CASE WHEN v_planned_runtime > 0 THEN v_actual_runtime::DECIMAL / v_planned_runtime ELSE 0 END,
    CASE WHEN v_actual_runtime > 0 THEN v_ideal_runtime::DECIMAL / v_actual_runtime ELSE 0 END,
    CASE WHEN v_output_qty > 0 THEN (v_output_qty - v_defect_qty)::DECIMAL / v_output_qty ELSE 0 END,
    CASE WHEN v_planned_runtime > 0 THEN 
      (v_actual_runtime::DECIMAL / v_planned_runtime) * 
      (CASE WHEN v_actual_runtime > 0 THEN v_ideal_runtime::DECIMAL / v_actual_runtime ELSE 0 END) *
      (CASE WHEN v_output_qty > 0 THEN (v_output_qty - v_defect_qty)::DECIMAL / v_output_qty ELSE 0 END)
    ELSE 0 END;
END;
$$ LANGUAGE plpgsql;

-- 12. 뷰 생성

-- 설비 현재 상태 뷰
CREATE OR REPLACE VIEW machine_current_status AS
SELECT 
  m.id,
  m.name,
  m.location,
  m.model_type,
  m.is_active,
  ml.state as current_state,
  ml.start_time as state_start_time,
  EXTRACT(EPOCH FROM (NOW() - ml.start_time))::INTEGER / 60 as state_duration_minutes,
  up.name as operator_name
FROM machines m
LEFT JOIN LATERAL (
  SELECT state, start_time, operator_id
  FROM machine_logs 
  WHERE machine_id = m.id AND end_time IS NULL
  ORDER BY start_time DESC
  LIMIT 1
) ml ON true
LEFT JOIN user_profiles up ON ml.operator_id = up.user_id
WHERE m.is_active = true;

-- 일일 OEE 요약 뷰
CREATE OR REPLACE VIEW daily_oee_summary AS
SELECT 
  pr.machine_id,
  m.name as machine_name,
  pr.date,
  pr.shift,
  pr.availability,
  pr.performance,
  pr.quality,
  pr.oee,
  pr.output_qty,
  pr.defect_qty,
  (pr.output_qty - pr.defect_qty) as good_qty
FROM production_records pr
JOIN machines m ON pr.machine_id = m.id
WHERE pr.oee IS NOT NULL
ORDER BY pr.date DESC, m.name, pr.shift;

-- 설정 완료 메시지
SELECT 'CNC OEE 모니터링 시스템 데이터베이스 설정이 완료되었습니다!' as message;